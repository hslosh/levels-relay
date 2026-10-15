@echo off
REM Starts the levels-relay watcher every time you log in to Windows.
REM Undo with uninstall-autostart.bat.
cd /d "%~dp0"
if not exist config.json (
  echo config.json is missing. Copy config.example.json to config.json and add your webhook first.
  pause
  exit /b 1
)
schtasks /Create /TN "levels-relay" /SC ONLOGON /TR "\"%~dp0watch.bat\"" /F
if errorlevel 1 (
  echo Could not create the scheduled task.
) else (
  echo Done. The watcher will start at your next login. Starting it now as well...
  start "" "%~dp0watch.bat"
)
pause
