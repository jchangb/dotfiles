# claude

A status line for [Claude Code](https://claude.com/claude-code): the 5-hour window,
the weekly window and the context window, each as a percentage, a coloured bar and a
countdown to reset.

```
5h  34% ━━━───── 2h40m │ 7d  72% ━━━━━━── 4d02h │ ctx  13% ━─────── 128k/1.0M
W · Opus 5 · xhigh · extraction-crawler · ⎇ main
```

Green under 70%, amber at 70, red at 90 — the same palette and bar glyphs as
[agtop](https://www.npmjs.com/package/@ldegio/agtop), so the two read as one tool.

The letter opening the second line names the Claude profile the session was launched
under: `W` for `~/.claude-work`, `P` for `~/.claude-personal` — the first letter of
whatever follows `claude-` in `CLAUDE_CONFIG_DIR`, so a third profile needs no code.
A machine that runs a single profile never sets that variable, lands on plain
`~/.claude`, and gets no letter at all. That is why the same script serves both kinds
of machine with nothing to configure on either.

## Install

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Add `-Narrow` for a third line if the panes are split vertically (see below).
The installer merges into every `settings.json` it finds, keeping the rest of the
file and leaving a `.bak` beside it. Start a new session to pick it up.

Requires `node` on PATH. Nothing else — no npm install, no dependencies.

## Several accounts

When more than one account shares a config directory (a stored login plus launchers
that set `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`), list them in
`statusline.json` beside `settings.json` and each gets a named row, this session's first:

```json
{
  "accounts": [
    { "name": "work", "credentials": "~/.claude/.credentials.json" },
    { "name": "work-alt", "envFile": "~/.config/claude-accounts/alt.env" }
  ]
}
```

```
work     5h  34% ━━━───── 2h40m  │ 7d  72% ━━━━━━── 4d02h │ ctx  13% ━─────── 128k/1.0M
work-alt 5h   2% ──────── 4h10m  │ 7d  20% ━━────── 6d01h
Opus 5 · xhigh · extraction-crawler · ⎇ main
```

The names live only there and in the launchers, never in the script, so the same
`statusline.js` serves every machine and profile. `CLAUDE_ACCOUNT` in the environment
names the session's account (set it in each launcher); unset, or naming an account the
list does not have (a session launched before a rename), the session is taken to be on
the account with `credentials`, the stored login. With no `statusline.json` the
output is the single unnamed row above, and if `CLAUDE_ACCOUNT` is set it is named.

Account rows and the profile letter answer different questions and never replace each
other. The letter names the config directory, the rows name the logins inside it, and
each profile reads its own `statusline.json`. The example above has no letter because
its launchers all share plain `~/.claude`. A `~/.claude-work` with an account list
shows both: `W` opening the last line, `work` and `work-alt` opening the rows above it.

The other rows are fed two ways. Every session writes what it sees for its own account
into the shared cache, so two open sessions on two accounts see each other for free.
When a row has had nothing new for two minutes, the status line starts a detached copy
of itself that sends a 1-token Haiku request on that account and reads the
`anthropic-ratelimit-unified-*` headers. That is the only network call, and it never
runs inside the render. (`/api/oauth/usage` would cost nothing, but a setup-token lacks
the `user:profile` scope it needs and gets a 403.) A row that could not be refreshed
keeps its last figures, marked `~`.

### A LiteLLM budget

A LiteLLM proxy key (Anthropic-compatible, set through `ANTHROPIC_AUTH_TOKEN` and
`ANTHROPIC_BASE_URL`) bills a monthly budget, not 5h/7d windows. Point an entry at the
env file that sets those two variables:

```json
{ "name": "inditex", "litellm": "~/.config/iop/cuenta-alt.env" }
```

It gets one row in the same columns: the month's share of the cap, the countdown to
`budget_reset_at`, then the dollars, and a warning once the key has less than a week
left (`key 5d`, then `key expired`). With no cap on the key it shows the spend alone.

```
inditex  mo  80% ━━━━━━── 1d23h  │ $480/$600 │ key 5d
```

The figures come from the proxy's `GET /key/info`, which spends nothing, probed detached
at most every five minutes and cached as `{ spend, max_budget, budget_reset_at, expires,
at }`. When that fails the row reads `no key` (no `sk-` key in the file), `no url`,
`offline`, or the HTTP status. `budget_duration` is ignored: some proxies report it
wrong, and `budget_reset_at` is what counts.

A session launched against a proxy (`ANTHROPIC_BASE_URL` set, as `claude-corp` does) gets
no `rate_limits`. It writes no windows for any account and takes the first LiteLLM row
as its own, unless `CLAUDE_ACCOUNT` names a listed account.

## What it costs

Without `statusline.json`, nothing measurable, and in particular no network. Claude Code 2.1.x passes the quota
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
W · Opus 5 · xhigh · extraction-crawler · ⎇ main
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
`$CLAUDE_CONFIG_DIR/statusline-cache.json`, holding the last quota figures seen for
each account. `rate_limits` only arrives after a session's first API response, so
without the cache both bars would be blank at the top of every session; with it they
redraw the last known value marked `~` until the real numbers land. Readings are keyed
by account name and merged by the rule that usage only climbs inside a window: the
later window wins, or in the same window the higher figure. So a session idling on an
old snapshot never overwrites a fresher one, and no two clocks need to agree.
