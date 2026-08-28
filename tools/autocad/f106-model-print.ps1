param(
  [Parameter(Mandatory = $true)][string]$TempDwgPath,
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  [Parameter(Mandatory = $true)][string]$PidPath,
  [Parameter(Mandatory = $true)][string]$OwnershipToken
)

$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class F106WindowProcess {
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

function Get-Sha256 {
  param([Parameter(Mandatory = $true)][string]$Path)
  $stream = [IO.File]::OpenRead($Path)
  try {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
  } finally { $stream.Dispose() }
}

function Set-IsoMedia {
  param([Parameter(Mandatory = $true)]$Layout, [Parameter(Mandatory = $true)][string]$IsoName, [Parameter(Mandatory = $true)][string]$Orientation)
  Invoke-ComRetry { $Layout.ConfigName = 'DWG To PDF.pc3'; $Layout.RefreshPlotDeviceInfo(); $Layout.PaperUnits = 1 } | Out-Null
  $dimensions = if ($IsoName -eq 'A4') { @('210', '297') } elseif ($IsoName -eq 'A3') { @('297', '420') } else { throw "Unsupported ISO media $IsoName" }
  $media = @($Layout.GetCanonicalMediaNames() | Where-Object {
    [string]$_ -match "(?i)$IsoName" -and [string]$_ -match $dimensions[0] -and [string]$_ -match $dimensions[1]
  } | Sort-Object { [string]$_ -match '(?i)full.?bleed' } | Select-Object -First 1)
  if ($media.Count -ne 1) { throw "DWG To PDF.pc3 did not expose ISO $IsoName." }
  Invoke-ComRetry { $Layout.CanonicalMediaName = [string]$media[0]; $Layout.PlotRotation = 0 } | Out-Null
  [double]$width = 0; [double]$height = 0
  Invoke-ComRetry { $Layout.GetPaperSize([ref]$width, [ref]$height) } | Out-Null
  if (($Orientation -eq 'portrait' -and $width -gt $height) -or ($Orientation -eq 'landscape' -and $width -lt $height)) {
    Invoke-ComRetry { $Layout.PlotRotation = 1 } | Out-Null
  }
  return [string]$media[0]
}

function Get-ModelView {
  param([Parameter(Mandatory = $true)]$Document)
  $center = @(Invoke-ComRetry { $Document.GetVariable('VIEWCTR') }); $height = [double](Invoke-ComRetry { $Document.GetVariable('VIEWSIZE') })
  $screen = @(Invoke-ComRetry { $Document.GetVariable('SCREENSIZE') }); $width = $height * [double]$screen[0] / [double]$screen[1]
  return [ordered]@{
    center = [ordered]@{ x = [double]$center[0]; y = [double]$center[1] }; width = $width; height = $height
    window = [ordered]@{ x = [double]$center[0] - $width / 2; y = [double]$center[1] - $height / 2; width = $width; height = $height }
    screenPixels = [ordered]@{ width = [double]$screen[0]; height = [double]$screen[1] }
  }
}

function Get-LayoutSnapshot {
  param([Parameter(Mandatory = $true)]$Document, [Parameter(Mandatory = $true)]$Layout)
  [double]$rawWidth = 0; [double]$rawHeight = 0; [double]$numerator = 0; [double]$denominator = 0
  Invoke-ComRetry { $Layout.GetPaperSize([ref]$rawWidth, [ref]$rawHeight) } | Out-Null
  Invoke-ComRetry { $Layout.GetCustomScale([ref]$numerator, [ref]$denominator) } | Out-Null
  $rotation = [int](Invoke-ComRetry { $Layout.PlotRotation }); $origin = @(Invoke-ComRetry { $Layout.PlotOrigin })
  $paperWidth = if ($rotation -eq 1 -or $rotation -eq 3) { $rawHeight } else { $rawWidth }
  $paperHeight = if ($rotation -eq 1 -or $rotation -eq 3) { $rawWidth } else { $rawHeight }
  $window = $null
  if ([int](Invoke-ComRetry { $Layout.PlotType }) -eq 4) {
    $lower = $null; $upper = $null; Invoke-ComRetry { $Layout.GetWindowToPlot([ref]$lower, [ref]$upper) } | Out-Null
    $window = [ordered]@{ x = [double]$lower[0]; y = [double]$lower[1]; width = [double]$upper[0] - [double]$lower[0]; height = [double]$upper[1] - [double]$lower[1] }
  }
  return [ordered]@{
    name = [string](Invoke-ComRetry { $Layout.Name }); configName = [string](Invoke-ComRetry { $Layout.ConfigName }); canonicalMediaName = [string](Invoke-ComRetry { $Layout.CanonicalMediaName })
    plotType = [int](Invoke-ComRetry { $Layout.PlotType }); useStandardScale = [bool](Invoke-ComRetry { $Layout.UseStandardScale }); standardScale = [int](Invoke-ComRetry { $Layout.StandardScale })
    customScale = [ordered]@{ paperUnits = $numerator; drawingUnits = $denominator; denominator = if ($numerator -ne 0) { $denominator / $numerator } else { $null } }
    centerPlot = [bool](Invoke-ComRetry { $Layout.CenterPlot }); plotOriginMm = [ordered]@{ x = [double]$origin[0]; y = [double]$origin[1] }
    paper = [ordered]@{ widthMm = $paperWidth; heightMm = $paperHeight; rawWidthMm = $rawWidth; rawHeightMm = $rawHeight; rotation = $rotation }
    window = $window; modelView = Get-ModelView $Document; tileMode = [int](Invoke-ComRetry { $Document.GetVariable('TILEMODE') })
  }
}

function Plot-Model {
  param([Parameter(Mandatory = $true)]$Document, [Parameter(Mandatory = $true)][string]$Path)
  if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Force }
  $ok = [bool](Invoke-ComRetry { $Document.Plot.PlotToFile($Path, 'DWG To PDF.pc3') } -TimeoutSeconds 90)
  if (-not $ok -or -not (Test-Path -LiteralPath $Path)) { throw "AutoCAD did not create $Path" }
  $file = Get-Item -LiteralPath $Path
  return [ordered]@{ fullName = $file.FullName; bytes = [long]$file.Length; sha256 = Get-Sha256 $file.FullName }
}

