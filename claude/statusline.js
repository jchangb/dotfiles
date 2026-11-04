#!/usr/bin/env node
"use strict";

// Claude Code status line: 5h window, 7d window, context — bars in agtop's palette.
//
// Everything drawn for this session arrives on stdin from Claude Code itself (2.1.x):
// the rate_limits block is authoritative and needs no API call. When a window is
// missing (the payload only carries rate_limits after the session's first API
// response) the last seen value is redrawn with a "~" so the bar does not blink out
// mid-conversation.
//
// Several accounts can share one config dir (a stored login plus setup-token
// launchers). List them in statusline.json beside settings.json and each gets a
// named row, this session's first:
//
//   { "accounts": [
//       { "name": "work", "credentials": "~/.claude/.credentials.json" },
//       { "name": "work-alt", "envFile": "~/.config/claude-accounts/alt.env" } ] }
//
// CLAUDE_ACCOUNT names this session's account; unset, it is the stored login's. The
// other rows come from the cache, which every session of an account feeds with what
// it sees. When one goes stale, a detached copy of this script spends a 1-token
// request on that account to read its rate-limit headers, so the render itself never
// touches the network. Without statusline.json nothing is probed.
//
// A LiteLLM proxy key bills a budget per period instead of 5h/7d windows. List it as
//   { "name": "itx-litellm", "litellm": "~/.config/iop/cuenta-alt.env" }
// (the env file sets ANTHROPIC_AUTH_TOKEN and ANTHROPIC_BASE_URL) and it gets one row:
// the period's share of the cap, the reset countdown, the dollars, then the tier (team,
// model group, rate limits), read from the proxy's /key/info every 5 minutes. A session
// launched against a proxy (ANTHROPIC_BASE_URL set) has no rate_limits: it writes no
// windows and takes the LiteLLM row as its own.
//
// A GitHub Copilot seat's monthly AI credits get the same kind of row with
//   { "name": "itx-copilot", "copilot": true }
// read every 5 minutes through the gh login, in dollars, with the Inditex tier.
//
// The render never shells out. The diff against the remote cannot be read off disk, so
// it is also left to a detached probe and cached: on a 9p mount (/mnt/c under WSL) it
// takes about a second, which is longer than the whole render is allowed to take.
//
// Output is multi-line on purpose. Claude Code renders a one-line status with
// wrap:"truncate" and only splits into a column when the text contains newlines,
// so in a narrow pane extra lines are the only way to keep anything readable.
// Pass --narrow to spend a third line and keep every row under ~50 columns.

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");

const NARROW = process.argv.includes("--narrow");
const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const CACHE = path.join(CONFIG_DIR, "statusline-cache.json");
const ACCOUNTS = path.join(CONFIG_DIR, "statusline.json");
const DRIFT = path.join(CONFIG_DIR, "statusline-drift.json");
const PROBE_EVERY_MS = 120_000;
const BUDGET_EVERY_MS = 300_000;
// Under the 30 s refreshInterval, so every timed render starts a probe and the next one
// shows its answer; a minute is then two refreshes of margin before a reading is dropped.
const DRIFT_EVERY_MS = 25_000;
const DRIFT_FRESH_MS = 60_000;
const DRIFT_TIMEOUT_MS = 5_000;
const PROBE_MODEL = "claude-haiku-5-5";
// The model group every Inditex developer key gets; any other is worth showing.
const EVERYDAY_MODELS = "developer-models";
const TIER_NEWS_MS = 7 * 86_400_000;
// Enough for the team and a little more: as the session's own row it shares a line with
// ctx, and the two must fit in about 100 columns.
const TIER_W = 21;

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
  account: "\x1b[1;38;5;180m",
  news: "\x1b[1;38;5;114m",  // bold green, a tier that changed this week
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

// padTo keeps the separators of stacked account rows in one column.
function quota(label, w, stale, padTo = 0) {
  const pct = w ? Math.round(w.used_percentage ?? 0) : 0;
  const color = w ? tone(pct) : C.dim;
  const figure = w ? `${String(pct).padStart(3)}%` : "  --";
  const mark = w && stale ? `${C.dim}~${R}` : " ";
  const left = (w ? countdown(w.resets_at) : "").padEnd(padTo);
  return `${C.label}${label}${R} ${color}${figure}${R}${mark}${bar(pct, color)}` +
    (left ? ` ${C.dim}${left}${R}` : "");
}

