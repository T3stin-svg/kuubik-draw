param(
  [Parameter(Mandatory = $true)][string]$TempDwgPath,
  [Parameter(Mandatory = $true)][string]$TempPngPath,
  [Parameter(Mandatory = $true)][string]$PidPath,
  [Parameter(Mandatory = $true)][string]$OwnershipToken
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class F098WindowProcess {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")]
  public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint flags);
}
'@

function Invoke-ComRetry {
  param([Parameter(Mandatory = $true)][scriptblock]$Action, [int]$TimeoutSeconds = 20)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    try { return (& $Action) } catch {
      if ([DateTime]::UtcNow -ge $deadline) { throw }
      Start-Sleep -Milliseconds 150
    }
  } while ($true)
}

function Wait-AcadIdle {
  param([Parameter(Mandatory = $true)]$Document, [int]$TimeoutSeconds = 30)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 100
    try {
      if ([string]::IsNullOrWhiteSpace([string]$Document.GetVariable('CMDNAMES')) -and [int]$Document.GetVariable('CMDACTIVE') -eq 0) { return }
    } catch {}
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "AutoCAD did not return idle for F-098."
}

function Send-AcadCommand {
  param([Parameter(Mandatory = $true)]$Document, [Parameter(Mandatory = $true)][string]$Command)
  Invoke-ComRetry { $Document.SendCommand($Command) } | Out-Null
  Wait-AcadIdle $Document
}

function Get-Sha256 {
  param([Parameter(Mandatory = $true)][string]$Path)
  $stream = [IO.File]::OpenRead($Path)
  try {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
  } finally { $stream.Dispose() }
}

function Get-PaperSnapshot {
  param([Parameter(Mandatory = $true)]$Document)
  $layout = Invoke-ComRetry {
    $candidate = $Document.ActiveLayout
    if (-not $candidate) { throw 'ActiveLayout is temporarily unavailable.' }
    $candidate
  }
  [double]$paperWidth = 0
  [double]$paperHeight = 0
  Invoke-ComRetry { $layout.GetPaperSize([ref]$paperWidth, [ref]$paperHeight) } | Out-Null
  $plotRotation = [int]$layout.PlotRotation
  $orientedWidth = if ($plotRotation -in @(1, 3)) { $paperHeight } else { $paperWidth }
  $orientedHeight = if ($plotRotation -in @(1, 3)) { $paperWidth } else { $paperHeight }
  $circles = @(Invoke-ComRetry { @($layout.Block | Where-Object { [string]$_.ObjectName -eq 'AcDbCircle' }) })
  return [ordered]@{
    layoutName = [string]$layout.Name
    layoutKind = if ([string]$layout.Name -eq 'Model') { 'model' } else { 'paper' }
    tileMode = [int](Invoke-ComRetry { $Document.GetVariable('TILEMODE') })
    cvport = [int](Invoke-ComRetry { $Document.GetVariable('CVPORT') })
    mSpace = [bool](Invoke-ComRetry { $Document.MSpace })
    activeSpace = [int](Invoke-ComRetry { $Document.ActiveSpace })
    configName = [string](Invoke-ComRetry { $layout.ConfigName })
    paperUnits = [int](Invoke-ComRetry { $layout.PaperUnits })
    canonicalMediaName = [string](Invoke-ComRetry { $layout.CanonicalMediaName })
    plotRotation = $plotRotation
    rawPaperWidth = $paperWidth
    rawPaperHeight = $paperHeight
    paperWidth = $orientedWidth
    paperHeight = $orientedHeight
    circleCount = [int]$circles.Count
    circleHandles = @($circles | ForEach-Object { [string]$_.Handle })
  }
}

