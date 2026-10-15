@echo off
REM Starts the levels-relay watcher every time you log in to Windows.
REM Uses your Startup folder, so it needs no administrator rights.
REM Undo with uninstall-autostart.bat.
cd /d "%~dp0"
where node >nul 2>&1 || (
  echo Node.js isn't installed yet. Get the LTS version from https://nodejs.org, install it, then run this again.
  pause
  exit /b 1
)
if not exist config.json (
  echo config.json is missing. Copy config.example.json to config.json and add your webhook first.
  pause
  exit /b 1
)
node levels-relay.mjs validate || (
  pause
  exit /b 1
)
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
(
  echo @echo off
  echo cd /d "%~dp0"
  echo start "levels-relay" /min cmd /c "node levels-relay.mjs watch ^>^> output\watch.log 2^>^&1"
) > "%STARTUP%\levels-relay.bat"
if not exist output mkdir output
echo Done. The watcher will start minimized every time you log in. Starting it now as well...
start "levels-relay" /min cmd /c "node levels-relay.mjs watch >> output\watch.log 2>&1"
pause
