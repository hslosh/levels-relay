# How it works

TradingView Desktop is a Chrome-based app. Started with `--remote-debugging-port=9222`, it lets a local program read the chart the same way the browser's developer tools do. Nothing goes over the internet for this; the program talks to the app on your own machine. The debug port only listens on this computer (`127.0.0.1`).

## Where it reads

Everything happens in the **levels tab**: a TradingView tab with its own saved layout (`layout` in `config.json`), holding the two MenthorQ indicators. The tab you trade on is never touched. If `layout` isn't set, manual commands use the one tab that has MenthorQ on it, and automatic posting refuses to run.

## Watching (read-only)

During each window (morning 07:45–11:30, evening 19:00–23:30 ET) the watcher looks at the levels tab every 2 minutes. It doesn't switch symbols or click anything. It reads:
- the MenthorQ **"Last Update"** times (`Last Update: 2026-10-14 08:00 EST`);
- whether TradingView has a **newer published version** of each indicator than the one loaded (it asks TradingView the same way the app does).

A window posts **once**, when its indicator (Intraday in the morning, EOD in the evening) shows **today's** date. If a newer MenthorQ version is published but not loaded, it loads it on the levels tab (add the new version → check its "Last Update" time → remove the old one → save the layout), then posts. If that fails, it keeps the old one and shows one desktop reminder to click the purple ⟳. See [MENTHORQ.md](MENTHORQ.md) for why new versions need loading.

If TradingView is closed, frozen ("Session disconnected") or busy, the watcher stays quiet and tries again. It never starts or restarts TradingView unless `start_tradingview` / `allow_restart` allow it. When a window closes without a post, #modlog gets one note saying why.

## Reading the levels (only when posting)

For each market (NQ, ES, GC, CL, SI), on the levels tab:

1. **Switch the symbol** and wait until the MenthorQ output **changes from the previous market's** and then stops changing. Right after a switch, the indicator can still show the old market's drawings. Waiting for the change keeps NQ's levels from ever being read as ES's.
2. **Read what MenthorQ drew:**
   - **The "Key Levels" table** (Key Levels · Value · Distance to Spot) gives each level's exact value. Rows like `Call Resistance / Call Resistance 0DTE / Gamma Wall 0DTE` give each of those names that value.
   - **The labeled lines** give the same levels a second way. The tool checks that the two agree, and uses the labels alone if the table is turned off.
3. **Build the indicator string:** 19 EOD values, then 19 Intraday values, in the indicator's fixed order (see [OUTPUT-FORMAT.md](OUTPUT-FORMAT.md)).

Then it switches the tab back to its symbol and re-hides any indicator it had to show (hidden indicators don't calculate).

## Checks before anything is posted

All of these must pass, or **nothing** is posted and the reasons go to #modlog (or the terminal, when you run it by hand):

| Check | Catches |
|---|---|
| Each market finished loading and its output changed after the switch | reading the previous market's levels |
| At least `min_levels` (15) of 19 levels per indicator, per market | half-drawn or missing levels |
| No "No Levels for this Ticker" | markets MenthorQ doesn't cover |
| The levels sit within 25% of that market's chart price | another market's levels |
| No two markets have identical numbers | another market's levels |
| Table and chart lines agree | misread tables |
| The window's indicator shows today's "Last Update" date | yesterday's levels |
| Not the same levels as the last post | double posts |

`post --force` skips only the last two (for when MenthorQ skips an update and you want to post anyway).

## Why this beats screenshots + AI
- **No reading pixels.** The values come from the chart's own data, with every decimal kept (7997.55, not 7998).
- **No overlap problems.** Labels that overlap on screen are separate objects in the data.
- **No cut-off prices.** A level outside the visible screen area is still in the data.

## What it sends, and where
- The levels post → `webhook_url` only.
- Problem notices → `modlog_webhook_url` only (never the levels channel), plus `output/failures.log`.
- A version check to TradingView's own server, made from inside TradingView (the same request its app makes).
- Nothing else. It doesn't trade, change indicator settings, or touch anything but the levels tab's symbol (which it puts back).
