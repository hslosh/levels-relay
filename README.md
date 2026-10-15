# levels-relay

**Posts exact MenthorQ option levels to Discord without screenshots or AI.**

`levels-relay` reads the MenthorQ levels **straight off your TradingView chart**, exactly as MenthorQ draws them. It turns them into the ready-to-paste number strings the indicator uses, for **NQ, ES, GC, CL and SI**, and posts them to a Discord channel. Members copy one line per market into the indicator, and that's it.

```
📊 MenthorQ option levels · Wed, Oct 15, 8:31 AM ET
Last update: EOD 2026-10-14 22:27 · Intraday 2026-10-15 08:00 EST
NQ
30650,30550,30700,30500,30750,30450,30800,30400,30900,30300,31000,30850,30200,30350,30650,30650,30850,31135.5,30064.5,…
ES
7870,7850,7880,7840,7890,7830,7900,7820,7920,7800,7940,7910,7780,7810,7870,7870,7910,7997.55,7722.45,…
```
<sub>(example numbers, not real levels)</sub>

- **Exact:** reads the chart's own numbers, from the "Key Levels" table, and cross-checks them against the lines on the chart.
- **Never wrong or stale:** it only posts when every market is complete, matches its own chart price, and shows **today's** MenthorQ update. Otherwise it posts nothing and tells you why.
- **Stays out of your way:** it works in its own TradingView tab and never touches the one you trade on (see below).
- **Private:** runs on your machine and only sends to the Discord webhooks you give it.
- **Nothing to install** except Node.js. No packages, no accounts, no API keys.

---

## What it will never do

- **Touch the chart you trade on.** It switches symbols only on its own **levels tab** (a separate TradingView tab you set up once), and only for about a minute per post.
- **Reload, restart or close TradingView** unless you turn that on (`start_tradingview` / `allow_restart`, both off by default). Reloading can log TradingView out, so it never does it.
- **Take the live session from another device.** Your phone is fine alongside it. If a second *computer* has the session, it waits instead of grabbing it back.
- **Post stale, incomplete or mismatched levels.** If anything's off, nothing goes to the channel.
- **Post errors in the levels channel.** Problems go to your #modlog webhook (and `output/failures.log`).
- **Post twice.** One post per window (morning and evening), never the same levels again.

## How it fits your day

MenthorQ publishes **Intraday** levels from **08:00 ET** and **EOD** levels around **19:20 ET** (and again near 22:30 ET). The relay posts the **morning** set once today's Intraday levels are on the chart, and the **evening** set once today's EOD levels are. Details and sources: [docs/MENTHORQ.md](docs/MENTHORQ.md).

**The one thing it can't do for you:** TradingView only loads new MenthorQ levels after someone clicks the **purple ⟳** next to the indicator name (MenthorQ ships each update as a new version of the indicator). So the routine is:

