# 启动本地练习站：构建 dist/ 并在 127.0.0.1 上提供 HTTP 服务。
# 必须用 HTTP 访问：双击 index.html 会因 fetch 限制而无法加载数据。

param(
    [int]$Port = 8765,
    [switch]$NoBuild,
    [switch]$Open
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

$python = $null
foreach ($candidate in @('python', 'py')) {
    $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($cmd) { $python = $cmd.Source; break }
}
if (-not $python) {
    throw '未找到 Python，请先安装 Python 3 并加入 PATH。'
}

if (-not $NoBuild) {
    Write-Host '正在构建 dist/ ...'
    & $python -X utf8 'scripts/build.py'
    if ($LASTEXITCODE -ne 0) { throw '构建失败，请查看上方输出。' }
}

$url = "http://127.0.0.1:$Port/"
Write-Host "服务地址：$url"
Write-Host '按 Ctrl+C 停止。'
if ($Open) { Start-Process $url }

& $python -m http.server $Port --bind 127.0.0.1 --directory 'dist'
