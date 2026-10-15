# Setting up levels-relay (instructions for Claude)

You're helping a trader set up **levels-relay**. It reads MenthorQ gamma levels off their TradingView Desktop chart and posts the number strings for the Option Levels / Auto-GEX indicator to their Discord. They may not be technical. Keep every message short and in plain language, do one step at a time, and confirm each step worked before moving on.

## Ground rules
- **Never post to Discord until the user has compared `read` output to their chart and said it's right.**
- **Never put their webhook URL in chat output, logs or commits.** It lives only in `config.json`, which is git-ignored.
- **Never reload a TradingView window to fix something.** Reloading through the debug connection can log the window out. If TradingView misbehaves, ask the user to fully quit it and start it again with the start script.
- **Don't restart or close TradingView without asking.** It's their live trading app.
- Don't install packages. The tool needs only Node 22+.

## Steps

1. **Node.js:** run `node --version`. If it's missing or below 22, send them to https://nodejs.org (LTS) and wait.
2. **Self-test:** run `node levels-relay.mjs selftest`. All checks should pass. If any fail, stop and report.
3. **Webhooks:** ask them to create a Discord webhook in the channel the levels go to: *Channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL*. It must start with `https://discord.com/api/webhooks/`. An invite link (`discord.gg/…`) won't work. Then ask for a **second webhook in their #modlog channel** (or any private staff channel) for failure notices. Failures never go to the levels channel.
4. **Config:** copy `config.example.json` to `config.json`. Write the levels webhook into `webhook_url` and the #modlog one into `modlog_webhook_url` (or set it to `""` if they skipped it). Don't echo either URL back.
5. **TradingView with the debug port:**
   - Check whether port 9222 answers: `curl -s http://127.0.0.1:9222/json/version` (Windows PowerShell: `Invoke-RestMethod http://127.0.0.1:9222/json/version`).
   - If it doesn't, ask the user to **fully quit** TradingView themselves (Windows: also the system tray), then run `start-tradingview.bat` (Windows) or `start-tradingview.command` (Mac). Wait about 30 seconds.
6. **Check:** run `node levels-relay.mjs check`.
   - Both MenthorQ indicators should show ✅.
   - If not, show them the list and set `studies.eod` / `studies.intraday` in `config.json` to part of the exact names they see.
   - If it reports "Session disconnected", ask them to click **Connect** in TradingView.
7. **Read (no posting):** run `node levels-relay.mjs read`. It switches the chart through 5 markets (about a minute) and puts it back. Ask them to compare a few numbers per market with their chart, especially GEX 1, Call Resistance, HVL and 1D Max/Min. The order of the 38 numbers is in `docs/OUTPUT-FORMAT.md`.
   - If numbers are missing or wrong, run `node levels-relay.mjs dump` on that market and look at what the chart reports. Usually it's a label name the parser doesn't know yet: extend `namesIn()` and `selftest`, then rerun.
8. **First post:** only after they confirm. Run `node levels-relay.mjs post` and check it arrived in Discord.
9. **Hands-off posting (ask if they want it):** the default `mode: "update"` posts as soon as MenthorQ's "Last Update" stamp changes (checked every 3 min, 7:30–11:30 and 19:00–23:00 ET).
   - `start_tradingview` (on by default) starts TradingView with the debug port whenever it's closed. Nothing to decide.
   - **Ask before turning on `take_back_session`.** Explain: TradingView streams to one device at a time; if they open it on their phone or another computer, this machine's chart freezes and the post fails. With `take_back_session: true`, the watcher restarts TradingView here to take the session back, which bumps the other device for about a minute. Leave it `false` unless they say yes. Failures are still reported either way.
   - Run `install-autostart.bat` / `install-autostart.command` once. Have them set the computer to never sleep (Windows: Settings → System → Power → Sleep: Never; the Mac script keeps the Mac awake on its own).
   - Run `node levels-relay.mjs status` to confirm it sees the chart and a "Last Update" stamp.
   - Explain the failure notices: if a run fails, a "⚠️ levels-relay couldn't post the levels: reason" message goes to **#modlog** (`modlog_webhook_url`), never to the levels channel. If they have no modlog webhook, failures only go to `output/failures.log`. Recommend setting it up so they actually hear about failures.
10. **Wrap up:** tell them what's set (channel, times, markets) and how to stop it (close the watch window, or run the matching `uninstall-autostart` script).

## Where things are
- `levels-relay.mjs`: the whole tool, one file, no dependencies.
- `config.example.json`: config template. `config.json` is theirs and git-ignored.
- `docs/`: how it works, the output format, troubleshooting.
- `output/`: a copy of every run; `latest.txt` is the newest.
