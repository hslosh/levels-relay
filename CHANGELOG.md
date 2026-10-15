# Changelog

## 1.2.0
- **Fully hands-off:** `watch` now posts as soon as MenthorQ's "Last Update" stamp changes (`mode: "update"`, the default); `mode: "schedule"` keeps fixed times.
- Self-healing: starts TradingView if it's closed (`start_tradingview`, default on). Optionally restarts it to take the session back from another device (`take_back_session`, default **off** because it bumps that device). It never reloads the page, which can log TradingView out.
- Failures post a ⚠️ notice to the channel (or `alert_webhook_url`).
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
