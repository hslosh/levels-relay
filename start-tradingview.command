#!/bin/bash
# Starts TradingView Desktop with the debug port the levels tool reads from.
if pgrep -x TradingView >/dev/null; then
  echo "TradingView is already running. Quit it (Cmd+Q), then run this again."
  exit 1
fi
open -a TradingView --args --remote-debugging-port=9222
echo "Started. Give the charts ~30 seconds to load."
