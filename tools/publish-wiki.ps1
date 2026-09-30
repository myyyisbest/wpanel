<#
.SYNOPSIS
    把 docs/wiki/ 下的页面发布到 GitHub Wiki。

.DESCRIPTION
    Wiki 页面的源文件放在主仓库的 docs/wiki/，随代码一起评审；本脚本负责把它们
    同步到 <owner>/<repo>.wiki.git。

    注意：GitHub 只有在「仓库已启用 Wiki」且「网页上创建过至少一个页面」之后，
    才会创建 .wiki.git 仓库。首次发布前请先按提示在网页上建一个空页面。

.EXAMPLE
    .\tools\publish-wiki.ps1
    .\tools\publish-wiki.ps1 -Message 'docs: 更新安装指南' -WhatIf
#>
[CmdletBinding()]
param(
    [string]$Repo = 'https://github.com/myyyisbest/wpanel.wiki.git',
    [string]$Message = 'docs: 同步 Wiki 页面',
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$Source = Join-Path $Root 'docs\wiki'

if (-not (Test-Path -LiteralPath $Source)) { throw "未找到 Wiki 源目录：$Source" }
# README.md 是本目录的说明文档，不作为 Wiki 页面发布
$pages = @(Get-ChildItem -LiteralPath $Source -Filter '*.md' -File | Where-Object { $_.Name -ne 'README.md' })
if ($pages.Count -eq 0) { throw "$Source 下没有可发布的 .md 页面" }

Write-Host ("待发布页面（{0}）：{1}" -f $pages.Count, (($pages | ForEach-Object { $_.Name }) -join ', ')) -ForegroundColor Cyan

$Work = Join-Path ([IO.Path]::GetTempPath()) ('wpanel-wiki-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))

Write-Host "克隆 Wiki 仓库：$Repo"
git clone --quiet $Repo $Work 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw @"
Wiki 仓库克隆失败。请依次确认：
  1) 仓库已启用 Wiki —— GitHub → 仓库 Settings → Features → 勾选 "Wikis"；
  2) 已在网页上创建过至少一个页面 —— GitHub 只有在首次保存页面后才会创建 .wiki.git 仓库；
  3) 当前 git 凭据对 $Repo 有写权限。
完成后重新运行本脚本即可。
"@
}

try {
    Push-Location $Work

    # 主仓库的提交身份优先，避免 wiki 仓库缺少 user.name / user.email
    $name = git -C $Root config user.name
    $email = git -C $Root config user.email
    if ($name) { git config user.name $name }
    if ($email) { git config user.email $email }

    Get-ChildItem -Filter '*.md' -File | Remove-Item -Force
    $pages | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $Work -Force }

    git add -A

    if ($WhatIf) {
        git status --short
        Write-Host '（-WhatIf：仅展示变更，未提交、未推送）' -ForegroundColor Yellow
        return
    }

    $pending = git status --porcelain
    if (-not $pending) {
        Write-Host 'Wiki 已是最新，无需发布。' -ForegroundColor Green
        return
    }

    git commit --quiet -m $Message
    git push --quiet origin HEAD
    if ($LASTEXITCODE -ne 0) { throw '推送失败，请检查凭据与网络。' }

    Write-Host 'Wiki 已发布。' -ForegroundColor Green
}
finally {
    Pop-Location
    if (Test-Path -LiteralPath $Work) { Remove-Item -LiteralPath $Work -Recurse -Force }
}