function Set-A3LandscapePlotConfiguration {
  param([Parameter(Mandatory = $true)]$Document)
  $layout = Invoke-ComRetry {
    $candidate = $Document.ActiveLayout
    if (-not $candidate -or [bool]$candidate.ModelType) { throw 'F-098 active paper layout is temporarily unavailable.' }
    $candidate
  }
  Invoke-ComRetry {
    $layout.ConfigName = 'DWG To PDF.pc3'
    $layout.RefreshPlotDeviceInfo()
    $layout.PaperUnits = 1
    $a3Media = @($layout.GetCanonicalMediaNames() | Where-Object {
      [string]$_ -match '(?i)A3' -and [string]$_ -match '420' -and [string]$_ -match '297'
    } | Sort-Object { [string]$_ -match '(?i)full.?bleed' } | Select-Object -First 1)
    if ($a3Media.Count -ne 1) { throw 'DWG To PDF.pc3 did not expose a canonical ISO A3 medium.' }
    $layout.CanonicalMediaName = [string]$a3Media[0]
    $layout.PlotRotation = 0
  } | Out-Null
  [double]$configuredWidth = 0; [double]$configuredHeight = 0
  Invoke-ComRetry { $layout.GetPaperSize([ref]$configuredWidth, [ref]$configuredHeight) } | Out-Null
  if ($configuredWidth -lt $configuredHeight) { Invoke-ComRetry { $layout.PlotRotation = 1 } | Out-Null }
}

function Test-A3PaperSnapshot {
  param($Snapshot)
  return $Snapshot.layoutName -eq 'F098 PAPER' -and $Snapshot.layoutKind -eq 'paper' -and
    $Snapshot.tileMode -eq 0 -and $Snapshot.cvport -eq 1 -and -not $Snapshot.mSpace -and $Snapshot.activeSpace -eq 0 -and
    $Snapshot.configName -eq 'DWG To PDF.pc3' -and $Snapshot.paperUnits -eq 1 -and
    [string]$Snapshot.canonicalMediaName -match '(?i)A3' -and
    [Math]::Abs($Snapshot.paperWidth - 420) -lt 0.01 -and [Math]::Abs($Snapshot.paperHeight - 297) -lt 0.01 -and
    $Snapshot.circleCount -eq 1 -and $Snapshot.circleHandles.Count -eq 1
}

function Get-StableA3PaperSnapshot {
  param($Document, [bool]$RepairConfiguration, [int]$MaximumPasses = 12)
  $passes = New-Object System.Collections.Generic.List[object]
  $lastSnapshot = $null
  $previousFingerprint = $null
  $consecutiveExactReads = 0
  for ($pass = 1; $pass -le $MaximumPasses; $pass += 1) {
    if ($RepairConfiguration -and $consecutiveExactReads -eq 0) { Set-A3LandscapePlotConfiguration $Document }
    Wait-AcadIdle $Document
    $lastSnapshot = Get-PaperSnapshot $Document
    $exact = Test-A3PaperSnapshot $lastSnapshot
    $fingerprint = if ($exact) { $lastSnapshot | ConvertTo-Json -Depth 6 -Compress } else { $null }
    if ($fingerprint -and $fingerprint -eq $previousFingerprint) { $consecutiveExactReads += 1 }
    elseif ($fingerprint) { $consecutiveExactReads = 1 }
    else { $consecutiveExactReads = 0 }
    $passes.Add([ordered]@{
      pass=$pass; exact=$exact; consecutiveExactReads=$consecutiveExactReads
      configName=$lastSnapshot.configName; paperUnits=$lastSnapshot.paperUnits; canonicalMediaName=$lastSnapshot.canonicalMediaName
      paperWidth=$lastSnapshot.paperWidth; paperHeight=$lastSnapshot.paperHeight
    })
    if ($consecutiveExactReads -ge 2) {
      return [ordered]@{ stable=$true; snapshot=$lastSnapshot; passes=[object[]]$passes.ToArray() }
    }
    $previousFingerprint = $fingerprint
    Start-Sleep -Milliseconds 150
  }
  return [ordered]@{ stable=$false; snapshot=$lastSnapshot; passes=[object[]]$passes.ToArray() }
}

