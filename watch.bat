@echo off
REM Leave this window open: posts automatically at the times in config.json.
cd /d "%~dp0"
where node >nul 2>&1 || (
  echo Node.js isn't installed yet. Get the LTS version from https://nodejs.org, install it, then run this again.
  pause
  exit /b 1
)
node levels-relay.mjs watch
pause
