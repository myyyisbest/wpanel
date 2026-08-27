@echo off
setlocal EnableExtensions
title WPanel Launcher
where pwsh.exe >nul 2>&1
if errorlevel 1 (
    echo [ERROR] PowerShell 7 ^(pwsh.exe^) was not found.
    pause
    exit /b 1
)
pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-WPanel.ps1"
set "SCRIPT_EXIT=%ERRORLEVEL%"
echo.
if "%SCRIPT_EXIT%"=="0" (
    echo [OK] WPanel is running.
    echo URL: http://localhost:8765/
) else (
    echo [ERROR] WPanel failed to start. Exit code: %SCRIPT_EXIT%
    echo Logs: %~dp0logs
)
echo.
pause
exit /b %SCRIPT_EXIT%