function Measure-VisiblePaper {
  param([Parameter(Mandatory = $true)][int64]$Hwnd, [Parameter(Mandatory = $true)][string]$PngPath)
  $rect = New-Object F098WindowProcess+RECT
  if (-not [F098WindowProcess]::GetWindowRect([IntPtr]$Hwnd, [ref]$rect)) { throw 'Could not resolve AutoCAD window bounds.' }
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  if ($width -lt 800 -or $height -lt 600) { throw "AutoCAD window is too small for F-098 capture: ${width}x${height}." }
  $bitmap = New-Object Drawing.Bitmap($width, $height, [Drawing.Imaging.PixelFormat]::Format24bppRgb)
  try {
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
      $deviceContext = $graphics.GetHdc()
      try {
        if (-not [F098WindowProcess]::PrintWindow([IntPtr]$Hwnd, $deviceContext, 2)) { throw 'PrintWindow failed for the owned AutoCAD window.' }
      } finally { $graphics.ReleaseHdc($deviceContext) }
    } finally { $graphics.Dispose() }
    $bitmap.Save($PngPath, [Drawing.Imaging.ImageFormat]::Png)
    $step = 8
    $startX = [int]($width * 0.04)
    $endX = [int]($width * 0.96)
    $startY = [Math]::Max(150, [int]($height * 0.15))
    $endY = [Math]::Min($height - 70, [int]($height * 0.94))
    $columns = [int][Math]::Ceiling(($endX - $startX) / $step)
    $rows = [int][Math]::Ceiling(($endY - $startY) / $step)
    $bright = New-Object 'bool[]' ($columns * $rows)
    for ($row = 0; $row -lt $rows; $row += 1) {
      $y = $startY + $row * $step
      for ($column = 0; $column -lt $columns; $column += 1) {
        $x = $startX + $column * $step
        $pixel = $bitmap.GetPixel($x, $y)
        $bright[$row * $columns + $column] = $pixel.R -ge 220 -and $pixel.G -ge 220 -and $pixel.B -ge 220
      }
    }
    $visited = New-Object 'bool[]' ($columns * $rows)
    $best = [ordered]@{ count = 0; minColumn = 0; maxColumn = -1; minRow = 0; maxRow = -1 }
    for ($index = 0; $index -lt $bright.Length; $index += 1) {
      if (-not $bright[$index] -or $visited[$index]) { continue }
      $queue = [Collections.Generic.Queue[int]]::new()
      $queue.Enqueue($index); $visited[$index] = $true
      $count = 0; $minColumn = $columns; $maxColumn = -1; $minRow = $rows; $maxRow = -1
      while ($queue.Count -gt 0) {
        $current = $queue.Dequeue()
        $currentRow = [int][Math]::Floor($current / $columns)
        $currentColumn = $current % $columns
        $count += 1
        $minColumn = [Math]::Min($minColumn, $currentColumn); $maxColumn = [Math]::Max($maxColumn, $currentColumn)
        $minRow = [Math]::Min($minRow, $currentRow); $maxRow = [Math]::Max($maxRow, $currentRow)
        $neighbors = @(
          if ($currentColumn -gt 0) { $current - 1 }
          if ($currentColumn -lt $columns - 1) { $current + 1 }
          if ($currentRow -gt 0) { $current - $columns }
          if ($currentRow -lt $rows - 1) { $current + $columns }
        )
        foreach ($neighbor in $neighbors) {
          if ($bright[$neighbor] -and -not $visited[$neighbor]) { $visited[$neighbor] = $true; $queue.Enqueue($neighbor) }
        }
      }
      if ($count -gt $best.count) { $best = [ordered]@{ count = $count; minColumn = $minColumn; maxColumn = $maxColumn; minRow = $minRow; maxRow = $maxRow } }
    }
    $sheetX = $startX + $best.minColumn * $step
    $sheetY = $startY + $best.minRow * $step
    $sheetWidth = if ($best.maxColumn -ge $best.minColumn) { ($best.maxColumn - $best.minColumn + 1) * $step } else { 0 }
    $sheetHeight = if ($best.maxRow -ge $best.minRow) { ($best.maxRow - $best.minRow + 1) * $step } else { 0 }
    return [ordered]@{
      window = [ordered]@{ width = $width; height = $height }
      detectedLightSheet = [ordered]@{
        x = $sheetX; y = $sheetY; width = $sheetWidth; height = $sheetHeight
        sampledComponentPixels = $best.count
      }
      pngSha256 = Get-Sha256 $PngPath
      retained = $false
    }
  } finally { $bitmap.Dispose() }
}

