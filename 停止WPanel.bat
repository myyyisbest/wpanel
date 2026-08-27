@echo off
setlocal EnableExtensions
title Stop WPanel
where pwsh.exe >nul 2>&1
if errorlevel 1 (
    echo [ERROR] PowerShell 7 ^(pwsh.exe^) was not found.
    pause
    exit /b 1
)
pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Stop-WPanel.ps1"
set "SCRIPT_EXIT=%ERRORLEVEL%"
echo.
if "%SCRIPT_EXIT%"=="0" (
    echo [OK] WPanel stop operation completed.
    echo WSL, Docker and containers were not stopped.
) else (
    echo [ERROR] WPanel failed to stop. Exit code: %SCRIPT_EXIT%
)
echo.
pause
exit /b %SCRIPT_EXIT%
