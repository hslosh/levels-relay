@echo off
REM Double-click: read the levels once and post them.  run.bat read  = read only, no post.
cd /d "%~dp0"
if "%1"=="" (node levels-relay.mjs post) else (node levels-relay.mjs %*)
pause
