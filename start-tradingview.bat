@echo off
REM Starts TradingView Desktop with the debug port the levels tool reads from.
REM If TradingView is already open, close it fully first (check the system tray).
tasklist /fi "imagename eq TradingView.exe" | find /i "TradingView.exe" >nul
if not errorlevel 1 (
    echo TradingView is already running. Close it fully, then run this again.
    pause
    exit /b 1
)
powershell -NoProfile -Command "$pkg = Get-AppxPackage TradingView.Desktop; if ($pkg) { Start-Process (Join-Path $pkg.InstallLocation 'TradingView.exe') -ArgumentList '--remote-debugging-port=9222' } elseif (Test-Path \"$env:LOCALAPPDATA\Programs\TradingView\TradingView.exe\") { Start-Process \"$env:LOCALAPPDATA\Programs\TradingView\TradingView.exe\" -ArgumentList '--remote-debugging-port=9222' } else { Write-Host 'Could not find TradingView Desktop.' }"
echo Started. Give the charts ~30 seconds to load.
