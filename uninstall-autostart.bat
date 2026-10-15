@echo off
REM Stops levels-relay from starting at login.
schtasks /Delete /TN "levels-relay" /F
echo Removed. Close any open watch window to stop the current watcher.
pause
