@echo off
REM Double-click: read the levels once and post them.  run.bat read  = read only, no post.
cd /d "%~dp0"
where node >nul 2>&1 || (
  echo Node.js isn't installed yet. Get the LTS version from https://nodejs.org, install it, then run this again.
  pause
  exit /b 1
)
if "%1"=="" (node levels-relay.mjs post) else (node levels-relay.mjs %*)
pause
