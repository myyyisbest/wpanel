param(
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$LogDir = Join-Path $Root 'logs'

[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

function Test-ListeningPort {
    param([int]$Port)
    return $null -ne (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Wait-Http {
    param([string]$Uri, [int]$Seconds = 45)
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 3
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return $true }
        }
        catch { Start-Sleep -Milliseconds 700 }
    } while ((Get-Date) -lt $deadline)
    return $false
}

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    throw '未找到 Node.js。WPanel 需要 Node.js 22.13 或更高版本。'
}
if (-not (Test-Path -LiteralPath (Join-Path $Root 'node_modules'))) {
    throw '依赖尚未安装，请在 WPanel 目录执行 npm install。'
}
if (-not (Test-Path -LiteralPath (Join-Path $Root 'dist'))) {
    throw '生产版本尚未构建，请在 WPanel 目录执行 npm run build。'
}

if (-not (Test-ListeningPort -Port 8766)) {
    Start-Process -FilePath 'node.exe' `
        -ArgumentList 'server.mjs' `
        -WorkingDirectory $Root `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $LogDir 'controller.out.log') `
        -RedirectStandardError (Join-Path $LogDir 'controller.err.log') | Out-Null
}

if (-not (Test-ListeningPort -Port 8765)) {
    Start-Process -FilePath 'npm.cmd' `
        -ArgumentList @('run', 'start', '--', '--hostname', '127.0.0.1', '--port', '8765') `
        -WorkingDirectory $Root `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $LogDir 'ui.out.log') `
        -RedirectStandardError (Join-Path $LogDir 'ui.err.log') | Out-Null
}

$controllerReady = Wait-Http -Uri 'http://127.0.0.1:8766/api/status'
$uiReady = Wait-Http -Uri 'http://localhost:8765/'
if (-not $controllerReady -or -not $uiReady) {
    throw "WPanel 启动未完成。请检查 $LogDir 中的日志。"
}

Write-Host 'WPanel 已启动：http://localhost:8765' -ForegroundColor Green
if (-not $NoBrowser) {
    Start-Process 'http://localhost:8765/'
}
