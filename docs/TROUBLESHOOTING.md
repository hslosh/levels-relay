# Troubleshooting

Start with `node levels-relay.mjs status`: it says whether TradingView is live, which MenthorQ update times are on the chart, whether a newer version is waiting, and when the last post was. Problems are also logged in `output/failures.log`.

## Nothing was posted

**"…levels are from 2026-10-14 16:45 EST, not today's"**
The chart still has the previous MenthorQ version. Click the **purple ⟳** next to each MenthorQ indicator's name on the levels tab (*Update*). If there's no ⟳, quit and reopen TradingView, then look again. MenthorQ ships new levels as new indicator versions, and TradingView only loads them after that click ([why](MENTHORQ.md#the-catch-new-levels-need-an-update-click)). Then check that *Show Timestamp* and the table are still on, since updates can reset settings.

**"…shows no 'Last Update' time"**
Turn on **Show Timestamp** in the indicator's settings on the levels tab. Without it, the tool can't tell new levels from old ones.

**"ES: the indicator didn't finish loading" / "…don't fit the chart price" / "same numbers as NQ"**
The chart didn't redraw properly for that market, so the tool refused rather than risk posting another market's levels. It retries in 5, 10, then 20 minutes. If it keeps happening, raise `settle_seconds` (e.g. 40) in `config.json`.

**"only 12/19 EOD … levels found"**
Some level names weren't recognized. Run `node levels-relay.mjs learn`. It lists names it doesn't know. Turn off *Short Name* in the indicator settings, or add the names under `aliases` in `config.json`.

**"MenthorQ shows 'No Levels for this Ticker'"**
MenthorQ doesn't cover that symbol, at least today. Set it to `""` under `symbols` in `config.json` to stop posting that market, or check the symbol (e.g. `NYMEX:CL1!`).

**"these exact levels were already posted"**
They went out earlier. To post again anyway: `node levels-relay.mjs post --force`.

**An ℹ️ "no morning levels were posted" note in #modlog**
The window closed without fresh levels. The note says why: TradingView was closed or disconnected, the update click didn't happen, or the timestamp is off.

## TradingView

**"TradingView isn't reachable on port 9222"**
TradingView wasn't started with the debug port. Quit it fully (Windows: right-click the tray icon → Exit), then start it with `start-tradingview.bat` / `start-tradingview.command`.

**"Session disconnected" / the chart is frozen**
Another *computer* opened TradingView more recently and has the live session. (A phone doesn't cause this.) Click **Connect** on this computer when it suits you. The tool doesn't do it for you unless `allow_restart` is on.

**"The levels tab (layout …) isn't open"**
Open that tab in TradingView, or run `node levels-relay.mjs tabs` to see what's open and fix `layout` in `config.json`.

**"No MenthorQ indicator on the levels tab"**
Run `node levels-relay.mjs learn`. It finds the indicators and suggests the names for `config.json` (`learn --apply` writes them). If MenthorQ renamed them (possible around TradingView's Nov 1, 2026 invite-only change), this is the fix.

**"TradingView didn't answer within 30s"**
TradingView is frozen or very busy. Quit and reopen it. Nothing was posted.

## Discord

**Discord said 401 / 404**
The webhook URL is wrong or was deleted. Make a new one (Channel settings → Integrations → Webhooks) and paste it into `config.json`.

## The watcher

**It doesn't seem to run**
- Did auto-start get installed? Mac: `launchctl list | grep levels-relay`. Windows: a minimized "levels-relay" window.
- `output/watch.log` shows what it's doing.
- Is the computer awake? (Windows: Settings → System → Power → Sleep: Never. The Mac auto-start keeps it awake.)
- Is TradingView open with the levels tab, and signed in? The tool never signs in for you.

**It posted at a different time than expected**
It posts as soon as fresh levels are on the chart, once per window. Change `windows` in `config.json` to move the windows, or use `"mode": "schedule"` for fixed times.
