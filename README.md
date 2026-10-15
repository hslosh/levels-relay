# levels-relay

**Posts exact MenthorQ option levels to Discord without screenshots or AI.**

`levels-relay` reads the MenthorQ levels **straight off your TradingView chart**, exactly as MenthorQ draws them. It turns them into the ready-to-paste number strings the indicator uses, for **NQ, ES, GC, CL and SI**, and can post them to a Discord channel on a schedule. Members copy one line per market into the indicator, and that's it.

```
📊 MenthorQ option levels · Wed, Oct 15, 8:05 AM ET
NQ
30500,30560,30600,30650,30960,31250,30200,30400,30100,31400,31000,31000,30350,30350,30750,30750,31000,31135.99,30428.01,…
ES
7900,7800,7875,7860,7890,7950,7750,7790,7780,7975,8000,7925,7825,7825,7850,7850,7925,7918.49,7795.51,…
```

- **Exact:** reads the chart's own numbers, using the "Key Levels" table when it's on the chart and the labeled lines otherwise.
- **Fully hands-off:** it posts the moment MenthorQ updates, starts TradingView itself if needed, takes the session back if another device grabbed it, and tells the channel if anything goes wrong.
- **Private:** runs on your machine and only ever sends to the one Discord webhook you give it.
- **Nothing to install** except Node.js. No packages, no accounts, no API keys.

---

## First-time setup: what you'll see

If you've never used Node.js or run scripts on this computer, expect a few one-time prompts. All of them are normal:

| When | What you'll see | What to do |
|---|---|---|
| Installing Node.js | A normal installer. Windows asks *"Do you want to allow this app to make changes?"*; a Mac asks for your password | Yes / enter password. Default options are fine |
| Getting the files | GitHub → green **Code** button → **Download ZIP**, then unzip it somewhere permanent (e.g. Documents) | Don't run it from inside the zip or your Downloads folder |
| Windows: first double-click on a `.bat` | Blue *"Windows protected your PC"* (SmartScreen), because the file came from the internet | **More info → Run anyway** (once per file) |
| Mac: first double-click on a `.command` | *"cannot be opened because it is from an unidentified developer"* | **Right-click → Open → Open** (once per file), or have Claude clear it for you |
| Mac: first run in Terminal | *"Terminal would like to control…"* or similar | **Allow** |
| Mac: after the auto-start script | A *"Background Items Added"* notification | Nothing; that's the watcher |
| Using Claude to set it up | Claude asks before running each command | Approve them. Each one is explained |

Nothing needs administrator rights except installing Node.js itself. The tool never asks for your TradingView, Discord or MenthorQ password.

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

## Fully hands-off (set and forget)

For posts that keep coming while you're away from the desk:

1. **Leave one computer on.** Windows: *Settings → System → Power → Sleep: Never* (screen off is fine). On a Mac, the auto-start below keeps it awake on its own.
2. **Run the auto-start once:** `install-autostart.bat` (Windows) or `install-autostart.command` (Mac). The watcher then starts at every login.
3. **That's it.** With the default settings, the watcher:
   - checks the MenthorQ **"Last Update"** stamp every 3 minutes, 7:30–11:30 AM and 7:00–11:00 PM ET, and **posts as soon as new levels appear**;
   - **starts TradingView** with the debug port if it's closed (`start_tradingview`, on by default);
   - **reports failures to #modlog, never to the levels channel.** If a run fails, a "⚠️ couldn't post the levels: reason" message goes to the webhook in `modlog_webhook_url` (make one in your #modlog channel the same way), so members never see it and you're never left wondering. Without a modlog webhook, failures are written to `output/failures.log`.
4. **Optional: let it take the session back.** TradingView only streams to one device at a time, so if you open it on your phone or another computer, this machine's chart freezes and the post fails (you get the ⚠️ message in #modlog). Set `"take_back_session": true` and the watcher instead restarts TradingView on this machine to take the session back. That bumps your other device for about a minute, so it's off until you turn it on.

Prefer fixed times instead? Set `"mode": "schedule"` and it posts at `schedule_et`.

## Daily use

| Want to… | Do this |
|---|---|
| Post right now | double-click `run.bat` / `run.command` |
| Post automatically | leave `watch.bat` / `watch.command` running: it posts whenever MenthorQ updates (see above) |
| Start automatically when you log in | run `install-autostart.bat` (Windows, no admin rights needed) or `install-autostart.command` (Mac) once |
| Read without posting | `node levels-relay.mjs read` |
| Is everything OK? | `node levels-relay.mjs status` (live or frozen, latest MenthorQ update) |

Every run also saves a copy in `output/`; `output/latest.txt` is always the newest set.

### Good to know
- **It switches your chart's symbol for about a minute** while it reads, then puts it back. To keep your trading chart untouched, open a second TradingView window just for this and put its layout id (the part of the chart URL after `/chart/`) in `config.json` → `layout`.
- **One device at a time.** TradingView only streams to the device that opened it last. If this machine shows *"Session disconnected"*, the chart is frozen. Click **Connect**, or turn on `take_back_session` and the watcher does it.
- **A run takes about a minute** (5 markets × ~10 seconds).

## Configuration

| Key | What it does | Default |
|---|---|---|
| `webhook_url` | Discord webhook to post to | (required to post) |
| `webhook_name` | Name shown on the post | `Option Levels` |
| `studies.eod` / `studies.intraday` | Part of the MenthorQ indicator names | `MenthorQ Gamma Levels EOD` / `… Intraday` |
| `symbols` | Chart symbol for each market | NQ1!, ES1!, GC1!, CL1!, SI1! |
| `mode` | `update` = post when MenthorQ updates · `schedule` = post at `schedule_et` | `update` |
| `update_windows_et` | When to watch for updates (Eastern) | 7:30–11:30, 19:00–23:00 |
| `update_check_minutes` | How often to check | `3` |
| `schedule_et` | Post times in `schedule` mode (24h, Eastern) | `["08:05", "20:05"]` |
| `start_tradingview` | Start TradingView with the debug port if it's closed | `true` |
| `take_back_session` | Restart TradingView to take the session back from another device (bumps that device ~1 min) | `false` |
| `modlog_webhook_url` | Webhook in #modlog for failure notices (never sent to the levels channel) | blank = local log only |
| `layout` | Use a specific window (layout id) | the first chart window |
| `settle_seconds` | Max wait per market for the indicator to finish | `25` |

## Docs
- [How it works](docs/HOW-IT-WORKS.md): what it reads and why it's exact
- [Output format](docs/OUTPUT-FORMAT.md): the 38 numbers, in order
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## License
MIT. See [LICENSE](LICENSE). Not affiliated with TradingView, MenthorQ or Discord. Make sure sharing the levels as text fits your MenthorQ subscription terms.
