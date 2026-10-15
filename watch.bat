@echo off
REM Leave this window open: posts automatically at the times in config.json.
cd /d "%~dp0"
node levels-relay.mjs watch
