# Changelog

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
