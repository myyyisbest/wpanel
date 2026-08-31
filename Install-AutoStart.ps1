param(
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$TaskName = 'WPanel'
$Root = $PSScriptRoot
$StartupVbs = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\WPanel-AutoStart.vbs'

if ($Remove) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    if (Test-Path $StartupVbs) { Remove-Item $StartupVbs -Force }
    Write-Host 'WPanel 开机自启已移除。' -ForegroundColor Green
    exit 0
}

# 首选计划任务（需要管理员权限）；拒绝访问时自动落到启动文件夹方案（无需管理员）
$registered = $false
try {
    $Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument (
        "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Root\Start-WPanel.ps1`" -NoBrowser"
    )
    $Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
    Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Force -ErrorAction Stop | Out-Null
    $registered = $true
    Write-Host '已注册计划任务：登录时后台静默启动。' -ForegroundColor Green
} catch {
    Write-Host '计划任务注册被拒绝（需要管理员权限），改用启动文件夹方案。' -ForegroundColor Yellow
}

if (-not $registered) {
    $vbs = "CreateObject(""WScript.Shell"").Run ""powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """"$Root\Start-WPanel.ps1"""" -NoBrowser"", 0, False"
    [IO.File]::WriteAllText($StartupVbs, $vbs + "`r`n")
    Write-Host "已写入启动文件夹自启：$StartupVbs" -ForegroundColor Green
}

Write-Host '下次登录 Windows 后，面板将在后台自动启动（不打开浏览器）。'
Write-Host '手动验证：打开 http://localhost:8765'
