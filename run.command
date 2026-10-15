#!/bin/bash
# Double-click: read the levels once and post them.  ./run.command read = read only, no post.
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then
  echo "Node.js isn't installed yet. Get the LTS version from https://nodejs.org, install it, then open this again."
  exit 1
fi
node levels-relay.mjs "${1:-post}"
