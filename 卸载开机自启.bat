@echo off
setlocal EnableExtensions
title WPanel AutoStart Remover
where pwsh.exe >nul 2>&1
if errorlevel 1 (
    echo [ERROR] PowerShell 7 ^(pwsh.exe^) was not found.
    pause
    exit /b 1
)
pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-AutoStart.ps1" -Remove
echo.
pause