const usd = (n) => "$" + (Number.isInteger(n) || n >= 100 ? String(Math.round(n)) : n.toFixed(2));

// A budget in the same columns as a 5h/7d row: the period's share of the cap and its
// reset countdown, then the dollars, then a warning once the key has less than a week
// to live. An error reads as itself.
function budget(e, stale, padTo) {
  const keyLeft = e.expires ? e.expires * 1000 - Date.now() : Infinity;
  if (keyLeft <= 0) return `${C.red}key expired${R}`;
  if (e.error) return `${C.dim}${/^\d+$/.test(e.error) ? `HTTP ${e.error}` : e.error}${R}`;
  const period = e.period || "mo";
  let out;
  if (e.spend == null) {
    out = quota(period, null, false, padTo);
  } else if (e.max_budget == null) {
    const left = countdown(e.budget_reset_at);
    out = `${C.label}${period}${R} ${C.dim}${usd(e.spend)}${stale ? "~" : ""}${left ? ` ${left}` : ""}${R}`;
  } else {
    const pct = e.max_budget > 0 ? (e.spend / e.max_budget) * 100 : 100;
    out = quota(period, { used_percentage: pct, resets_at: e.budget_reset_at }, stale, padTo) +
      SEP + `${C.dim}${usd(e.spend)}/${usd(e.max_budget)}${R}`;
  }
  const t = tier(e);
  if (t) out += SEP + t;
  if (keyLeft < 7 * 86_400_000) {
    const days = Math.floor(keyLeft / 86_400_000);
    out += SEP + `${C.amber}key ${days >= 1 ? `${days}d` : countdown(e.expires)}${R}`;
  }
  return out;
}

// What the proxy files the key under: its team, its model group where that is not the
// everyday one, and any rate limits. Nothing there is literally called a tier, so this is
// the closest reading. For a week after any of it or the cap changes it is drawn bold
// green with an ↑, which is how a promotion for spending the budget would show.
function tier(e) {
  const parts = [];
  if (e.tag) parts.push(e.tag);
  if (e.team_id) parts.push(e.team_id);
  const models = Array.isArray(e.models) ? e.models : [];
  if (models.length && !(models.length === 1 && models[0] === EVERYDAY_MODELS)) {
    parts.push(models.map((m) => m.replace(/-models$/, "")).join("+"));
  }
  if (e.tpm_limit != null) parts.push(`${tokens(e.tpm_limit)}tpm`);
  if (e.rpm_limit != null) parts.push(`${e.rpm_limit}rpm`);
  let tag = parts.join(" ");
  if (!tag) return "";
  if (tag.length > TIER_W) tag = `${tag.slice(0, TIER_W - 1)}…`;
  if (Date.now() - (e.tier_changed || 0) < TIER_NEWS_MS) return `${C.news}↑ ${tag}${R}`;
  return `${C.dim}${tag}${R}`;
}

// Everything that makes up a tier, the cap included, in one comparable string.
const tierPrint = (r) => JSON.stringify([r.team_id, [...(r.models || [])].sort(), r.max_budget,
  r.tpm_limit, r.rpm_limit, r.max_parallel_requests].concat(r.tag ? [r.tag] : []));

// Where a directory's repo starts, its branch and the commit it is on, all read straight
// off disk: spawning git would cost more than the whole render.
function repoOf(dir) {
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
        const ref = /^ref:\s*(refs\/heads\/(.+))$/.exec(head);
        if (!ref) return { top: d, branch: head.slice(0, 7), sha: head };
        return { top: d, branch: ref[2], sha: shaOf(gitDir, ref[1]) };
      }
      const up = path.dirname(d);
      if (up === d) break;
      d = up;
    }
  } catch { /* not a repo, or unreadable */ }
  return null;
}

