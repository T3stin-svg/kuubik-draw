$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location -LiteralPath $projectRoot

& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "Production build failed with exit code $LASTEXITCODE" }

& npm.cmd run desktop:test
if ($LASTEXITCODE -ne 0) { throw "Desktop tests failed with exit code $LASTEXITCODE" }

& npm.cmd run desktop:package:raw
if ($LASTEXITCODE -ne 0) { throw "Windows package failed with exit code $LASTEXITCODE" }

$artifact = Get-ChildItem -LiteralPath (Join-Path $projectRoot 'release') -Filter 'KuubikDraw-Lite-*-portable.exe' -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if ($null -eq $artifact) { throw 'Portable executable was not created.' }

$sha256 = [System.Security.Cryptography.SHA256]::Create()
$stream = [System.IO.File]::OpenRead($artifact.FullName)
try {
    $hashBytes = $sha256.ComputeHash($stream)
    $hashHex = ([System.BitConverter]::ToString($hashBytes)).Replace('-', '')
}
finally {
    $stream.Dispose()
    $sha256.Dispose()
}
$manifest = [ordered]@{
    product = 'Kuubik Draw Lite'
    version = '0.1.0-alpha.0'
    built_at = (Get-Date).ToString('o')
    artifact = $artifact.Name
    bytes = $artifact.Length
    sha256 = $hashHex
    platform = 'Windows x64 portable'
    runtime = 'Electron with bundled Chromium'
    source_commit = (& git rev-parse HEAD).Trim()
}
$json = $manifest | ConvertTo-Json
[System.IO.File]::WriteAllText((Join-Path $projectRoot 'release\manifest.json'), $json, [System.Text.UTF8Encoding]::new($false))

Write-Host "PASS: $($artifact.FullName)"
Write-Host "SHA256: $hashHex"
