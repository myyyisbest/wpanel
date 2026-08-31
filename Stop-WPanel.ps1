$ErrorActionPreference = 'Stop'
$RootPattern = [regex]::Escape($PSScriptRoot)
$stopped = [System.Collections.Generic.List[int]]::new()

foreach ($port in @(8765, 8766)) {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
    foreach ($listener in $listeners) {
        if ($stopped.Contains($listener.OwningProcess)) { continue }
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
        if ($null -eq $process) { continue }
        $isWPanel = $process.CommandLine -match $RootPattern -or
            $process.CommandLine -match 'server\.mjs' -or
            $process.CommandLine -match 'vinext.+8765'
        if (-not $isWPanel) {
            Write-Warning "端口 $port 由其他程序占用，PID=$($listener.OwningProcess)，未停止。"
            continue
        }
        Stop-Process -Id $listener.OwningProcess -Force
        $stopped.Add($listener.OwningProcess)
    }
}

if ($stopped.Count -eq 0) {
    Write-Host 'WPanel 当前未运行。'
}
else {
    Write-Host "WPanel 已停止，进程：$($stopped -join ', ')" -ForegroundColor Green
}
