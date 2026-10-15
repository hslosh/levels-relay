# How it works

TradingView Desktop is a Chrome-based app. Started with `--remote-debugging-port=9222`, it lets a local program read the chart the same way the browser's developer tools do. Nothing goes over the internet for this; the program talks to the app on your own machine.

For each market (NQ, ES, GC, CL, SI), `levels-relay`:

1. **Switches the chart** to that symbol and waits for the two MenthorQ indicators (EOD and Intraday) to finish calculating, i.e. until their output stops changing.
2. **Reads what MenthorQ drew:**
   - **The "Key Levels" table, if it's on the chart.** It prints each level's name and exact value, so this is the preferred source.
   - **Otherwise, the labels on the levels** ("GEX 1", "Call Resistance 0DTE / Gamma Wall 0DTE", …). A label joined with "/" means those levels share one line, so each name gets that price. Each label is snapped to the line it sits on.
3. **Builds the indicator string:** 19 EOD values, then 19 Intraday values, in the indicator's fixed order (see [OUTPUT-FORMAT.md](OUTPUT-FORMAT.md)). A level that isn't on the chart is `0`, which the indicator skips.

Then it switches the chart back to where it was, re-hides any indicator it had to show (hidden indicators don't calculate), saves a copy to `output/`, and, for `post` and `watch`, sends the strings to your Discord webhook.

## Why this beats screenshots + AI
- **No reading pixels.** The values come from the chart's own data, with every decimal kept (31135.99, not 31136).
- **No overlap problems.** Labels that overlap on screen are separate objects in the data.
- **No cut-off prices.** A level outside the visible screen area is still in the data.

## What it doesn't do
- It doesn't trade, change indicator settings, or touch anything except the chart's symbol (and it puts that back).
- It doesn't send anything anywhere except the one webhook in `config.json`.
