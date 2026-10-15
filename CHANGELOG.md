# Changelog

## 1.2.1
- Clear message instead of a crash when Node.js is missing or older than 22 (all launchers and the tool itself).
- A broken `config.json` gives a plain-English error instead of a stack trace. Unknown commands list the valid ones.
- Webhooks are checked **before** touching the chart; the example's `PASTE_...` placeholders count as "not set".
- New `validate` command; both auto-start installers run it first, so a placeholder webhook can no longer start a watcher that fails in a loop.
- `start-tradingview.command` says so if TradingView Desktop isn't installed. `watch.bat` stays open on errors.
- `.bat` files use Windows line endings. README: current macOS security prompt ("Open Anyway"), private-repo download note.

## 1.2.0
- Windows auto-start uses the Startup folder (no administrator rights needed); the watcher runs minimized and logs to `output/watch.log`.
- README: "First-time setup: what you'll see" lists every one-time prompt (installer, SmartScreen, Gatekeeper).
- **Fully hands-off:** `watch` now posts as soon as MenthorQ's "Last Update" stamp changes (`mode: "update"`, the default); `mode: "schedule"` keeps fixed times.
- Self-healing: starts TradingView if it's closed (`start_tradingview`, default on). Optionally restarts it to take the session back from another device (`take_back_session`, default **off** because it bumps that device). It never reloads the page, which can log TradingView out.
- Failures post a ⚠️ notice to **#modlog** (`modlog_webhook_url`) and never to the levels channel; without one, they go to `output/failures.log`.
- `status` command. The Mac auto-start keeps the Mac awake while the watcher runs.

## 1.1.0
- Reads MenthorQ's "Key Levels" table when it's on the chart (exact values); falls back to the labeled lines.
- Detects a frozen chart ("Session disconnected") and says what to do.
- `selftest` command: checks the level-name parser without TradingView.
- Clearer Discord post: last-update times and paste instructions.
- Auto-start at login (Windows Task Scheduler / macOS LaunchAgent).
- `CLAUDE.md`, so Claude can walk you through setup.

## 1.0.0
- Reads MenthorQ EOD + Intraday labels for NQ, ES, GC, CL, SI and builds the 38-value indicator strings.
- `check`, `dump`, `read`, `post`, `watch`. Discord webhook posting. Zero dependencies.
