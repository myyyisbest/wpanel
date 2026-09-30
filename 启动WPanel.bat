@echo off
setlocal EnableExtensions
title WPanel Launcher

rem Use PowerShell 7 when present, otherwise fall back to the Windows built-in
rem PowerShell 5.1. The .ps1 scripts are written to work on both.
set "PS="
where pwsh.exe >nul 2>&1
if not errorlevel 1 set "PS=pwsh.exe"
if not defined PS (
    where powershell.exe >nul 2>&1
    if not errorlevel 1 set "PS=powershell.exe"
)
if not defined PS (
    echo [ERROR] PowerShell not found ^(neither pwsh.exe nor powershell.exe^).
    pause
    exit /b 1
)

"%PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-WPanel.ps1"
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
