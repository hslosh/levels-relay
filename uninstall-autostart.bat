@echo off
REM Stops levels-relay from starting at login.
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\levels-relay.bat" 2>nul
schtasks /Delete /TN "levels-relay" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq levels-relay*" /T /F >nul 2>&1
echo Removed, and the running watcher was stopped.
pause
