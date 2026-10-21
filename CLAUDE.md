# Setting up levels-relay (instructions for Claude)

You're helping a trader set up **levels-relay**. It reads MenthorQ gamma levels off their TradingView Desktop chart and posts the number strings for the Option Levels / Auto-GEX indicator to their Discord. They may not be technical, and they may be trading while you work. Keep every message short and in plain language, do one step at a time, and confirm each step worked before moving on.

## Ground rules
- **Their trading comes first.** Never change, switch, reload or close the chart they trade on. The tool only works in its own **levels tab**. Ask before anything that touches TradingView.
- **Never reload a TradingView window,** and don't restart or quit TradingView without asking. Reloading through the debug connection can log TradingView out, which also logs them out of the tab they trade on. If TradingView misbehaves, ask them to quit and reopen it themselves.
- **Never post to Discord until they've compared `read` output to their chart and said it's right.**
- **Never put a webhook URL in chat output, logs or commits.** They live only in `config.json`, which is git-ignored.
- Don't install packages. The tool needs only Node 22+.
- Built without access to MenthorQ: what it expects is in `docs/MENTHORQ.md`. Step 6 checks that against the real chart. **Believe the real chart over the docs,** and adapt the config (not the code) where you can.

## Steps

0. **Where they are:** if they downloaded a ZIP, make sure it's unzipped to a permanent folder (not Downloads, not inside the zip). On a Mac, clear the download quarantine so the `.command` files open: `xattr -dr com.apple.quarantine .` (explain first: it removes the "downloaded from the internet" flag on just this folder). On Windows, warn them that the first double-click on each `.bat` shows SmartScreen: **More info → Run anyway**.
1. **How they trade (ask, it decides the settings):**
   - Do they trade or chart on **this computer**, on **another computer**, or on their **phone**? Phone + this computer is fine (tested). A second computer with TradingView open takes the live session from this one, so keep `allow_restart` off.
   - Will this computer stay on with TradingView open during 07:45–11:30 and 19:00–23:30 ET? If not, the manual `run` double-click is the better fit (step 9).
2. **Node.js:** run `node --version`. If it's missing or below 22:
   - Windows: offer `winget install OpenJS.NodeJS.LTS` (it shows an admin prompt they accept), or send them to https://nodejs.org (LTS).
   - Mac: send them to https://nodejs.org (LTS .pkg; it asks for their password).
   - Afterwards they may need to open a new terminal so `node` is found.
