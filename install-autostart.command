#!/bin/bash
# Starts the levels-relay watcher every time you log in to this Mac.
# Undo with uninstall-autostart.command.
cd "$(dirname "$0")"
DIR="$(pwd)"
NODE="$(command -v node)"
if [ -z "$NODE" ]; then echo "Node.js isn't installed yet. Get the LTS version from https://nodejs.org, install it, then open this again."; exit 1; fi
"$NODE" -e "process.exit(+process.versions.node.split('.')[0] < 22 ? 1 : 0)" || { echo "Node.js is too old (need 22 or newer). Install the LTS version from https://nodejs.org."; exit 1; }
if [ ! -f config.json ]; then echo "config.json is missing. Copy config.example.json to config.json and add your webhook first."; exit 1; fi
"$NODE" levels-relay.mjs validate --watch || exit 1
mkdir -p output
PLIST="$HOME/Library/LaunchAgents/com.levels-relay.watch.plist"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.levels-relay.watch</string>
  <key>ProgramArguments</key><array><string>/usr/bin/caffeinate</string><string>-i</string><string>$NODE</string><string>$DIR/levels-relay.mjs</string><string>watch</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>300</integer>
  <key>Nice</key><integer>10</integer>
  <key>StandardOutPath</key><string>$DIR/output/watch.log</string>
  <key>StandardErrorPath</key><string>$DIR/output/watch.log</string>
</dict></plist>
PL
launchctl unload "$PLIST" 2>/dev/null
launchctl load "$PLIST" && echo "Done. The watcher is running now, keeps the Mac awake while it runs, and starts at every login. Log: output/watch.log"
