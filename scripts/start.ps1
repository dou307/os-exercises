# 启动练习站：构建 dist/ 并提供 HTTP 服务。
# 必须用 HTTP 访问：双击 index.html 会因 fetch 限制而加载不到数据。
#
# 默认只绑 127.0.0.1（本机）。加 -Lan 时绑 0.0.0.0，同一局域网的手机/平板也能访问。
# 注意：-Lan 会把服务暴露给同网段所有人，适合家庭/宿舍内网，不要在公共 Wi-Fi 下用。

param(
    [int]$Port = 8765,
    [switch]$NoBuild,
    [switch]$Open,
    [switch]$Lan
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

$bind = if ($Lan) { '0.0.0.0' } else { '127.0.0.1' }
Write-Host "服务地址：http://127.0.0.1:$Port/"

if ($Lan) {
    Write-Host '局域网地址（同一 Wi-Fi 下的手机/平板可用）：'
    Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
        ForEach-Object { Write-Host "  http://$($_.IPAddress):$Port/" }
    Write-Host '提示：学习记录按 origin 隔离，局域网地址换了端口或 IP 不会自动继承。'
}

Write-Host '按 Ctrl+C 停止。'
if ($Open) { Start-Process "http://127.0.0.1:$Port/" }

& $python -m http.server $Port --bind $bind --directory 'dist'