// A branch's commit: its loose ref, else its line in packed-refs. A linked worktree keeps
// its branches in the main repo's git dir, which its `commondir` names. Empty on a branch
// with no commits yet.
function shaOf(gitDir, ref) {
  let common = gitDir;
  try {
    common = path.resolve(gitDir, fs.readFileSync(path.join(gitDir, "commondir"), "utf8").trim());
  } catch { /* not a linked worktree */ }
  try {
    return fs.readFileSync(path.join(common, ref), "utf8").trim();
  } catch { /* packed */ }
  try {
    const packed = fs.readFileSync(path.join(common, "packed-refs"), "utf8");
    const line = packed.split("\n").find((l) => l.endsWith(` ${ref}`));
    return line ? line.slice(0, line.indexOf(" ")) : "";
  } catch {
    return "";
  }
}

// One reading per commit of a branch of a checkout: a new commit, a switch or another
// worktree is a new key, so a stale count is never shown against the wrong thing.
const driftKey = (repo) => [repo.top, repo.branch, repo.sha].join("\n");

// Drift has its own file rather than a key in the usage cache: its writers never race
// the account rows, and an older copy of this script rewriting that cache cannot drop it.
// Readings past their freshness are pruned on every write, so it never grows.
function patchDrift(key, change) {
  const all = readJson(DRIFT) || {};
  const now = Date.now();
  for (const [k, e] of Object.entries(all)) {
    if (now - Math.max(e.at || 0, e.tried || 0) > DRIFT_FRESH_MS) delete all[k];
  }
  all[key] = { ...all[key], ...change };
  writeJson(DRIFT, all);
}

// How far this working tree is from what is on the remote — **unpushed commits and
// uncommitted edits in one number**, which is what `git diff @{upstream}` means and what
// GitHub would show you were you to open a compare. Falls back to the working tree against
// HEAD where there is no upstream (a local prototype, a detached head), which is the same
// question with the only answer available.
//
// Run detached, never by the render. A timeout records no counts rather than falling
// back: the HEAD diff would quietly answer a different question.
function probeDrift(top, branch, sha) {
  const shortstat = (against) => spawnSync("git", ["diff", "--shortstat", against], {
    cwd: top, encoding: "utf8", timeout: DRIFT_TIMEOUT_MS, windowsHide: true,
  });
  let r = shortstat("@{upstream}");
  if (r.status !== 0 && !r.error && !r.signal) r = shortstat("HEAD");
  const out = r.status === 0 ? r.stdout : "";
  const count = (re) => Number((re.exec(out) || [])[1]) || 0;
  patchDrift(driftKey({ top, branch, sha }), {
    plus: count(/(\d+) insertions?\(\+\)/),
    minus: count(/(\d+) deletions?\(-\)/),
    at: Date.now(),
  });
}

