param(
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$TaskName = 'WPanel'

if ($Remove) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host 'WPanel 开机自启已移除。' -ForegroundColor Green
    exit 0
}

$Root = $PSScriptRoot
$Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument (
    "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Root\Start-WPanel.ps1`" -NoBrowser"
)
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Force | Out-Null

Write-Host 'WPanel 开机自启已安装：登录 Windows 后面板将在后台自动启动（不打开浏览器）。' -ForegroundColor Green
Write-Host "手动运行一次：schtasks /Run /TN $TaskName"
