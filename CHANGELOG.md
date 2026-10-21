# Changelog

## 1.3.0
**New MenthorQ versions load by themselves** (`auto_update`, on by default). TradingView doesn't load a new version of an indicator on its own, and MenthorQ ships every update as a new version. When the watcher sees a newer version published, it adds that version on the levels tab, waits until it shows its "Last Update" time, removes the old one, and saves the layout. Then it posts. No click needed.
- Safe by design: if the new version can't be added (no free indicator slot) or shows no timestamp with its default settings, it's removed again, the old one stays, #modlog gets one note, and you get the "click the purple ⟳" reminder instead. It never leaves a second copy behind.
- `learn` tests it on day one: it adds a temporary second copy, checks it, and removes it again.
- Tested on real TradingView with a published stand-in indicator, swapping versions in both directions, with the tab in front and in the background.

## 1.2.4
- Fixed: the "newer MenthorQ version is out" check could read a cached answer and never notice a new version (found by publishing a real update of a test indicator). It now always asks fresh.
- Docs: the levels tab needs two free indicator slots (TradingView plans limit indicators per chart), and a TradingView reload brings a tab back to its last *saved* layout.

## 1.2.3
First run on real TradingView (with stand-in indicators that draw what MenthorQ draws). Fixed three things the fake TradingView couldn't show:
- **Tables were invisible.** TradingView stores table cells one level shallower than labels and lines, so the Key Levels table and the "Last Update" box were never read. They are now. Every cell also carries its table id, so the timestamp box can't mix with table rows.
- **Busy markets never "finished loading."** The "Distance to Spot" column changes with every tick, so a fast market like NQ never looked settled. That column is now ignored when waiting for a market to load.
- `tabs` and `learn` now also find indicators by the names in `config.json`, not only by the word "MenthorQ" (in case MenthorQ renames them).

The fake TradingView now matches the real one (cell layout, live-ticking distance column). Verified on real TradingView: `learn`, `learn --markets`, `read`, `post` (all 5 markets, 38/38 numbers exact), and a duplicate `post` refused.

## 1.2.2
Built around how MenthorQ actually behaves (see `docs/MENTHORQ.md`) and around not getting in the way of your trading.

**Never posts bad levels**
- Refuses to post unless every market has at least `min_levels` (15) of 19 levels, finished loading, sits near its own chart price, differs from the other markets, and its table agrees with its chart lines. A market showing "No Levels for this Ticker" blocks the post with a clear reason.
- After switching markets, waits until MenthorQ's output actually changes, so one market's levels can never be read as another's.
- Freshness: the morning post waits for **today's Intraday** "Last Update" time, the evening post for **today's EOD** time (MenthorQ updates Intraday from 08:00 ET, EOD around 19:20 and 22:30 ET). One post per window, and never the same levels twice. `post --force` skips only these two checks.
- Strict timestamp parsing for the exact formats on real MenthorQ charts (`2026-10-13 22:27`, `2026-10-14 08:00 EST`). The timestamp box can no longer collide with table rows.

**Stays out of your way**
- Works only in a dedicated **levels tab** (`layout`); automatic posting requires one. The tab you trade on is never touched.
- `start_tradingview` and `allow_restart` (replaces `take_back_session`) are **off by default**. When on, TradingView opens in the background so it can't steal focus, and a restart waits for TradingView to really quit.
- Watching is read-only; symbols only change while posting.

**MenthorQ updates need a click.** TradingView only loads new MenthorQ levels after the purple ⟳ update. The watcher checks whether a newer version is published and shows a desktop reminder (once per window), then posts as soon as the levels are on the chart.

**Reliability**
- Every call to TradingView has a timeout; a dropped connection fails cleanly instead of hanging.
- Failed posts retry after 5, 10, 20 and 30 minutes and are reported to #modlog once per error. After 4 tries it stops for that window.
- When a window closes without a post, #modlog gets one note saying why (`notify_missed_window`).
- Mac auto-start: restart throttle and lower priority. Windows auto-start: `watch-loop.bat` restarts the watcher if it stops (but not on a broken config); `uninstall-autostart.bat` also stops it.
- Fixed: running through a symlinked folder silently did nothing. The launch command now uses `port` from config.

**New commands:** `tabs` (pick the levels tab), `learn [--markets] [--apply]` (checks MenthorQ on your chart against what we expect, suggests or writes config fixes). `status` now shows freshness, newer versions, and the last post.

**Tests:** `test/run.mjs` runs against a fake TradingView (`test/mock-tv.mjs`): slow and stuck charts, "No Levels", frozen sessions, hangs, stale and duplicate posts, and a full simulated day for the watcher. GitHub Actions runs it on Mac, Windows and Linux.

**Config:** `windows` replaces `update_windows_et` (old configs still work), plus `aliases`, `min_levels`, `notify_desktop`, `notify_missed_window`, `timeout_seconds`. The example README post uses made-up numbers.

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
