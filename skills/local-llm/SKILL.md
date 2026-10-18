---
name: local-llm
description: Hand cheap, bulk or private text work to the free local model (llama.cpp on the home PC) instead of doing it yourself. Use for summarizing, tagging, reformatting, classifying or checking many files - especially Obsidian vault notes - when the local-llm MCP tools are available.
---

The local-llm MCP server exposes a free model running on the user's own GPU. It costs no tokens and data never leaves the machine. It is also much weaker than you, so you stay the planner and the reviewer.

## When to delegate

Delegate when the job is **many small, low-stakes text transforms**:

- Tag, summarize or title a batch of notes.
- Find formatting problems, broken frontmatter, missing sections.
- Classify notes into folders, or extract fields (dates, people, links) into a list.
- Anything private the user does not want sent to a cloud model.

Do it yourself when the task needs judgement across files, multi-step reasoning, tool use, code changes, or when a single answer matters more than throughput.

## Tools

| Tool | Use |
|---|---|
| `local_llm_files` | One instruction applied to each file separately. The model reads the files, so their contents **never enter your context** - the main token saving. Vault-relative paths work. |
| `local_llm` | A single prompt, when you already have the text. |
| `local_llm_status` | Is the server up, which model is loaded. |

The server starts itself on first call and unloads after 5 minutes idle, so the first call can take ~20 s (Gemma) or over a minute (Qwen).

## Models

- `gemma-4-12b` (default) - fits fully on the GPU, ~45 tok/s. Use for almost everything.
- `qwen3.6-35b-a3b` - smarter, slower to load. Use when Gemma's answers are visibly wrong, or with `think: true` for harder classification.

Leave `think` off unless the task needs reasoning; it multiplies output length.

## Working pattern

1. List the target files yourself (Glob), then send them in batches of ~10-20 to `local_llm_files`.
2. Write a tight, explicit instruction with the exact output format you want (e.g. "3 lowercase tags, comma-separated, nothing else"). Small models follow format literally and drift when it is vague.
3. **Review the results before acting.** Spot-check a few against the files; discard answers that are obviously wrong or hallucinated.
4. Make the edits yourself. The tools are read-only on purpose.
5. Tell the user what was delegated, and anything you overrode.

## If the tools are missing

The MCP server is not registered in this config. Point the user at `local-llm/install.ps1` in their dotfiles repo. The raw endpoint is OpenAI-compatible at `http://127.0.0.1:8080/v1` if they only need a one-off call.
