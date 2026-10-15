# levels-relay

**Post exact MenthorQ option levels to Discord without screenshots or AI.**

Each morning and evening, the MenthorQ gamma levels get screenshotted and posted. Then everyone runs the screenshots through an AI prompt to get the numbers for the **Option Levels / Auto-GEX Master Levels** indicator. That's slow, and the AI misreads levels when labels overlap or a price box is cut off at the edge.

`levels-relay` reads the levels **straight off your TradingView chart**, exactly as MenthorQ draws them. It turns them into the ready-to-paste number strings the indicator uses, for **NQ, ES, GC, CL and SI**, and can post them to a Discord channel on a schedule. Members copy one line per market into the indicator, and that's it.

```
📊 MenthorQ option levels · Wed, Oct 15, 8:05 AM ET
NQ
30500,30560,30600,30650,30960,31250,30200,30400,30100,31400,31000,31000,30350,30350,30750,30750,31000,31135.99,30428.01,…
ES
7900,7800,7875,7860,7890,7950,7750,7790,7780,7975,8000,7925,7825,7825,7850,7850,7925,7918.49,7795.51,…
```

- **Exact:** reads the chart's own numbers, using the "Key Levels" table when it's on the chart and the labeled lines otherwise.
- **Hands-off:** one command, or leave it running and it posts at the times you choose.
- **Private:** runs on your machine and only ever sends to the one Discord webhook you give it.
- **Nothing to install** except Node.js. No packages, no accounts, no API keys.

---

## Set it up with Claude (recommended)

If you have [Claude Code](https://claude.com/claude-code) or the Claude desktop app, open this folder and say:

> **Set up levels-relay for me.**

Claude reads [`CLAUDE.md`](CLAUDE.md) and walks you through it step by step. It checks each step before moving on and never posts anything until you've confirmed the numbers look right.

## Set it up by hand (about 5 minutes)

1. **Install Node.js 22 or newer:** https://nodejs.org (the LTS button, default options).
2. **Create a Discord webhook** in the channel the levels should go to: *Channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL*. (An invite link won't work; it has to be the webhook URL.)
3. **Make your config:** copy `config.example.json` to `config.json` and paste the webhook URL into `webhook_url`.
4. **Start TradingView with the reader enabled.** Fully close TradingView (on Windows, also check the system tray), then double-click:
   - Windows: `start-tradingview.bat`
   - Mac: `start-tradingview.command`

   Open a chart that has **MenthorQ Gamma Levels EOD** and **MenthorQ Gamma Levels Intraday** on it. They can be hidden; the tool shows them while it reads and hides them again.
5. **Check it,** in a terminal opened in this folder:
   ```
   node levels-relay.mjs selftest     # checks the parser, no TradingView needed
   node levels-relay.mjs check        # both MenthorQ indicators should show ✅
   node levels-relay.mjs read         # prints the five strings, posts nothing
   ```
   Compare a few numbers from `read` against your chart. Once they match, you're done.

## Daily use

| Want to… | Do this |
|---|---|
| Post right now | double-click `run.bat` / `run.command` |
| Post automatically | leave `watch.bat` / `watch.command` running: it posts at `schedule_et` (default **8:05 AM** and **8:05 PM ET**; mornings Mon–Fri, evenings Sun–Thu) |
| Start automatically when you log in | run `install-autostart.bat` (Windows) or `install-autostart.command` (Mac) once |
| Read without posting | `node levels-relay.mjs read` |

Every run also saves a copy in `output/`; `output/latest.txt` is always the newest set.

### Good to know
- **It switches your chart's symbol for about a minute** while it reads, then puts it back. To keep your trading chart untouched, open a second TradingView window just for this and put its layout id (the part of the chart URL after `/chart/`) in `config.json` → `layout`.
- **One device at a time.** TradingView only streams to the device that opened it last. If this machine shows *"Session disconnected"*, the chart is frozen; click **Connect** first. The tool stops and tells you if it sees this.
- **A run takes about a minute** (5 markets × ~10 seconds).

## Configuration

| Key | What it does | Default |
|---|---|---|
| `webhook_url` | Discord webhook to post to | (required to post) |
| `webhook_name` | Name shown on the post | `Option Levels` |
| `studies.eod` / `studies.intraday` | Part of the MenthorQ indicator names | `MenthorQ Gamma Levels EOD` / `… Intraday` |
| `symbols` | Chart symbol for each market | NQ1!, ES1!, GC1!, CL1!, SI1! |
| `schedule_et` | Post times for `watch` (24h, Eastern) | `["08:05", "20:05"]` |
| `layout` | Use a specific window (layout id) | the first chart window |
| `settle_seconds` | Max wait per market for the indicator to finish | `25` |

## Docs
- [How it works](docs/HOW-IT-WORKS.md): what it reads and why it's exact
- [Output format](docs/OUTPUT-FORMAT.md): the 38 numbers, in order
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## License
MIT. See [LICENSE](LICENSE). Not affiliated with TradingView, MenthorQ or Discord. Make sure sharing the levels as text fits your MenthorQ subscription terms.
