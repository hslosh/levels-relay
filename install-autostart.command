#!/bin/bash
# Starts the levels-relay watcher every time you log in to this Mac.
# Undo with uninstall-autostart.command.
cd "$(dirname "$0")"
DIR="$(pwd)"
NODE="$(command -v node)"
if [ -z "$NODE" ]; then echo "Node.js not found. Install it from https://nodejs.org first."; exit 1; fi
if [ ! -f config.json ]; then echo "config.json is missing. Copy config.example.json to config.json and add your webhook first."; exit 1; fi
mkdir -p output
PLIST="$HOME/Library/LaunchAgents/com.levels-relay.watch.plist"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.levels-relay.watch</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/levels-relay.mjs</string><string>watch</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/output/watch.log</string>
  <key>StandardErrorPath</key><string>$DIR/output/watch.log</string>
</dict></plist>
PL
launchctl unload "$PLIST" 2>/dev/null
launchctl load "$PLIST" && echo "Done. The watcher is running now and will start at every login. Log: output/watch.log"