$preExistingProcessIds = @(Get-Process -Name 'acad' -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.Id })
$acad = $null; $scratch = $null; $reopened = $null; $result = $null; $automationProcessId = 0; $owned = $false; $engineVersion = ''; $automationProcessIdentity = $null
$tempDwg = [IO.Path]::GetFullPath($TempDwgPath)
$tempPng = [IO.Path]::GetFullPath($TempPngPath)
$pidFile = [IO.Path]::GetFullPath($PidPath)
try {
  $acad = New-Object -ComObject AutoCAD.Application.24.3
  Invoke-ComRetry { $acad.Visible = $true; $acad.WindowState = 3 } | Out-Null
  [uint32]$resolvedProcessId = 0
  $hwnd = [int64](Invoke-ComRetry { $acad.HWND })
  [void][F098WindowProcess]::GetWindowThreadProcessId([IntPtr]$hwnd, [ref]$resolvedProcessId)
  $automationProcessId = [int]$resolvedProcessId
  $owned = $automationProcessId -gt 0 -and $preExistingProcessIds -notcontains $automationProcessId
  $engineVersion = [string](Invoke-ComRetry {
    $version = [string]$acad.Version
    if ([string]::IsNullOrWhiteSpace($version)) { throw 'AutoCAD version is temporarily unavailable.' }
    $version
  })
  Write-Host "[F-098] automation-process pid=$automationProcessId owned=$owned"
  if (-not $owned) { throw 'F-098 refuses to use a pre-existing AutoCAD process.' }
  $automationProcess = Get-Process -Id $automationProcessId -ErrorAction Stop
  $automationExecutablePath = [IO.Path]::GetFullPath([string]$automationProcess.Path)
  if ([IO.Path]::GetFileName($automationExecutablePath) -ine 'acad.exe') { throw "F-098 PID $automationProcessId is not acad.exe." }
  $automationProcessIdentity = [ordered]@{ processId=$automationProcessId; executablePath=$automationExecutablePath; startTimeUtc=$automationProcess.StartTime.ToUniversalTime().ToString('o') }
  [ordered]@{ schemaVersion = 1; processId = $automationProcessId; executablePath=$automationProcessIdentity.executablePath; startTimeUtc=$automationProcessIdentity.startTimeUtc; owned = $true; token = $OwnershipToken } |
    ConvertTo-Json -Compress |
    Set-Content -LiteralPath $pidFile -Encoding ascii
  $scratch = if ([int](Invoke-ComRetry { $acad.Documents.Count }) -gt 0) { Invoke-ComRetry { $acad.ActiveDocument } } else { Invoke-ComRetry { $acad.Documents.Add() } }
  if ([string](Invoke-ComRetry { $scratch.FullName }) -or [int](Invoke-ComRetry { $scratch.ModelSpace.Count }) -ne 0) { throw 'F-098 refuses a saved or non-blank drawing.' }
  Invoke-ComRetry { $scratch.Activate() } | Out-Null
  Wait-AcadIdle $scratch
  $papers = @(Invoke-ComRetry { @($scratch.Layouts | Where-Object { -not [bool]$_.ModelType } | Sort-Object TabOrder) } -TimeoutSeconds 30)
  if ($papers.Count -lt 1) { throw 'F-098 QNEW did not provide a paper layout.' }
  $paper = $papers[0]
  foreach ($extra in @($papers | Select-Object -Skip 1)) { Invoke-ComRetry { $extra.Delete() } | Out-Null }
  Invoke-ComRetry { $paper.Name = 'F098 PAPER' } | Out-Null
  [double[]]$center = @(60, 60, 0)
  Invoke-ComRetry { $paper.Block.AddCircle($center, 30) } | Out-Null
  Send-AcadCommand $scratch "_.-LAYOUT`n_Set`nF098 PAPER`n_.ZOOM`n_All`n"
  Invoke-ComRetry { $scratch.MSpace = $false; $scratch.Regen(1) } | Out-Null
  $beforeSaveReadback = Get-StableA3PaperSnapshot $scratch $true
  $beforeSave = $beforeSaveReadback.snapshot
  $visual = Measure-VisiblePaper $hwnd $tempPng

  Invoke-ComRetry { $scratch.SaveAs($tempDwg, 64) } | Out-Null
  Invoke-ComRetry { $scratch.Close($false) } | Out-Null
  $scratch = $null
  $dwgInfo = Get-Item -LiteralPath $tempDwg
  $dwgBytes = [long]$dwgInfo.Length
  $dwgSha256 = Get-Sha256 $tempDwg
  $reopened = Invoke-ComRetry { $acad.Documents.Open($tempDwg) }
  Invoke-ComRetry { $reopened.Activate() } | Out-Null
  Wait-AcadIdle $reopened
  $afterReopenReadback = Get-StableA3PaperSnapshot $reopened $false
  $afterReopen = $afterReopenReadback.snapshot
  $sheet = $visual.detectedLightSheet
  $screenAspect = if ($sheet.height -gt 0) { [double]$sheet.width / [double]$sheet.height } else { 0.0 }
  $nativeAspect = [double]$beforeSave.paperWidth / [double]$beforeSave.paperHeight
  $paperAspectError = [Math]::Abs($screenAspect - $nativeAspect)
  $visual.detectedLightSheet['aspectRatio'] = $screenAspect
  $visual.detectedLightSheet['nativePaperAspectRatio'] = $nativeAspect
  $visual.detectedLightSheet['paperAspectError'] = $paperAspectError
  $checks = [ordered]@{
    nativePaperContext = $beforeSaveReadback.stable -and $afterReopenReadback.stable -and $beforeSave.layoutName -eq 'F098 PAPER' -and $beforeSave.layoutKind -eq 'paper' -and $beforeSave.tileMode -eq 0 -and $beforeSave.cvport -eq 1 -and -not $beforeSave.mSpace -and $beforeSave.activeSpace -eq 0
    millimeterPaperUnits = $beforeSave.paperUnits -eq 1 -and $afterReopen.paperUnits -eq 1
    exactA3Landscape = [Math]::Abs($beforeSave.paperWidth - 420) -lt 0.01 -and [Math]::Abs($beforeSave.paperHeight - 297) -lt 0.01 -and [string]$beforeSave.canonicalMediaName -match '(?i)A3'
    paperEntity = $beforeSave.circleCount -eq 1 -and $beforeSave.circleHandles.Count -eq 1
    visibleLightSheet = $sheet.width -ge 250 -and $sheet.height -ge 150 -and $sheet.sampledComponentPixels -gt 1000 -and $paperAspectError -lt 0.12
    reopen = $afterReopen.layoutName -eq 'F098 PAPER' -and $afterReopen.tileMode -eq 0 -and $afterReopen.cvport -eq 1 -and -not $afterReopen.mSpace -and $afterReopen.circleCount -eq 1
    paperSizePersisted = [Math]::Abs($afterReopen.paperWidth - $beforeSave.paperWidth) -lt 0.001 -and [Math]::Abs($afterReopen.paperHeight - $beforeSave.paperHeight) -lt 0.001 -and $afterReopen.canonicalMediaName -eq $beforeSave.canonicalMediaName -and $afterReopen.plotRotation -eq $beforeSave.plotRotation
  }
  $status = if (@($checks.Values | Where-Object { $_ -ne $true }).Count -eq 0) { 'PASS' } else { 'FAIL' }
  $result = [ordered]@{
    schemaVersion = 1; rowId = 'F-098'; benchmark = 'AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation'
    engine = 'Autodesk AutoCAD 2024 desktop COM/native command + non-retained pixel measurement'; engineVersion = $engineVersion
    automationProcessId = $automationProcessId; automationProcessOwned = $owned; automationProcessIdentity = $automationProcessIdentity
    beforeSave = $beforeSave; afterReopen = $afterReopen; paperReadback = [ordered]@{ beforeSave=$beforeSaveReadback; afterReopen=$afterReopenReadback }; visual = $visual; checks = $checks
    dwg = [ordered]@{ bytes = $dwgBytes; sha256 = $dwgSha256; saveAsType = 64; retained = $false }
    status = $status
  }
} finally {
  if ($reopened) { try { Invoke-ComRetry { $reopened.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
  if ($scratch) { try { Invoke-ComRetry { $scratch.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
  if (Test-Path -LiteralPath $tempDwg) { Remove-Item -LiteralPath $tempDwg -Force }
  if (Test-Path -LiteralPath $tempPng) { Remove-Item -LiteralPath $tempPng -Force }
}

if (-not $result) { throw 'F-098 AutoCAD matrix produced no result.' }
$result.userDocument = [ordered]@{ isolatedOwnedProcess = $owned; blankRestored = $owned }
$finalStatus = $result.status
$result | ConvertTo-Json -Depth 12
if ($finalStatus -ne 'PASS') { exit 1 }
