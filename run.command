#!/bin/bash
# Double-click: read the levels once and post them.  ./run.command read = read only, no post.
cd "$(dirname "$0")"
node levels-relay.mjs "${1:-post}"