// What the last probe for this exact commit found, if it is fresh; starting the next
// probe when none has been started for it lately.
function driftOf(repo) {
  const key = driftKey(repo);
  const e = (readJson(DRIFT) || {})[key] || {};
  const now = Date.now();
  if (now - (e.tried || 0) >= DRIFT_EVERY_MS) {
    patchDrift(key, { tried: now });
    spawn(process.execPath, [__filename, "--drift", repo.top, repo.branch, repo.sha], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
  }
  if (now - (e.at || 0) > DRIFT_FRESH_MS) return "";
  const parts = [];
  if (e.plus) parts.push(`${C.plus}+${e.plus}${R}`);
  if (e.minus) parts.push(`${C.minus}−${e.minus}${R}`);
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

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// Every session and probe writes the caches, so each read-modify-write stays tight and
// the write lands by rename: a reader never sees half a file.
function writeJson(file, data) {
  const tmp = `${file}.${process.pid}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* cache is a nicety, never a failure */ }
  }
}

const readCache = () => (readJson(CACHE) || {}).accounts || {};

function patchCache(change) {
  const cache = readCache();
  if (change(cache) === false) return;
  writeJson(CACHE, { accounts: cache });
}

const reading = (w) => w && {
  used_percentage: w.used_percentage ?? 0,
  resets_at: w.resets_at > 1e12 ? Math.floor(w.resets_at / 1000) : w.resets_at || 0,
};

// Usage only climbs inside a window, so of two readings the later window wins, or in
// the same window the higher figure. No clocks have to agree, and a session idling on
// an old snapshot can never overwrite a fresher one.
function newer(a, b) {
  if (!a || !b) return a || b;
  if (Math.abs(a.resets_at - b.resets_at) > 60) return a.resets_at > b.resets_at ? a : b;
  return b.used_percentage > a.used_percentage ? b : a;
}

// Who a row's windows belong to. After a /login to another account the row keeps its
// name, and the old account's later window would win newer() until it resets.
function ownerOf(account) {
  try {
    if (account && account.credentials) {
      const dir = path.dirname(expandHome(account.credentials));
      const file = dir === path.join(os.homedir(), ".claude") ? path.join(os.homedir(), ".claude.json") : path.join(dir, ".claude.json");
      return ((readJson(file) || {}).oauthAccount || {}).accountUuid || "";
    }
    if (account && account.envFile) {
      const token = envValue(account.envFile, "CLAUDE_CODE_OAUTH_TOKEN");
      return token ? crypto.createHash("sha256").update(token).digest("hex").slice(0, 12) : "";
    }
  } catch { /* unknown owner: keep what is cached */ }
  return "";
}

const ownedBy = (entry, who) => (!entry || (who && entry.who && entry.who !== who) ? {} : entry);

function loadAccounts() {
  const list = (readJson(ACCOUNTS) || {}).accounts;
  return Array.isArray(list) ? list.filter((a) => a && a.name) : [];
}

const isBudget = (account) => Boolean(account && account.litellm);
const isCopilot = (account) => Boolean(account && account.copilot);
const probeEvery = (account) => (isBudget(account) || isCopilot(account) ? BUDGET_EVERY_MS : PROBE_EVERY_MS);

// A label the list does not know (a session launched before a rename) is ignored, so
// it never adds a row of its own.
function currentAccount(accounts) {
  const named = process.env.CLAUDE_ACCOUNT;
  if (named && (!accounts.length || accounts.some((a) => a.name === named))) return named;
  if (process.env.ANTHROPIC_BASE_URL) return (accounts.find(isBudget) || { name: "" }).name;
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return "";
  const stored = accounts.find((a) => a.credentials);
  return stored ? stored.name : "";
}

const expandHome = (p) => p.replace(/^~(?=$|[\\/])/, os.homedir());

// The last assignment wins, as when the shell sources the file.
function envValue(file, name) {
  const env = fs.readFileSync(expandHome(file), "utf8");
  const re = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${name}=[ \\t]*(?:'([^']*)'|"([^"]*)"|([^\\s#]*))`, "gm");
  let value = "";
  for (const m of env.matchAll(re)) value = (m[1] ?? m[2] ?? m[3] ?? "").trim();
  return value;
}

function tokenOf(account) {
  let token;
  if (account.credentials) {
    const oauth = (readJson(expandHome(account.credentials)) || {}).claudeAiOauth || {};
    if (oauth.expiresAt < Date.now()) throw new Error("login expired");
    token = oauth.accessToken;
  } else {
    token = envValue(account.envFile, "CLAUDE_CODE_OAUTH_TOKEN");
  }
  if (!token) throw new Error("no token");
  return token;
}

// /key/info reports the key's spend, cap and reset without spending anything. Errors
// are stored as the row should read them: no key, no url, offline, or the HTTP status.
async function probeBudget(account) {
  let result;
  try {
    let token, base;
    try {
      token = envValue(account.litellm, "ANTHROPIC_AUTH_TOKEN");
      base = envValue(account.litellm, "ANTHROPIC_BASE_URL").replace(/\/+$/, "");
    } catch {
      throw new Error("no key");
    }
    if (!token.startsWith("sk-")) throw new Error("no key");
    if (!/^https?:\/\/[^<>\s]+$/.test(base)) throw new Error("no url");
    let res;
    try {
      res = await fetch(`${base}/key/info`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      throw new Error("offline");
    }
    if (!res.ok) throw new Error(String(res.status));
    const body = await res.json();
    const info = body.info || body;
    // budget_duration holds: the Inditex key reports "2d" and its budget did reset on
    // 1, 3 and 5 Nov 2026, not monthly. Keys expire about monthly and must be regenerated.
    // Picked field by field: the key and its name are never written to the cache.
    const limit = (n) => (n == null ? null : Number(n));
    result = {
      spend: Number(info.spend) || 0,
      max_budget: limit(info.max_budget),
      budget_reset_at: epoch(info.budget_reset_at),
      period: periodOf(info.budget_duration),
      expires: epoch(info.expires),
      team_id: typeof info.team_id === "string" ? info.team_id.slice(0, 24) : null,
      models: Array.isArray(info.models) ? info.models.filter((m) => typeof m === "string").slice(0, 8) : [],
      tpm_limit: limit(info.tpm_limit),
      rpm_limit: limit(info.rpm_limit),
      max_parallel_requests: limit(info.max_parallel_requests),
    };
  } catch (e) {
    result = { error: String(e && e.message).slice(0, 20) };
  }
  saveBudget(account, result);
}

// The seat's premium credits, from the endpoint the editors read their own quota from
// (undocumented), through gh so no token is handled here. A credit is a cent. Inditex
// sets the entitlement by tier: $500 at T0 and $500 more per tier, plus a $100 margin.
async function probeCopilot(account) {
  let result;
  try {
    // Detached, so a slow gh (30 s on the VPN at times) costs the render nothing.
    const out = spawnSync("gh", ["api", "/copilot_internal/user"], { encoding: "utf8", timeout: 60_000, windowsHide: true });
    if (out.error) throw new Error(out.error.code === "ENOENT" ? "no gh" : "offline");
    if (out.status !== 0) throw new Error("gh failed");
    const user = JSON.parse(out.stdout);
    const q = (user.quota_snapshots || {}).premium_interactions;
    if (!q) throw new Error("no quota");
    const cap = q.entitlement / 100;
    const step = (cap - 600) / 500;
    result = {
      spend: Math.max(0, q.entitlement - q.remaining) / 100,
      max_budget: q.unlimited ? null : cap,
      budget_reset_at: epoch(user.quota_reset_date_utc),
      period: "mo",
      tag: Number.isInteger(step) && step >= 0 && step <= 3 ? `T${step}` : null,
    };
  } catch (e) {
    result = { error: String(e && e.message).slice(0, 20) };
  }
  saveBudget(account, result);
}

// The last tier seen outlives an error, so a change across one is still caught. The
// first one ever seen is not news.
function saveBudget(account, result) {
  patchCache((cache) => {
    const was = cache[account.name] || {};
    const now = Date.now();
    const print = result.error ? was.tier : tierPrint(result);
    const changed = Boolean(was.tier) && print !== was.tier;
    cache[account.name] = { ...result, at: now, tier: print, tier_changed: changed ? now : was.tier_changed };
  });
}

function epoch(iso) {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

// A budget_duration ("2d", "30d", "1mo") as a window label: a month or more reads "mo",
// anything shorter as itself.
function periodOf(duration) {
  const m = /^(\d+)\s*(mo|[smhd])$/.exec(String(duration || "").trim());
  if (!m) return "mo";
  const days = m[2] === "mo" ? 30 * m[1] : m[2] === "d" ? Number(m[1]) : 0;
  return days >= 28 ? "mo" : `${m[1]}${m[2]}`;
}

async function probe(name) {
  const account = loadAccounts().find((a) => a.name === name);
  if (isBudget(account)) return probeBudget(account);
  if (isCopilot(account)) return probeCopilot(account);
  let result;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: {
        authorization: `Bearer ${tokenOf(account)}`,
        "anthropic-beta": "oauth-2025-04-20",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: PROBE_MODEL,
        max_tokens: 1,
        // Subscription tokens are only served to requests that identify as Claude Code.
        system: "You are Claude Code, Anthropic's official CLI for Claude.",
        messages: [{ role: "user", content: "." }],
      }),
    });
    const header = (win, field) => res.headers.get(`anthropic-ratelimit-unified-${win}-${field}`);
    if (header("5h", "utilization") == null) throw new Error(`HTTP ${res.status}`);
    const windowOf = (win) => ({
      used_percentage: Math.round(header(win, "utilization") * 1000) / 10,
      resets_at: Number(header(win, "reset")) || 0,
    });
    result = { five_hour: windowOf("5h"), seven_day: windowOf("7d") };
  } catch (e) {
    result = { error: String(e && e.message).slice(0, 40) };
  }
  const who = ownerOf(account);
  patchCache((cache) => {
    const was = ownedBy(cache[name], who);
    cache[name] = result.error ? { ...was, error: result.error } : {
      five_hour: newer(was.five_hour, result.five_hour),
      seven_day: newer(was.seven_day, result.seven_day),
      at: Date.now(),
      who: who || was.who,
    };
  });
}