$preExistingProcessIds = @(Get-Process -Name 'acad' -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.Id })
$acad = $null; $scratch = $null; $reopened = $null; $result = $null; $automationProcessId = 0; $owned = $false; $reopenDeviceRefreshed = $false
$tempDwg = [IO.Path]::GetFullPath($TempDwgPath); $outputRoot = [IO.Path]::GetFullPath($OutputDirectory); $pidFile = [IO.Path]::GetFullPath($PidPath)
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
$extentsPath = Join-Path $outputRoot 'extents.pdf'; $windowPath = Join-Path $outputRoot 'window.pdf'; $displayPath = Join-Path $outputRoot 'display.pdf'
try {
  $acad = Invoke-ComRetry { New-Object -ComObject AutoCAD.Application.24.3 } -TimeoutSeconds 30
  Invoke-ComRetry { $acad.Visible = $true; $acad.WindowState = 3 } | Out-Null
  [uint32]$resolvedProcessId = 0
  [void][F106WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry { $acad.HWND }), [ref]$resolvedProcessId)
  $automationProcessId = [int]$resolvedProcessId; $owned = $automationProcessId -gt 0 -and $preExistingProcessIds -notcontains $automationProcessId
  if (-not $owned) { throw 'F-106 refuses to use a pre-existing AutoCAD process.' }
  [ordered]@{ schemaVersion = 1; processId = $automationProcessId; owned = $true; token = $OwnershipToken } | ConvertTo-Json -Compress | Set-Content -LiteralPath $pidFile -Encoding ascii
  $engineVersion = [string](Invoke-ComRetry { $acad.Version })
  $scratch = if ([int](Invoke-ComRetry { $acad.Documents.Count }) -gt 0) { Invoke-ComRetry { $acad.ActiveDocument } } else { Invoke-ComRetry { $acad.Documents.Add() } }
  if ([string](Invoke-ComRetry { $scratch.FullName }) -or [int](Invoke-ComRetry { $scratch.ModelSpace.Count }) -ne 0) { throw 'F-106 refuses a saved or non-blank drawing.' }
  Invoke-ComRetry { $scratch.Activate(); $scratch.SetVariable('BACKGROUNDPLOT', 0); $scratch.SetVariable('TILEMODE', 1) } | Out-Null
  $model = Invoke-ComRetry { $scratch.Layouts.Item('Model') }; Invoke-ComRetry { $scratch.ActiveLayout = $model; $scratch.ActiveSpace = 1 } | Out-Null
  Invoke-ComRetry {
    $scratch.ModelSpace.AddLine([double[]]@(1000, 2000, 0), [double[]]@(5000, 2000, 0)) | Out-Null
    $scratch.ModelSpace.AddCircle([double[]]@(3000, 5000, 0), 1000) | Out-Null
    $scratch.ModelSpace.AddText('F-106 MODEL 1:50', [double[]]@(1000, 13000, 0), 250) | Out-Null
    $scratch.Regen(1)
  } | Out-Null

  $a4Media = Set-IsoMedia $model 'A4' 'portrait'
  Invoke-ComRetry {
    $model.PlotType = 1; $model.UseStandardScale = $false; $model.SetCustomScale(1.0, 50.0)
    $model.PlotOrigin = [double[]]@(0, 0); $model.CenterPlot = $true; $model.PlotWithLineweights = $true; $model.PlotWithPlotStyles = $false
  } | Out-Null
  $extents = Get-LayoutSnapshot $scratch $model; $extentsPdf = Plot-Model $scratch $extentsPath

  $a3Media = Set-IsoMedia $model 'A3' 'landscape'
  Invoke-ComRetry {
    $model.SetWindowToPlot([double[]]@(-100, 200), [double[]]@(7900, 5200)); $model.PlotType = 4; $model.UseStandardScale = $true; $model.StandardScale = 0
    $model.CenterPlot = $false; $model.PlotOrigin = [double[]]@(4, 6)
  } | Out-Null
  $window = Get-LayoutSnapshot $scratch $model; $windowPdf = Plot-Model $scratch $windowPath

  $null = Set-IsoMedia $model 'A4' 'portrait'
  Invoke-ComRetry { $scratch.Activate(); $scratch.ActiveLayout = $model; $scratch.ActiveSpace = 1; $acad.ZoomWindow([double[]]@(-500, -500, 0), [double[]]@(2500, 2500, 0)); $scratch.Regen(1) } | Out-Null
  Start-Sleep -Milliseconds 500
  Invoke-ComRetry {
    $model.PlotType = 0; $model.UseStandardScale = $false; $model.SetCustomScale(1.0, 100.0); $model.PlotOrigin = [double[]]@(0, 0); $model.CenterPlot = $true
  } | Out-Null
  $display = Get-LayoutSnapshot $scratch $model; $displayPdf = Plot-Model $scratch $displayPath
  Invoke-ComRetry { $scratch.SaveAs($tempDwg, 64) } | Out-Null
  Invoke-ComRetry { $scratch.Close($false) } | Out-Null; $scratch = $null
  $dwg = Get-Item -LiteralPath $tempDwg
  $reopened = Invoke-ComRetry { $acad.Documents.Open($tempDwg) }; Invoke-ComRetry { $reopened.Activate(); $reopened.SetVariable('TILEMODE', 1) } | Out-Null
  $reopenedModel = Invoke-ComRetry { $reopened.Layouts.Item('Model') }
  Invoke-ComRetry { $reopened.ActiveLayout = $reopenedModel; $reopened.ActiveSpace = 1; $reopenedModel.RefreshPlotDeviceInfo(); $reopened.Regen(1) } | Out-Null
  $reopenDeviceRefreshed = $true
  Start-Sleep -Milliseconds 500
  $afterReopen = Get-LayoutSnapshot $reopened $reopenedModel
  $reopenedEntityCount = [int](Invoke-ComRetry { $reopened.ModelSpace.Count })
  Invoke-ComRetry { $reopened.Close($false) } | Out-Null; $reopened = $null
  $close = { param([double]$A, [double]$B, [double]$Tolerance = 0.01) [Math]::Abs($A - $B) -le $Tolerance }
  $sameWindow = {
    param($A, $B)
    if ($null -eq $A -or $null -eq $B) { return $null -eq $A -and $null -eq $B }
    return (& $close $A.x $B.x) -and (& $close $A.y $B.y) -and (& $close $A.width $B.width) -and (& $close $A.height $B.height)
  }
  $samePageSetup = {
    param($A, $B)
    $sameStoredOrigin = ($A.centerPlot -and $B.centerPlot) -or
      ((& $close $A.plotOriginMm.x $B.plotOriginMm.x) -and (& $close $A.plotOriginMm.y $B.plotOriginMm.y))
    return $A.name -eq $B.name -and $A.configName -eq $B.configName -and
      $A.canonicalMediaName -eq $B.canonicalMediaName -and $A.plotType -eq $B.plotType -and
      $A.useStandardScale -eq $B.useStandardScale -and $A.standardScale -eq $B.standardScale -and
      (& $close $A.customScale.paperUnits $B.customScale.paperUnits 0.000001) -and
      (& $close $A.customScale.drawingUnits $B.customScale.drawingUnits 0.000001) -and
      (& $close $A.customScale.denominator $B.customScale.denominator 0.000001) -and
      $A.centerPlot -eq $B.centerPlot -and $sameStoredOrigin -and (& $close $A.paper.widthMm $B.paper.widthMm) -and
      (& $close $A.paper.heightMm $B.paper.heightMm) -and (& $close $A.paper.rawWidthMm $B.paper.rawWidthMm) -and
      (& $close $A.paper.rawHeightMm $B.paper.rawHeightMm) -and $A.paper.rotation -eq $B.paper.rotation -and
      (& $sameWindow $A.window $B.window) -and $A.tileMode -eq $B.tileMode
  }
  $checks = [ordered]@{
    modelEntities = $reopenedEntityCount -eq 3
    extentsA4FixedCentered = $extents.plotType -eq 1 -and (& $close $extents.paper.widthMm 210) -and (& $close $extents.paper.heightMm 297) -and (& $close $extents.customScale.denominator 50 0.000001) -and $extents.centerPlot
    windowA3FitOffset = $window.plotType -eq 4 -and $window.useStandardScale -and $window.standardScale -eq 0 -and (& $close $window.paper.widthMm 420) -and (& $close $window.paper.heightMm 297) -and (& $close $window.window.x -100) -and (& $close $window.window.y 200) -and (& $close $window.window.width 8000) -and (& $close $window.window.height 5000) -and (& $close $window.plotOriginMm.x 4) -and (& $close $window.plotOriginMm.y 6)
    displayA4FixedCentered = $display.plotType -eq 0 -and -not $display.useStandardScale -and (& $close $display.customScale.denominator 100 0.000001) -and $display.centerPlot -and $display.modelView.width -gt 0 -and $display.modelView.height -gt 0
    threeNativePdfs = @(@($extentsPdf, $windowPdf, $displayPdf) | Where-Object { $_.bytes -gt 0 -and $_.sha256 -match '^[a-f0-9]{64}$' }).Count -eq 3
    dwgReopenStable = $dwg.Length -gt 0 -and $reopenDeviceRefreshed -and (& $samePageSetup $display $afterReopen)
  }
  $result = [ordered]@{
    schemaVersion = 1; rowId = 'F-106'; benchmark = 'AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation'
    engine = 'Autodesk AutoCAD 2024 desktop COM Model PlotToFile/DWG To PDF.pc3'; engineVersion = $engineVersion
    automationProcessId = $automationProcessId; automationProcessOwned = $owned; backgroundPlot = 0; reopenDeviceRefreshed = $reopenDeviceRefreshed
    media = [ordered]@{ a4 = $a4Media; a3 = $a3Media }; extents = $extents; window = $window; display = $display; afterReopen = $afterReopen
    outputs = [ordered]@{ extents = $extentsPdf; window = $windowPdf; display = $displayPdf }
    dwg = [ordered]@{ bytes = [long]$dwg.Length; sha256 = Get-Sha256 $dwg.FullName; saveAsType = 64; retained = $false }
    checks = $checks; status = if (@($checks.Values | Where-Object { $_ -ne $true }).Count -eq 0) { 'PASS' } else { 'FAIL' }
  }
} catch {
  Write-Error ("F-106 failure at {0}: {1}" -f $_.InvocationInfo.PositionMessage, $_.Exception.Message); throw
} finally {
  if ($reopened) { try { Invoke-ComRetry { $reopened.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
  if ($scratch) { try { Invoke-ComRetry { $scratch.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
}
if (-not $result) { throw 'F-106 AutoCAD matrix produced no result.' }
$result.userDocument = [ordered]@{ isolatedOwnedProcess = $owned; blankRestored = $owned }
$finalStatus = $result.status; $result | ConvertTo-Json -Depth 14
if ($finalStatus -ne 'PASS') { exit 1 }
