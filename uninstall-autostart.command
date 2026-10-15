#!/bin/bash
# Stops levels-relay from starting at login and stops the running watcher.
PLIST="$HOME/Library/LaunchAgents/com.levels-relay.watch.plist"
launchctl unload "$PLIST" 2>/dev/null; rm -f "$PLIST"
echo "Removed."