1. Leave TradingView open on the computer, with the levels tab.
2. When new levels are out, the relay pops up a reminder: *"New MenthorQ levels are out… click the purple ⟳"*.
3. Click ⟳ on the two MenthorQ indicators in the levels tab (if the icon isn't there yet, close and reopen TradingView).
4. Within a couple of minutes the levels are in Discord, and you get a "posted ✅" notification.

Phone traders: charting and trading on your phone doesn't affect the relay, and the relay doesn't affect your phone.

## First-time setup: what you'll see

If you've never used Node.js or run scripts on this computer, expect a few one-time prompts. All of them are normal:

| When | What you'll see | What to do |
|---|---|---|
| Installing Node.js | A normal installer. Windows asks *"Do you want to allow this app to make changes?"*; a Mac asks for your password | Yes / enter password. Default options are fine |
| Getting the files | GitHub → green **Code** button → **Download ZIP**. Unzip it somewhere permanent (e.g. Documents) | Don't run it from inside the zip or your Downloads folder |
| Windows: first double-click on a `.bat` | Blue *"Windows protected your PC"* (SmartScreen), because the file came from the internet | **More info → Run anyway** (once per file) |
| Mac: first double-click on a `.command` | *"Apple could not verify … is free of malware"* (or *"unidentified developer"*), because it came from the internet | Click **Done**, then *System Settings → Privacy & Security*, scroll down, **Open Anyway** (once per file). Easier: open Terminal in the folder and run `xattr -dr com.apple.quarantine .` once, or let Claude do it |
| Mac: first run in Terminal | *"Terminal would like to access files in your Documents folder"* or similar | **Allow** |
| Node.js missing or too old | The scripts say so and link to nodejs.org | Install the LTS version, then **open a new Terminal window** |
| Mac: after the auto-start script | A *"Background Items Added"* notification | Nothing; that's the watcher |
| Using Claude to set it up | Claude asks before running each command | Approve them. Each one is explained |

Nothing needs administrator rights except installing Node.js itself. The tool never asks for your TradingView, Discord or MenthorQ password.

## Set it up with Claude (recommended)

If you have [Claude Code](https://claude.com/claude-code) or the Claude desktop app, open this folder and say:

> **Set up levels-relay for me.**

Claude reads [`CLAUDE.md`](CLAUDE.md) and walks you through it step by step. It checks how MenthorQ looks on *your* chart (`learn`) and adapts the settings, and never posts anything until you've confirmed the numbers look right.

## Set it up by hand (about 10 minutes)

1. **Install Node.js 22 or newer:** https://nodejs.org (the LTS button, default options).
2. **Create Discord webhooks:** one in the channel the levels go to, and one in a private channel such as #modlog for problem notices. *Channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL.* (An invite link won't work; it has to be the webhook URL.)
3. **Make your config:** copy `config.example.json` to `config.json`, then paste the two URLs into `webhook_url` and `modlog_webhook_url`.
4. **Start TradingView with the reader enabled.** Fully quit TradingView (on Windows, also check the system tray), then double-click `start-tradingview.bat` (Windows) or `start-tradingview.command` (Mac).
5. **Make the levels tab:** in TradingView, open a new tab, create a new layout and **save it with a name** (e.g. `levels-relay`). Add **MenthorQ Gamma Levels EOD** and **MenthorQ Gamma Levels Intraday**, keep both visible, with *Show Timestamp* and the table on. It's fine if the two tables overlap. Don't trade on this tab.
6. **Check it,** in a terminal opened in this folder:
   ```
   node levels-relay.mjs selftest            # checks the parser, no TradingView needed
   node levels-relay.mjs learn --apply       # finds the levels tab, checks MenthorQ, fills in config.json
   node levels-relay.mjs learn --markets     # reads all 5 markets once to confirm each has levels
   node levels-relay.mjs read                # prints the five strings, posts nothing
   ```
   Compare a few numbers from `read` against the chart. Once they match, `node levels-relay.mjs post` sends them.

## Hands-off

1. **Leave the computer on with TradingView open** on the levels tab. (Windows: *Settings → System → Power → Sleep: Never*; screen off is fine. On a Mac, the auto-start keeps it awake.)
2. **Run the auto-start once:** `install-autostart.bat` (Windows) or `install-autostart.command` (Mac). The watcher runs in the background and starts at every login.
3. **That's it.** Click the purple ⟳ when it reminds you, and it posts.

The watcher checks the levels tab every 2 minutes during the windows (07:45–11:30 and 19:00–23:30 ET). Those checks are read-only: it only switches symbols when it's actually posting. If a window passes without a post, #modlog gets one note saying why.

Prefer fixed times? Set `"mode": "schedule"` and it posts at `schedule_et`, still only if the levels are today's.

### Optional: let it manage TradingView
- `"start_tradingview": true` opens TradingView (in the background) if it's closed. Handy on a computer nobody uses.
- `"allow_restart": true` quits and reopens TradingView when it's open without the debug port, or when another computer took the session. **Leave this off on a computer you trade from**, and if you chart on a second computer, since it would take the session from that computer.

## Daily use

| Want to… | Do this |
|---|---|
| Post right now | double-click `run.bat` / `run.command` |
| Post automatically | run `install-autostart` once, or leave `watch.bat` / `watch.command` open |
| Read without posting | `node levels-relay.mjs read` |
| Is everything OK? | `node levels-relay.mjs status` (live? fresh? newer MenthorQ version out? last post) |
| MenthorQ changed something | `node levels-relay.mjs learn` |
| Post even though the levels aren't today's | `node levels-relay.mjs post --force` (skips only the "today's levels" and "already posted" checks) |
| Stop auto-start | `uninstall-autostart.bat` / `uninstall-autostart.command` |

Every run saves a copy in `output/`; `output/latest.txt` is always the newest good set.

## Configuration

| Key | What it does | Default |
|---|---|---|
| `webhook_url` | Discord webhook for the levels channel | (required) |
| `modlog_webhook_url` | Webhook for problem notices, never the levels channel | blank = `output/failures.log` only |
| `webhook_name` | Name shown on the post | `Option Levels` |
| `layout` | The levels tab's id (`learn --apply` or `tabs` finds it) | (required for auto-posting) |
| `mode` | `update` = post when fresh levels appear · `schedule` = post at `schedule_et` | `update` |
| `windows` | When to watch, and which indicator must show today's date (`wait_for`). `nudge_after` = when to start "click ⟳" reminders | morning 07:45–11:30 (Intraday), evening 19:00–23:30 (EOD) |
| `check_every_minutes` | How often the watcher looks (read-only) | `2` |
| `schedule_et` | Post times in `schedule` mode (24h, Eastern) | `["08:20", "19:45"]` |
| `start_tradingview` | Open TradingView (in the background) if it's closed | `false` |
| `allow_restart` | Restart TradingView when needed (see above) | `false` |
| `notify_desktop` | "Click ⟳" and "posted ✅" pop-ups on this computer | `true` |
| `notify_missed_window` | Tell #modlog when a window passes without a post | `true` |
| `studies.eod` / `studies.intraday` | Part of the MenthorQ indicator names | `MenthorQ Gamma Levels EOD` / `… Intraday` |
| `symbols` | Chart symbol per market; `""` turns a market off | NQ1!, ES1!, GC1!, CL1!, SI1! |
| `aliases` | Extra spellings for level names, e.g. `{"Gamma Flip": "HVL"}` | none |
| `min_levels` | Fewest of the 19 levels per indicator before it refuses to post | `15` |
| `settle_seconds` / `timeout_seconds` | Max wait for a market to load / for TradingView to answer | `25` / `30` |

## Docs
- [How it works](docs/HOW-IT-WORKS.md): what it reads, and every check before a post
- [What we know about MenthorQ](docs/MENTHORQ.md): update times, the update click, settings that matter, sources
- [Output format](docs/OUTPUT-FORMAT.md): the 38 numbers, in order
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## Development
`node levels-relay.mjs selftest` checks the parser. `node test/run.mjs` runs the full suite against a fake TradingView (`test/mock-tv.mjs`) that misbehaves on purpose: slow and stuck charts, "No Levels", frozen sessions, hangs, stale levels, and a full simulated trading day for the watcher. GitHub Actions runs both on Mac, Windows and Linux.

## License
MIT. See [LICENSE](LICENSE). Not affiliated with TradingView, MenthorQ or Discord. Make sure sharing the levels as text fits your MenthorQ subscription terms.
