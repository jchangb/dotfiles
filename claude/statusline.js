#!/usr/bin/env node
"use strict";

// Claude Code status line: 5h window, 7d window, context — bars in agtop's palette.
//
// Everything drawn here arrives on stdin from Claude Code itself (2.1.x): the
// rate_limits block is authoritative and needs no API call, so this script never
// touches the network. When a window is missing (the payload only carries
// rate_limits after the session's first API response) the last seen value is
// redrawn with a "~" so the bar does not blink out mid-conversation.
//
// The one thing it does shell out for is the diff against the remote, because
// there is no reading that off disk. It is bounded by a timeout and rendered at
// most every `refreshInterval` seconds; measured at 29 ms on a repo of this size.
//
// Output is multi-line on purpose. Claude Code renders a one-line status with
// wrap:"truncate" and only splits into a column when the text contains newlines,
// so in a narrow pane extra lines are the only way to keep anything readable.
// Pass --narrow to spend a third line and keep every row under ~50 columns.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

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
  // GitHub's two, and the same hues the bars already use. The minus is the bar's
  // red without the bold: a count of deleted lines is not an alarm.
  plus: "\x1b[38;5;114m",
  minus: "\x1b[38;5;203m",
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

// How far this working tree is from what is on the remote — **unpushed commits and
// uncommitted edits in one number**, which is what `git diff @{upstream}` means and what
// GitHub would show you were you to open a compare. Falls back to the working tree against
// HEAD where there is no upstream (a local prototype, a detached head), which is the same
// question with the only answer available.
//
// Bounded rather than trusted: a repo big enough to make this slow is exactly the repo
// where a blocked status line would be noticed, so a timeout draws nothing instead.
function diffStat(dir) {
  const shortstat = (against) => {
    try {
      const r = spawnSync("git", ["diff", "--shortstat", against], {
        cwd: dir, encoding: "utf8", timeout: 400, windowsHide: true,
      });
      return r.status === 0 ? r.stdout : null;
    } catch {
      return null;
    }
  };
  const out = shortstat("@{upstream}") ?? shortstat("HEAD");
  if (!out) return "";
  const plus = /(\d+) insertions?\(\+\)/.exec(out);
  const minus = /(\d+) deletions?\(-\)/.exec(out);
  const parts = [];
  if (plus) parts.push(`${C.plus}+${plus[1]}${R}`);
  if (minus) parts.push(`${C.minus}−${minus[1]}${R}`);
  // Nothing at all when there is nothing to say: a clean tree is the ordinary state, and
  // "+0 −0" is a row of noise you would learn to stop reading.
  return parts.join(" ");
}

// Which of the machine's Claude profiles this session belongs to, as a single letter.
// The wrapper functions that split work from personal do it by pointing
// CLAUDE_CONFIG_DIR at ~/.claude-work or ~/.claude-personal, so the directory's own
// name already holds the answer and nothing here needs configuring. A machine that
// runs one profile never sets the variable, lands on plain ~/.claude, and gets no
// letter — which is the point: there is nothing to switch off over there.
function profileMark() {
  const m = /^\.?claude-(.+)$/i.exec(path.basename(CONFIG_DIR));
  return m ? m[1][0].toUpperCase() : "";
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

  // Who and where: profile, model, effort, directory, branch.
  const tail = [];
  const mark = profileMark();
  if (mark) tail.push(`${C.dim}${mark}${R}`);
  const model = d.model && d.model.display_name;
  if (model) tail.push(`${C.model}${model}${R}`);
  if (d.effort && d.effort.level) tail.push(`${C.dim}${d.effort.level}${R}`);
  const ws = d.workspace || {};
  const dir = (d.worktree && d.worktree.name) || path.basename(ws.current_dir || d.cwd || "");
  if (dir) tail.push(`${C.dir}${dir}${R}`);
  const here = ws.current_dir || d.cwd || process.cwd();
  const branch = branchOf(here);
  // Joined to the branch rather than given a field of its own: the counts are *about* that
  // branch, and a `·` between them would read as a fourth unrelated thing.
  if (branch) {
    const drift = diffStat(here);
    tail.push(`${C.dim}⎇ ${branch}${R}${drift ? ` ${drift}` : ""}`);
  }

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
