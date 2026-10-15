# What we know about the MenthorQ indicators

`levels-relay` was built and tested without a MenthorQ subscription, so everything it assumes about MenthorQ comes from the sources below. On a real setup, `node levels-relay.mjs learn` checks each assumption against the actual chart and says what differs. If something here turns out to be wrong, `learn`'s output says what to change.

## On the chart (from screenshots of a MenthorQ chart, Oct 13–14 2026)

| What | How it looks |
|---|---|
| Indicator names | **MenthorQ Gamma Levels EOD** and **MenthorQ Gamma Levels Intraday** (Indicators → *Invite-only scripts*) |
| Timestamp box (top right) | `End of Day Levels` / `Last Update: 2026-10-13 22:27`, and `Intraday Levels` / `Last Update: 2026-10-14 08:00 EST` |
| Key Levels table | Three columns, **Key Levels · Value · Distance to Spot**, sorted by price. Levels that share a price share a row: `Call Resistance / Call Resistance 0DTE / Gamma Wall 0DTE`, `HVL / HVL 0DTE`, `Put Support / Put Support 0DTE` |
| Lines and labels | One horizontal line per level, labeled with the same names as the table |
| Levels per indicator | 19: GEX 1–10, Call Resistance (+0DTE), Put Support (+0DTE), HVL (+0DTE), Gamma Wall 0DTE, 1D Max, 1D Min |

The tool reads the table first (exact values), falls back to the labels, and checks that the two agree.

## When levels change

| Indicator | Updates | Seen on the screenshots |
|---|---|---|
| EOD | Twice a day. MenthorQ says 6–6:30 pm ET for indices/stocks and around 11 pm ET for futures | `19:21` and `22:27` ET on Oct 13; the levels changed between the two |
| Intraday | 14+ snapshots a day, from 08:00 ET | `08:00 EST` in the morning, `16:45 EST` as the last one of the day |

That's why the defaults are: the **morning** post waits for today's *Intraday* time (from 08:00), and the **evening** post waits for today's *EOD* time (from about 19:20). Each window posts once. Later snapshots in the same window don't trigger another post.

## The catch: new levels need an update click

TradingView has no data feed for MenthorQ, so **MenthorQ ships each update as a new version of the indicator's code**. A chart keeps the version it loaded until someone:

- clicks the **purple ⟳ icon** next to the indicator name in the chart legend (*Update*), or
- removes the indicator and adds it again.

If the new version came out while TradingView was open, the icon may only appear after TradingView is reloaded or reopened. MenthorQ also says an update **resets the indicator's settings** to their defaults.

What this means for `levels-relay`:

- It **never posts levels older than today's** for the current window. It reads the "Last Update" time, not just the numbers.
- It **can tell** when a newer version is published but not loaded yet (it asks TradingView the same way the app does). In that case it shows a desktop notification: *"New MenthorQ levels are out… click the purple ⟳"*, once per window.
- It does **not** click the update icon or reload TradingView itself. Reloading through the debug connection has logged TradingView out before, which would also log you out of the tab you trade on.
- After an update, check that **Show Timestamp** and the **table** are still on (settings may have reset). `learn` checks both.

## Other settings that matter

- **Show Timestamp** must be on. Without it, the tool can't tell new levels from old ones and won't post.
- **Short Name** shortens the labels. The tool reads the table, so it's usually fine. If `learn` reports unknown names, turn Short Name off or add `aliases`.
- **Levels Conversion** (e.g. SPX → ES) adds levels marked `(SPX)`. The tool ignores bracketed levels and only posts native futures levels. `learn` warns if it sees them.
- **"No Levels for this Ticker"** is what MenthorQ shows for a ticker it doesn't cover. The tool won't post if any configured market shows it. Turn that market off in `symbols`.

## TradingView sessions and devices

- **Phone + this computer:** fine. Tested Oct 15 2026: charting on the phone didn't disconnect TradingView Desktop on a Mac.
- **Two computers:** TradingView streams to one at a time. Opening TradingView on a second computer freezes the first ("Session disconnected"). The tool never reconnects or restarts TradingView unless `allow_restart` is on.

## Coming up: TradingView's invite-only rules (Nov 1, 2026)

TradingView announced that from **November 1, 2026**, access to invite-only scripts can no longer be sold, or bundled into another paid product, outside its new Marketplace. Vendors were asked to contact TradingView about moving. MenthorQ's indicators are invite-only and come with its subscription, so **their name or delivery may change** around then. If the tool stops finding them, run `learn` again: it reports the new names and can update `config.json` (`learn --apply`).

## Sources
- MenthorQ: [Gamma Levels indicator in TradingView](https://menthorq.com/guide/tradingview/) · [Academy: Gamma Levels Indicator](https://menthorq.com/academy/trading-integrations/lessons/menthorq-gamma-levels-indicator/) · [TradingView indicators for futures traders](https://menthorq.com/guide/tradingview-indicators-for-futures-traders/)
- TradingView: [Commercial scripts are moving to the Marketplace](https://www.tradingview.com/blog/en/commercial-scripts-move-to-marketplace-61291/) · [Parallel chart connections](https://www.tradingview.com/support/solutions/43000694474)
- Updating invite-only indicators: [LuxAlgo: How to update](https://docs.luxalgo.com/docs/getting-started/how-to-update) · [Friend of the Trend: update indicators to new versions](https://friendofthetrend.com/tradingview/update-indicators-to-new-versions/)
- Screenshots of a MenthorQ chart on TradingView (Oct 13–14 2026)
