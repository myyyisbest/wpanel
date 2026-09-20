@echo off
setlocal EnableExtensions
title WPanel AutoStart Installer

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

"%PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-AutoStart.ps1"
echo.
pause
