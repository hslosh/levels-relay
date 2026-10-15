@echo off
REM Used by install-autostart.bat: runs the watcher and restarts it if it ever stops.
title levels-relay
cd /d "%~dp0"
if not exist output mkdir output
:loop
node levels-relay.mjs watch >> output\watch.log 2>&1
REM don't loop on a broken config.json: stop until it's fixed
node levels-relay.mjs validate --watch >nul 2>&1 || exit /b 1
timeout /t 60 /nobreak >nul
goto loop
