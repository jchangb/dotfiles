# claude

A status line for [Claude Code](https://claude.com/claude-code): the 5-hour window,
the weekly window and the context window, each as a percentage, a coloured bar and a
countdown to reset.

```
5h  34% ━━━───── 2h40m │ 7d  72% ━━━━━━── 4d02h │ ctx  13% ━─────── 128k/1.0M
Opus 5 · xhigh · extraction-crawler · ⎇ main
```

Green under 70%, amber at 70, red at 90 — the same palette and bar glyphs as
[agtop](https://www.npmjs.com/package/@ldegio/agtop), so the two read as one tool.

## Install

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Add `-Narrow` for a third line if the panes are split vertically (see below).
The installer merges into every `settings.json` it finds, keeping the rest of the
file and leaving a `.bak` beside it. Start a new session to pick it up.

Requires `node` on PATH. Nothing else — no npm install, no dependencies.

## What it costs

Nothing measurable, and in particular no network. Claude Code 2.1.x passes the quota
numbers to the status line on stdin (`rate_limits.five_hour`, `rate_limits.seven_day`,
each with a `used_percentage` and an epoch `resets_at`) along with a `context_window`
block. Earlier status lines had to call `api.anthropic.com/api/oauth/usage` to get
this, which is why they were slow, or stale, or both.

The git branch is read straight out of `.git/HEAD` rather than by spawning git, which
matters when the whole render happens every 30 seconds.

## Three things that cost an afternoon to find out

**`CLAUDE_CONFIG_DIR` decides which `settings.json` is read.** If you launch through
wrapper functions that set it — one for work, one for personal — then `~/.claude/settings.json`
is *not* your config, and a status line placed there simply never appears. No warning
is printed. `install.ps1` patches every `.claude*` directory in `$HOME` for this reason.

**Without `refreshInterval` the countdowns freeze.** The status line re-runs on
conversation events only, so between turns the reset timers stop moving and the whole
thing looks broken. `refreshInterval` (seconds, undocumented but in the settings schema)
forces a re-run on a timer as well. The installer sets 30.

**A single-line status line truncates; it does not wrap.** Claude Code renders one line
with `wrap="truncate"` and only builds a real column when the output contains newlines.
So the answer to a narrow pane is more lines, never a longer one — hence `--narrow`,
which moves context onto its own row and keeps every row under ~50 columns:

```
5h  34% ━━━───── 2h40m │ 7d  72% ━━━━━━── 4d02h
ctx  13% ━─────── 128k/1.0M
Opus 5 · xhigh · extraction-crawler · ⎇ main
```

One consequence worth knowing if you edit the script: Claude Code prepends each line
with the ANSI codes accumulated from the lines above it, so a line that leaves a colour
span open bleeds into the next. Every line here terminates its own colour.

## Settings written

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"Z:/dev/repo/dotfiles/claude/statusline.js\"",
    "refreshInterval": 30
  }
}
```

`padding` is not written: it already defaults to `0`.

The script keeps one small file per config directory,
`$CLAUDE_CONFIG_DIR/statusline-cache.json`, holding the last quota figures it saw.
`rate_limits` only arrives after a session's first API response, so without the cache
both bars would be blank at the top of every session; with it they redraw the last
known value marked `~` until the real numbers land. It is per-directory on purpose —
work and personal have separate quotas and must not share a cache.