function probeIfStale(account, entry) {
  const now = Date.now();
  if (!account.credentials && !account.envFile && !account.litellm && !account.copilot) return;
  if (now - Math.max(entry.at || 0, entry.tried || 0) < probeEvery(account)) return;
  patchCache((cache) => { cache[account.name] = { ...cache[account.name], tried: now }; });
  spawn(process.execPath, [__filename, "--probe", account.name], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
}

function render(d) {
  // This session's windows, folded into what every other session of the account saw.
  // A session on a proxy has no subscription windows and must never write any.
  const accounts = loadAccounts();
  const mine = currentAccount(accounts);
  const mineBudget = accounts.find((a) => a.name === mine && isBudget(a));
  const onProxy = Boolean(process.env.ANTHROPIC_BASE_URL || mineBudget);
  const live = (!onProxy && d.rate_limits) || {};
  const who = mineBudget ? "" : ownerOf(accounts.find((a) => a.name === mine));
  if (live.five_hour || live.seven_day) {
    patchCache((cache) => {
      const was = ownedBy(cache[mine], who);
      const five = newer(was.five_hour, reading(live.five_hour));
      const seven = newer(was.seven_day, reading(live.seven_day));
      if (five === was.five_hour && seven === was.seven_day && (!who || was.who === who)) return false;
      cache[mine] = { five_hour: five, seven_day: seven, at: Date.now(), who: who || was.who };
    });
  }
  const cache = readCache();
  const own = ownedBy(cache[mine], who);
  const others = accounts.filter((a) => a.name !== mine);
  // No session feeds a budget row, so this session's own one is probed too.
  others.concat(mineBudget || []).forEach((a) => probeIfStale(a, cache[a.name] || {}));

  const width = Math.max(mine.length, ...others.map((a) => a.name.length));
  const pad = others.length ? 6 : 0;
  const lead = (name, color) => (width ? `${color}${name.padEnd(width)}${R} ` : "");
  const row = (name, color, five, seven, stale5, stale7) =>
    lead(name, color) + quota("5h", five, stale5, pad) + SEP + quota("7d", seven, stale7);
  const budgetRow = (a, color) => {
    const e = cache[a.name] || {};
    return lead(a.name, color) + budget(e, Date.now() - (e.at || 0) > 2 * BUDGET_EVERY_MS, pad);
  };
  const rows = [mineBudget ? budgetRow(mineBudget, C.account) : row(mine, C.account,
    newer(reading(live.five_hour), own.five_hour), newer(reading(live.seven_day), own.seven_day),
    !live.five_hour, !live.seven_day)];
  for (const a of others) {
    if (isBudget(a) || isCopilot(a)) {
      rows.push(budgetRow(a, C.dim));
      continue;
    }
    const e = ownedBy(cache[a.name], ownerOf(a));
    const stale = Boolean(e.error) || Date.now() - (e.at || 0) > 2 * PROBE_EVERY_MS;
    rows.push(row(a.name, C.dim, e.five_hour, e.seven_day, stale, stale));
  }

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
  const repo = repoOf(ws.current_dir || d.cwd || process.cwd());
  // Joined to the branch rather than given a field of its own: the counts are *about* that
  // branch, and a `·` between them would read as a fourth unrelated thing.
  if (repo) {
    const drift = driftOf(repo);
    tail.push(`${C.dim}⎇ ${repo.branch}${R}${drift ? ` ${drift}` : ""}`);
  }

  const lines = NARROW
    ? [...rows, ctx, tail.join(DOT)]
    : [[rows[0]].concat(ctx || []).join(SEP), ...rows.slice(1), tail.join(DOT)];
  return lines.filter(Boolean);
}

function main() {
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
}

const probing = process.argv.indexOf("--probe");
const drifting = process.argv.indexOf("--drift");
if (probing !== -1) probe(process.argv[probing + 1]);
else if (drifting !== -1) probeDrift(...process.argv.slice(drifting + 1, drifting + 4));
else main();
