# Troubleshooting

**"TradingView isn't reachable on port 9222"**
TradingView wasn't started with the debug port. Quit it fully (Windows: right-click the tray icon → Exit), then start it with `start-tradingview.bat` / `start-tradingview.command`.

**"Session disconnected" / the chart is frozen**
TradingView streams to one device at a time; another device opened it more recently. Click **Connect** in this TradingView, then run again.

**"No MenthorQ indicator on the active chart"**
Run `node levels-relay.mjs check`, find the MenthorQ indicators in the list, and put part of their exact names into `config.json` → `studies.eod` / `studies.intraday`.

**A market shows "EOD 12/19 on chart"**
MenthorQ doesn't always publish every level (e.g. GEX 6–10 on quieter days). Missing ones are `0`, which the indicator skips. If a level IS on your chart but came out `0`, run `node levels-relay.mjs dump` on that market and look at the label text. Its name may be spelled in a way the parser doesn't know yet.

**A number is slightly different from the chart**
The tool reads the exact value the indicator drew. If your chart's price scale shows a rounded number, trust the tool. If it's clearly a different level, `dump` that market and compare.

**Discord said 401 / 404**
The webhook URL is wrong or was deleted. Make a new one (Channel settings → Integrations → Webhooks) and paste it into `config.json`.

**The watcher didn't post**
- Is the watch window still open, or was autostart installed?
- Was TradingView running with the debug port at that time?
- `schedule_et` uses **Eastern** time. Mornings post Mon–Fri, evenings Sun–Thu.