3. **Self-test:** `node levels-relay.mjs selftest`. All checks should pass. If any fail, stop and report.
4. **Webhooks and config:** ask for a Discord webhook in the levels channel (*Channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL*; it starts with `https://discord.com/api/webhooks/`, and an invite link won't work), and a second one in **#modlog** or another private channel for problem notices. Copy `config.example.json` to `config.json` and write them into `webhook_url` and `modlog_webhook_url`, without echoing them. Then run `node levels-relay.mjs validate`.
5. **TradingView + the levels tab:**
   - Check the debug port: `curl -s http://127.0.0.1:9222/json/version` (Windows PowerShell: `Invoke-RestMethod http://127.0.0.1:9222/json/version`). If it doesn't answer, ask them to **fully quit** TradingView themselves (Windows: also the tray icon) at a moment that suits their trading, then run `start-tradingview.command` / `.bat`.
   - Ask them to make a **separate tab just for the relay**: new tab → new layout → **save it with a name** (e.g. `levels-relay`) → add *MenthorQ Gamma Levels EOD* and *Intraday*, both visible, with *Show Timestamp* and the table on. It's fine if the two tables overlap. They shouldn't trade on this tab.
   - `node levels-relay.mjs tabs` lists the open tabs and shows which one has MenthorQ.
6. **Learn how MenthorQ looks here, then adapt:** `node levels-relay.mjs learn --apply`. It finds the levels tab, writes `layout` (and indicator names if they differ) into `config.json`, and checks each expectation from `docs/MENTHORQ.md`: both indicators, visible, "Last Update" time and its format, the Key Levels table, 19 recognized level names, table vs lines agreement, and the indicator version vs the newest published one. Fix each ⚠️ with them, then run it again:
   - **Hidden indicator / no timestamp / no table:** ask them to change that setting on the levels tab.
   - **Unknown level names:** if "Short Name" is on, ask them to turn it off. Otherwise map each name in `config.json` → `aliases` (e.g. `"Gamma Flip": "HVL"`), using `node levels-relay.mjs dump` to see the raw text, and rerun `learn`.
   - **Different timestamp format:** if `learn` can't read the "Last Update" time but it's on the chart, `dump` and look at the text. Only then extend `MENTHORQ.stamp` in `levels-relay.mjs`, add a case to `selftest`, and run `selftest` plus `node test/run.mjs`.
   - **Converted levels "(SPX)":** ask them to turn off Levels Conversion on the levels tab.
   - **Newer version published:** that's fine; the watcher loads it by itself during the next window (`auto_update`).
   - **Auto-update check failed:** if it says there's no free slot, ask them to remove another indicator from the levels tab. If the fresh copy shows no timestamp by default, explain that new versions will need the purple ⟳ click (the watcher sends a reminder).
   - If they can, ask them to switch to a different tab and run `learn` once more. That confirms reading works while the levels tab is in the background.
7. **Every market:** `node levels-relay.mjs learn --markets` switches the **levels tab** through the 5 markets (about a minute) and puts it back. A market with "No Levels for this Ticker" gets turned off with `--apply`. Tell them which markets will be posted.
8. **Read and compare:** `node levels-relay.mjs read`. Ask them to compare a few numbers per market with their chart (GEX 1, Call Resistance, HVL, 1D Max/Min). The order of the 38 numbers is in `docs/OUTPUT-FORMAT.md`. It also says whether `post` would refuse right now and why (e.g. the levels aren't today's yet).
9. **First post:** only after they confirm. `node levels-relay.mjs post` (add `--force` only if they want to post levels that aren't today's), then check it arrived in Discord.
10. **Hands-off (if step 1 fits):** explain the routine in two sentences. They leave TradingView open with the levels tab, and when MenthorQ publishes, the relay loads the new version on that tab by itself and posts within a few minutes, once per morning and evening. Only if that ever fails do they get a reminder to click the purple ⟳. Then:
    - Run `install-autostart.command` / `.bat` once. It checks the config first.
    - Ask before turning on `start_tradingview` (opens TradingView in the background if it's closed; fine on a computer they don't trade from) or `allow_restart` (quits and reopens TradingView; only on a computer nobody trades from, and never if they chart on a second computer).
    - Run `node levels-relay.mjs status` to confirm it's live and shows the update times.
    - Explain the notices: problems and "nothing posted this morning, because…" go to **#modlog**, never to the levels channel. Without a modlog webhook they only go to `output/failures.log`.
11. **Wrap up:** tell them what's set (channel, markets, windows), how to post by hand (`run`), how to check (`status`), and how to stop it (`uninstall-autostart`).

## If something changes later
- MenthorQ renames or replaces its indicators (TradingView's invite-only rules change Nov 1, 2026; see `docs/MENTHORQ.md`): run `learn --apply` again.
- Levels not posting: `status` first (live? fresh? newer version?), then `output/failures.log`.

## Where things are
- `levels-relay.mjs`: the whole tool, one file, no dependencies. `MENTHORQ` near the top holds what it expects from MenthorQ.
- `config.example.json`: config template. `config.json` is theirs and git-ignored.
- `docs/`: how it works, what we know about MenthorQ, the output format, troubleshooting.
- `output/`: every run (`levels-*.json`), `latest.txt`, `state.json` (what's been posted), `profile.json` (what `learn` found), `failures.log`.
- `test/`: `node test/run.mjs` runs the suite against a fake TradingView.
