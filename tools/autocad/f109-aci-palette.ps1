param(
  [Parameter(Mandatory = $true)][string]$PidPath,
  [Parameter(Mandatory = $true)][string]$OwnershipToken
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class F109AciWindowProcess {
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@

function Invoke-ComRetry {
  param([Parameter(Mandatory = $true)][scriptblock]$Action, [int]$TimeoutSeconds = 25)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    try { return (& $Action) } catch {
      if ([DateTime]::UtcNow -ge $deadline) { throw }
      Start-Sleep -Milliseconds 150
    }
  } while ($true)
}

$preExistingProcessIds = @(Get-Process -Name 'acad' -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.Id })
$acad = $null
$owned = $false
$automationProcessId = 0
$quitRequested = $false
try {
  # COM activation is single-shot: retrying New-Object can launch multiple
  # unauthenticated acad.exe processes when registration is slow.
  $acad = New-Object -ComObject AutoCAD.Application.24.3
  [uint32]$resolvedProcessId = 0
  [void][F109AciWindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry { $acad.HWND }), [ref]$resolvedProcessId)
  $automationProcessId = [int]$resolvedProcessId
  if ($automationProcessId -le 0) { throw 'Could not resolve the F-109 ACI AutoCAD process.' }
  $owned = $automationProcessId -gt 0 -and $preExistingProcessIds -notcontains $automationProcessId
  if (-not $owned) { throw 'F-109 ACI read-back refuses to use a pre-existing AutoCAD process.' }
  [ordered]@{ schemaVersion = 1; processId = $automationProcessId; owned = $true; token = $OwnershipToken } | ConvertTo-Json -Compress | Set-Content -LiteralPath $PidPath -Encoding ascii
  Invoke-ComRetry { $acad.Visible = $true } | Out-Null
  $engineVersion = [string](Invoke-ComRetry { $acad.Version })
  $color = Invoke-ComRetry { $acad.GetInterfaceObject('AutoCAD.AcCmColor.24') }
  $palette = New-Object System.Collections.Generic.List[string]
  for ($index = 1; $index -le 255; $index++) {
    Invoke-ComRetry { $color.ColorIndex = $index } | Out-Null
    $red = [int](Invoke-ComRetry { $color.Red })
    $green = [int](Invoke-ComRetry { $color.Green })
    $blue = [int](Invoke-ComRetry { $color.Blue })
    $palette.Add(('#{0:X2}{1:X2}{2:X2}' -f $red, $green, $blue).ToLowerInvariant())
  }
  [ordered]@{
    schemaVersion = 1
    rowId = 'F-109'
    benchmark = 'AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation'
    engine = 'Autodesk AutoCAD 2024 desktop COM AcCmColor.24'
    engineVersion = $engineVersion
    automationProcessId = $automationProcessId
    automationProcessOwned = $owned
    indices = '1..255'
    palette = [object[]]$palette.ToArray()
    status = if ($palette.Count -eq 255) { 'PASS' } else { 'FAIL' }
  } | ConvertTo-Json -Depth 6 -Compress
} finally {
  if ($owned -and $acad) {
    try { Invoke-ComRetry { $acad.Quit() } -TimeoutSeconds 10 | Out-Null; $quitRequested = $true } catch {}
  }
  if (-not $quitRequested -and $owned) { Write-Error 'F-109 ACI owned AutoCAD process did not accept Quit.' }
}
