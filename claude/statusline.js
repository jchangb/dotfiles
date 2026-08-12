#!/usr/bin/env node
"use strict";

// Claude Code status line: 5h window, 7d window, context — bars in agtop's palette.
//
// Everything drawn here arrives on stdin from Claude Code itself (2.1.x): the
// rate_limits block is authoritative and needs no API call, so this script never
// touches the network and never blocks. When a window is missing (the payload
// only carries rate_limits after the session's first API response) the last seen
// value is redrawn with a "~" so the bar does not blink out mid-conversation.
//
// Output is multi-line on purpose. Claude Code renders a one-line status with
// wrap:"truncate" and only splits into a column when the text contains newlines,
// so in a narrow pane extra lines are the only way to keep anything readable.
// Pass --narrow to spend a third line and keep every row under ~50 columns.

const fs = require("fs");
const path = require("path");
const os = require("os");

const NARROW = process.argv.includes("--narrow");
const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const CACHE = path.join(CONFIG_DIR, "statusline-cache.json");

const R = "\x1b[0m";
const C = {
  label: "\x1b[1;38;5;75m",  // bold blue, agtop's field label
  dim: "\x1b[38;5;245m",     // gray
  track: "\x1b[38;5;238m",   // unfilled bar
  green: "\x1b[38;5;114m",
  amber: "\x1b[38;5;221m",
  red: "\x1b[1;38;5;203m",
  model: "\x1b[38;5;180m",
  dir: "\x1b[38;5;110m",
};

const BAR_W = 8;
const SEP = ` ${C.track}│${R} `;
const DOT = ` ${C.track}·${R} `;

const tone = (pct) => (pct >= 90 ? C.red : pct >= 70 ? C.amber : C.green);

function bar(pct, color) {
  const filled = Math.max(0, Math.min(BAR_W, Math.round((pct / 100) * BAR_W)));
  return color + "━".repeat(filled) + C.track + "─".repeat(BAR_W - filled) + R;
}

// "2h41m" under a day, "4d03h" over one — always the two largest units.
function countdown(resetsAt) {
  if (!resetsAt) return "";
  const ms = (resetsAt > 1e12 ? resetsAt : resetsAt * 1000) - Date.now();
  if (ms <= 0) return "now";
  const mins = Math.floor(ms / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d${String(h).padStart(2, "0")}h`;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}

function tokens(n) {
  if (!n) return "0";
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

function quota(label, w, stale) {
  if (!w) return `${C.dim}${label}   --${R}`;
  const pct = Math.round(w.used_percentage ?? 0);
  const color = tone(pct);
  const mark = stale ? `${C.dim}~${R}` : " ";
  const left = countdown(w.resets_at);
  return `${C.label}${label}${R} ${color}${String(pct).padStart(3)}%${R}${mark}${bar(pct, color)}` +
    (left ? ` ${C.dim}${left}${R}` : "");
}

// Read HEAD straight off disk; spawning git would cost more than the whole render.
function branchOf(dir) {
  try {
    let d = path.resolve(dir);
    for (let i = 0; i < 16; i++) {
      const dot = path.join(d, ".git");
      if (fs.existsSync(dot)) {
        let gitDir = dot;
        if (fs.statSync(dot).isFile()) {
          const m = /gitdir:\s*(.+)/.exec(fs.readFileSync(dot, "utf8"));
          if (!m) return null;
          gitDir = path.resolve(d, m[1].trim());
        }
        const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
        const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
        return ref ? ref[1] : head.slice(0, 7);
      }
      const up = path.dirname(d);
      if (up === d) break;
      d = up;
    }
  } catch { /* not a repo, or unreadable */ }
  return null;
}

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE, "utf8"));
  } catch {
    return {};
  }
}

function writeCache(obj) {
  try {
    fs.writeFileSync(CACHE, JSON.stringify(obj));
  } catch { /* cache is a nicety, never a failure */ }
}

function render(d) {
  // The two subscription windows, falling back to the last values we saw.
  const cache = readCache();
  const live = d.rate_limits || {};
  const five = live.five_hour || cache.five_hour;
  const seven = live.seven_day || cache.seven_day;
  if (live.five_hour || live.seven_day) {
    writeCache({
      five_hour: live.five_hour || cache.five_hour,
      seven_day: live.seven_day || cache.seven_day,
    });
  }
  const limits = [quota("5h", five, !live.five_hour), quota("7d", seven, !live.seven_day)];

  // Context, as a share of this model's window.
  const cw = d.context_window;
  let ctx = null;
  if (cw && cw.used_percentage != null) {
    const pct = Math.round(cw.used_percentage);
    const color = tone(pct);
    ctx = `${C.label}ctx${R} ${color}${String(pct).padStart(3)}%${R} ${bar(pct, color)} ` +
      `${C.dim}${tokens(cw.total_input_tokens)}/${tokens(cw.context_window_size)}${R}`;
  }

  // Who and where: model, effort, directory, branch.
  const tail = [];
  const model = d.model && d.model.display_name;
  if (model) tail.push(`${C.model}${model}${R}`);
  if (d.effort && d.effort.level) tail.push(`${C.dim}${d.effort.level}${R}`);
  const ws = d.workspace || {};
  const dir = (d.worktree && d.worktree.name) || path.basename(ws.current_dir || d.cwd || "");
  if (dir) tail.push(`${C.dir}${dir}${R}`);
  const branch = branchOf(ws.current_dir || d.cwd || process.cwd());
  if (branch) tail.push(`${C.dim}⎇ ${branch}${R}`);

  const lines = NARROW
    ? [limits.join(SEP), ctx, tail.join(DOT)]
    : [limits.concat(ctx || []).join(SEP), tail.join(DOT)];
  return lines.filter(Boolean);
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let lines;
  try {
    lines = render(JSON.parse(raw));
  } catch (e) {
    lines = [`${C.dim}statusline: ${String(e && e.message).slice(0, 60)}${R}`];
  }
  // Every line self-terminates its colour: Claude Code prepends each line with the
  // escape codes accumulated from the ones above it, so an unclosed span would bleed.
  process.stdout.write(lines.map((l) => l + R).join("\n") + "\n");
});
