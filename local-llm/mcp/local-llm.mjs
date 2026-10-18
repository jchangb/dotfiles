#!/usr/bin/env node
// MCP server over stdio, no dependencies. Read-only by design: Claude reviews the
// local model's output and writes any changes itself.

import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import readline from 'node:readline';

const BASE_URL = process.env.LLM_BASE_URL || 'http://127.0.0.1:8080';
const START_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'start-llm.ps1');
const VAULT = process.env.VAULT_DIR || process.cwd();
const DEFAULT_MODEL = process.env.LLM_DEFAULT_MODEL || 'gemma-4-12b';
const MODELS = ['gemma-4-12b', 'qwen3.6-35b-a3b'];
// Keeps one file inside the 16k-token context set in models.ini.
const MAX_FILE_CHARS = 40000;

const TOOLS = [
  {
    name: 'local_llm',
    description:
      'Run a prompt on the free local model (llama.cpp on the RTX 4070 Ti). For cheap, low-stakes text work: ' +
      'summarizing, tagging, reformatting, extracting, classifying. Output can be wrong - review it before acting. ' +
      `Models: ${MODELS.join(', ')} (default ${DEFAULT_MODEL}; qwen is smarter but slower).`,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The task and any text it needs.' },
        system: { type: 'string', description: 'Optional system prompt.' },
        model: { type: 'string', enum: MODELS },
        max_tokens: { type: 'integer', description: 'Default 2048.' },
        think: { type: 'boolean', description: 'Let the model reason before answering (slower). Default false.' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'local_llm_files',
    description:
      'Apply one instruction to each file separately on the local model and return the answers. The local model ' +
      'reads the files, so their contents never enter your context - ideal for bulk vault jobs (tag, summarize, ' +
      `check many notes). Relative paths resolve against ${VAULT}. Read-only: write changes yourself after reviewing.`,
    inputSchema: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: 'Absolute or vault-relative paths.' },
        instruction: { type: 'string', description: 'What to do with each file.' },
        model: { type: 'string', enum: MODELS },
        max_tokens: { type: 'integer', description: 'Per file. Default 1024.' },
        think: { type: 'boolean', description: 'Default false.' },
      },
      required: ['paths', 'instruction'],
    },
  },
  {
    name: 'local_llm_status',
    description: 'Whether the local llama-server is up, and which models are loaded, sleeping or unloaded.',
    inputSchema: { type: 'object', properties: {} },
  },
];

async function isUp() {
  try {
    const r = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

// Shared so parallel tool calls don't each launch their own router.
let starting = null;

function ensureServer() {
  starting ??= startServer().finally(() => (starting = null));
  return starting;
}

async function startServer() {
  if (await isUp()) return;
  // Not detached: without a console, Start-Process inside the script silently does nothing.
  spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', START_SCRIPT], {
    stdio: 'ignore',
    windowsHide: true,
  });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await isUp()) return;
  }
  throw new Error(`llama-server did not come up at ${BASE_URL} (start script: ${START_SCRIPT})`);
}

async function chat({ prompt, system, model, max_tokens, think }) {
  await ensureServer();
  const messages = system ? [{ role: 'system', content: system }] : [];
  messages.push({ role: 'user', content: prompt });
  const r = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      messages,
      temperature: 0.2,
      max_tokens: max_tokens || 2048,
      chat_template_kwargs: { enable_thinking: !!think },
    }),
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!r.ok) throw new Error(`llama-server ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const text = (j.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const tps = Math.round(j.timings?.predicted_per_second || 0);
  const stats = `[${model || DEFAULT_MODEL} | ${j.usage?.prompt_tokens ?? '?'} in / ${j.usage?.completion_tokens ?? '?'} out | ${tps} tok/s]`;
  return `${text}\n${stats}`;
}

async function runOnFile(p, args) {
  const full = path.isAbsolute(p) ? p : path.join(VAULT, p);
  const content = await readFile(full, 'utf8');
  const truncated = content.length > MAX_FILE_CHARS;
  const answer = await chat({
    system: 'You process files from an Obsidian vault. Reply only with what the instruction asks.',
    prompt: `${args.instruction}\n\n--- FILE: ${p} ---\n${content.slice(0, MAX_FILE_CHARS)}`,
    model: args.model,
    max_tokens: args.max_tokens || 1024,
    think: args.think,
  });
  return `## ${p}${truncated ? ' (truncated)' : ''}\n${answer}`;
}

async function callTool(name, args = {}) {
  if (name === 'local_llm') return chat(args);

  if (name === 'local_llm_files') {
    const out = [];
    for (const p of args.paths || []) {
      out.push(await runOnFile(p, args).catch((e) => `## ${p}\nERROR: ${e.message}`));
    }
    return out.join('\n\n');
  }

  if (name === 'local_llm_status') {
    if (!(await isUp())) return `llama-server is not running at ${BASE_URL}. The next local_llm call starts it.`;
    const j = await (await fetch(`${BASE_URL}/models`)).json();
    return (j.data || []).map((m) => `${m.id}: ${m.status?.value ?? 'unknown'}`).join('\n');
  }

  throw new Error(`Unknown tool: ${name}`);
}

const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');

async function handle({ id, method, params }) {
  if (method === 'initialize') {
    return send({
      id,
      result: {
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'local-llm', version: '0.1.0' },
      },
    });
  }
  if (method === 'tools/list') return send({ id, result: { tools: TOOLS } });
  if (method === 'ping') return send({ id, result: {} });
  if (method !== 'tools/call') return send({ id, error: { code: -32601, message: `Method not found: ${method}` } });

  try {
    const text = await callTool(params.name, params.arguments);
    send({ id, result: { content: [{ type: 'text', text }] } });
  } catch (e) {
    send({ id, result: { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true } });
  }
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id === undefined) return;
  handle(msg).catch((e) => send({ id: msg.id, error: { code: -32603, message: e.message } }));
});
