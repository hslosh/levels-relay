#!/bin/bash
# Leave this window open: posts automatically at the times in config.json.
cd "$(dirname "$0")"
node levels-relay.mjs watch
