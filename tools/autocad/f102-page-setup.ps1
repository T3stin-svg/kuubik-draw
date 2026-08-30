param(
  [Parameter(Mandatory = $true)][string]$TempDwgPath,
  [Parameter(Mandatory = $true)][string]$TempPdfPath,
  [Parameter(Mandatory = $true)][string]$PidPath,
  [Parameter(Mandatory = $true)][string]$OwnershipToken,
  [Parameter(Mandatory = $true)][double]$DisplayX,
  [Parameter(Mandatory = $true)][double]$DisplayY,
  [Parameter(Mandatory = $true)][double]$DisplayWidth,
  [Parameter(Mandatory = $true)][double]$DisplayHeight
)

$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class F102WindowProcess {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
  public static RECT ReadRect(IntPtr hWnd) {
    RECT rect;
    if (!GetWindowRect(hWnd, out rect)) throw new InvalidOperationException("GetWindowRect failed.");
    return rect;
  }
  public static void Resize(IntPtr hWnd, int x, int y, int width, int height) {
    if (!SetWindowPos(hWnd, IntPtr.Zero, x, y, width, height, 0x0014)) throw new InvalidOperationException("SetWindowPos failed.");
  }
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
    try { if ([string]::IsNullOrWhiteSpace([string]$Document.GetVariable('CMDNAMES')) -and [int]$Document.GetVariable('CMDACTIVE') -eq 0) { return } } catch {}
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'AutoCAD did not return idle for F-102.'
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

function Get-Point2 {
  param($Value)
  if ($null -eq $Value -or @($Value).Count -lt 2) { throw 'AutoCAD returned an incomplete 2D point.' }
  return [ordered]@{ x = [double]$Value[0]; y = [double]$Value[1] }
}

function Get-CurrentPaperView {
  param([Parameter(Mandatory = $true)]$Document)
  $center = Invoke-ComRetry { Get-Point2 ($Document.GetVariable('VIEWCTR')) }
  $height = [double](Invoke-ComRetry { $Document.GetVariable('VIEWSIZE') })
  $screen = Invoke-ComRetry { $Document.GetVariable('SCREENSIZE') }
  $width = $height * [double]$screen[0] / [double]$screen[1]
  return [ordered]@{
    center = $center; width = $width; height = $height
    window = [ordered]@{ x = $center.x - $width / 2; y = $center.y - $height / 2; width = $width; height = $height }
    screenPixels = [ordered]@{ width = [double]$screen[0]; height = [double]$screen[1] }
  }
}

function Set-AcadDrawingAspect {
  param(
    [Parameter(Mandatory = $true)]$Application,
    [Parameter(Mandatory = $true)]$Document,
    [Parameter(Mandatory = $true)][double]$TargetAspect
  )
  if ([double]::IsNaN($TargetAspect) -or [double]::IsInfinity($TargetAspect) -or $TargetAspect -le 0) { throw 'F-102 Display aspect must be positive and finite.' }
  Invoke-ComRetry { $Application.WindowState = 1 } | Out-Null
  Start-Sleep -Milliseconds 400
  $target = $null
  for ($attempt = 0; $attempt -lt 5; $attempt++) {
    $screen = Invoke-ComRetry { $Document.GetVariable('SCREENSIZE') }
    if ($null -eq $target) {
      $best = $null
      for ($candidateHeight = 600; $candidateHeight -le 1200; $candidateHeight++) {
        $candidateWidth = [int][Math]::Round($candidateHeight * $TargetAspect)
        if ($candidateWidth -lt 900 -or $candidateWidth -gt 2400) { continue }
        $aspectError = [Math]::Abs(($candidateWidth / [double]$candidateHeight) - $TargetAspect)
        $distance = [Math]::Abs($candidateWidth - [double]$screen[0]) + [Math]::Abs($candidateHeight - [double]$screen[1])
        $score = $aspectError * 1000000000 + $distance
        if ($null -eq $best -or $score -lt $best.score) {
          $best = [pscustomobject]@{ width = $candidateWidth; height = $candidateHeight; score = $score }
        }
      }
      if ($null -eq $best) { throw 'F-102 could not choose a native Display viewport aspect.' }
      $target = $best
    }
    if ([int]$screen[0] -eq $target.width -and [int]$screen[1] -eq $target.height) { return $target }
    Invoke-ComRetry {
      # AutoCAD may recreate its top-level window while layouts or plot devices
      # are being activated. Always reacquire HWND inside the retry so a stale
      # handle cannot turn a transient UI transition into a false parity failure.
      $liveHwnd = [IntPtr][int64]$Application.HWND
      if ($liveHwnd -eq [IntPtr]::Zero) { throw 'AutoCAD returned an empty HWND.' }
      $rect = [F102WindowProcess]::ReadRect($liveHwnd)
      $outerWidth = $rect.Right - $rect.Left; $outerHeight = $rect.Bottom - $rect.Top
      $newWidth = $outerWidth + $target.width - [int]$screen[0]
      $newHeight = $outerHeight + $target.height - [int]$screen[1]
      [F102WindowProcess]::Resize($liveHwnd, 0, 0, $newWidth, $newHeight)
    } | Out-Null
    Start-Sleep -Milliseconds 400
  }
  $finalScreen = Invoke-ComRetry { $Document.GetVariable('SCREENSIZE') }
  throw "F-102 could not size native Display viewport to $($target.width)x$($target.height); got $($finalScreen[0])x$($finalScreen[1])."
}

function Set-IsoMedia {
  param([Parameter(Mandatory = $true)]$Layout, [Parameter(Mandatory = $true)][string]$IsoName, [Parameter(Mandatory = $true)][string]$Orientation)
  $dimensions = if ($IsoName -eq 'A4') { @('210', '297') } elseif ($IsoName -eq 'A3') { @('297', '420') } else { throw "Unsupported ISO media $IsoName" }
  Invoke-ComRetry { $Layout.RefreshPlotDeviceInfo() } -TimeoutSeconds 30 | Out-Null
  $canonicalMediaNames = @(Invoke-ComRetry { @($Layout.GetCanonicalMediaNames()) } -TimeoutSeconds 30)
  $media = @($canonicalMediaNames | Where-Object {
    [string]$_ -match "(?i)$IsoName" -and [string]$_ -match $dimensions[0] -and [string]$_ -match $dimensions[1]
  } | Sort-Object { [string]$_ -match '(?i)full.?bleed' } | Select-Object -First 1)
  if ($media.Count -ne 1) { throw "DWG To PDF.pc3 did not expose ISO $IsoName." }
  Invoke-ComRetry { $Layout.CanonicalMediaName = [string]$media[0]; $Layout.PlotRotation = 0 } | Out-Null
  [double]$width = 0; [double]$height = 0
  Invoke-ComRetry { $Layout.GetPaperSize([ref]$width, [ref]$height) } | Out-Null
  $wantsLandscape = $Orientation -eq 'landscape'
  if (($wantsLandscape -and $width -lt $height) -or (-not $wantsLandscape -and $width -gt $height)) {
    Invoke-ComRetry { $Layout.PlotRotation = 1 } | Out-Null
  }
  return [string]$media[0]
}

function Get-PlotSnapshot {
  param([Parameter(Mandatory = $true)]$Layout, [Parameter(Mandatory = $true)]$Viewport)
  [double]$rawWidth = 0; [double]$rawHeight = 0
  Invoke-ComRetry { $Layout.GetPaperSize([ref]$rawWidth, [ref]$rawHeight) } | Out-Null
  $rotation = [int](Invoke-ComRetry { $Layout.PlotRotation })
  $paperWidth = if ($rotation -eq 1 -or $rotation -eq 3) { $rawHeight } else { $rawWidth }
  $paperHeight = if ($rotation -eq 1 -or $rotation -eq 3) { $rawWidth } else { $rawHeight }
  [double]$paperUnits = 0; [double]$drawingUnits = 0
  Invoke-ComRetry { $Layout.GetCustomScale([ref]$paperUnits, [ref]$drawingUnits) } | Out-Null
  $origin = Invoke-ComRetry { Get-Point2 $Layout.PlotOrigin }
  $plotType = [int](Invoke-ComRetry { $Layout.PlotType })
  $window = $null
  if ($plotType -eq 4) {
    $window = Invoke-ComRetry {
      $lowerLeft = $null; $upperRight = $null
      $Layout.GetWindowToPlot([ref]$lowerLeft, [ref]$upperRight)
      return [ordered]@{ lowerLeft = Get-Point2 $lowerLeft; upperRight = Get-Point2 $upperRight }
    }
  }
  $center = Invoke-ComRetry { Get-Point2 $Viewport.Center }
  return [ordered]@{
    layoutName = [string](Invoke-ComRetry { $Layout.Name })
    configName = [string](Invoke-ComRetry { $Layout.ConfigName })
    canonicalMediaName = [string](Invoke-ComRetry { $Layout.CanonicalMediaName })
    paperUnits = [int](Invoke-ComRetry { $Layout.PaperUnits })
    plotRotation = $rotation
    paper = [ordered]@{ widthMm = $paperWidth; heightMm = $paperHeight; rawWidthMm = $rawWidth; rawHeightMm = $rawHeight }
    plotType = $plotType
    useStandardScale = [bool](Invoke-ComRetry { $Layout.UseStandardScale })
    standardScale = [int](Invoke-ComRetry { $Layout.StandardScale })
    customScale = [ordered]@{ paperUnits = $paperUnits; drawingUnits = $drawingUnits; denominator = $drawingUnits / $paperUnits }
    centerPlot = [bool](Invoke-ComRetry { $Layout.CenterPlot })
    plotOrigin = $origin
    window = $window
    viewport = [ordered]@{
      handle = [string](Invoke-ComRetry { $Viewport.Handle })
      center = $center
      width = [double](Invoke-ComRetry { $Viewport.Width })
      height = [double](Invoke-ComRetry { $Viewport.Height })
    }
  }
}

function Wait-ViewportGeometry {
  param(
    [Parameter(Mandatory = $true)]$Viewport,
    [Parameter(Mandatory = $true)][double[]]$Center,
    [Parameter(Mandatory = $true)][double]$Width,
    [Parameter(Mandatory = $true)][double]$Height,
    [int]$TimeoutSeconds = 20
  )
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    try {
      $actualCenter = Get-Point2 $Viewport.Center
      $actualWidth = [double]$Viewport.Width
      $actualHeight = [double]$Viewport.Height
      if ([Math]::Abs($actualCenter.x - $Center[0]) -le 0.001 -and
          [Math]::Abs($actualCenter.y - $Center[1]) -le 0.001 -and
          [Math]::Abs($actualWidth - $Width) -le 0.001 -and
          [Math]::Abs($actualHeight - $Height) -le 0.001) { return }
      $Viewport.Center = $Center; $Viewport.Width = $Width; $Viewport.Height = $Height; $Viewport.Update()
    } catch {}
    Start-Sleep -Milliseconds 150
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "F-102 viewport geometry did not stabilize at $Width x $Height."
}

$preExistingProcessIds = @(Get-Process -Name 'acad' -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.Id })
$acad = $null; $scratch = $null; $reopened = $null; $result = $null; $automationProcessId = 0; $owned = $false
$tempDwg = [IO.Path]::GetFullPath($TempDwgPath); $tempPdf = [IO.Path]::GetFullPath($TempPdfPath); $displayPdf = [IO.Path]::ChangeExtension($tempPdf, '.display.pdf'); $pidFile = [IO.Path]::GetFullPath($PidPath)
try {
  $acad = Invoke-ComRetry { New-Object -ComObject AutoCAD.Application.24.3 } -TimeoutSeconds 30
  Invoke-ComRetry { $acad.Visible = $true; $acad.WindowState = 3 } | Out-Null
  [uint32]$resolvedProcessId = 0
  [void][F102WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry { $acad.HWND }), [ref]$resolvedProcessId)
  $automationProcessId = [int]$resolvedProcessId; $owned = $automationProcessId -gt 0 -and $preExistingProcessIds -notcontains $automationProcessId
  if (-not $owned) { throw 'F-102 refuses to use a pre-existing AutoCAD process.' }
  [ordered]@{ schemaVersion = 1; processId = $automationProcessId; owned = $true; token = $OwnershipToken } | ConvertTo-Json -Compress | Set-Content -LiteralPath $pidFile -Encoding ascii
  $engineVersion = [string](Invoke-ComRetry { $acad.Version })

  $scratch = if ([int](Invoke-ComRetry { $acad.Documents.Count }) -gt 0) { Invoke-ComRetry { $acad.ActiveDocument } } else { Invoke-ComRetry { $acad.Documents.Add() } }
  if ([string](Invoke-ComRetry { $scratch.FullName }) -or [int](Invoke-ComRetry { $scratch.ModelSpace.Count }) -ne 0) { throw 'F-102 refuses a saved or non-blank drawing.' }
  Invoke-ComRetry { $scratch.Activate(); $scratch.SetVariable('BACKGROUNDPLOT', 0) } | Out-Null
  Wait-AcadIdle $scratch
  $papers = @(Invoke-ComRetry { @($scratch.Layouts | Where-Object { [string]$_.Name -ne 'Model' } | Sort-Object TabOrder) } -TimeoutSeconds 30)
  if ($papers.Count -lt 1) { throw 'F-102 QNEW did not provide a paper layout.' }
  $paper = $papers[0]; foreach ($extra in @($papers | Select-Object -Skip 1)) { Invoke-ComRetry { $extra.Delete() } | Out-Null }
  Invoke-ComRetry {
    $paper.Name = 'F102 PAGE SETUP'; $paper.ConfigName = 'DWG To PDF.pc3'; $paper.RefreshPlotDeviceInfo(); $paper.PaperUnits = 1
    $scratch.ActiveLayout = $paper; $scratch.ActiveSpace = 0; $scratch.MSpace = $false
  } | Out-Null
  $a3Media = Set-IsoMedia $paper 'A3' 'landscape'
  [double[]]$viewportCenter = @(210, 148.5, 0)
  $viewport = Invoke-ComRetry { $scratch.PaperSpace.AddPViewport($viewportCenter, 390, 267) }
  [double[]]$lineStart = @(10, 20, 0); [double[]]$lineEnd = @(190, 270, 0)
  Invoke-ComRetry { $scratch.PaperSpace.AddLine($lineStart, $lineEnd) } | Out-Null
  Invoke-ComRetry {
    $viewport.Center = $viewportCenter; $viewport.Width = 390; $viewport.Height = 267
    $viewport.Display($true); $viewport.DisplayLocked = $true; $viewport.Update()
    $paper.PlotType = 1; $paper.CenterPlot = $false; $paper.UseStandardScale = $false; $paper.SetCustomScale(1.0, 1.0); $paper.PlotOrigin = [double[]]@(0, 0); $paper.PlotType = 5
    $scratch.Regen(1)
  } | Out-Null
  Wait-ViewportGeometry $viewport $viewportCenter 390 267
  Invoke-ComRetry {
    $paper.PlotType = 5
    $scratch.Regen(1)
    if ([int]$paper.PlotType -ne 5) { throw 'AutoCAD did not retain the baseline Layout plot type.' }
  } | Out-Null
  $baseline = Get-PlotSnapshot $paper $viewport

  $a4Media = Set-IsoMedia $paper 'A4' 'portrait'
  [double[]]$windowLower = @(10, 20); [double[]]$windowUpper = @(190, 270)
  Invoke-ComRetry {
    $paper.SetWindowToPlot($windowLower, $windowUpper); $paper.PlotType = 4
    $paper.UseStandardScale = $false; $paper.SetCustomScale(1.0, 2.0); $paper.CenterPlot = $false; $paper.PlotOrigin = [double[]]@(0, 0)
    $scratch.Regen(1)
  } | Out-Null
  $configured = Get-PlotSnapshot $paper $viewport
  $plotSucceeded = [bool](Invoke-ComRetry { $scratch.Plot.PlotToFile($tempPdf) } -TimeoutSeconds 60)
  if (-not $plotSucceeded -or -not (Test-Path -LiteralPath $tempPdf)) { throw 'AutoCAD PlotToFile did not create the F-102 PDF.' }
  $pdfInfo = Get-Item -LiteralPath $tempPdf; $pdfSha256 = Get-Sha256 $tempPdf
  Invoke-ComRetry { $scratch.SaveAs($tempDwg, 64) } | Out-Null
  Invoke-ComRetry { $scratch.Close($false) } | Out-Null; $scratch = $null
  $dwgInfo = Get-Item -LiteralPath $tempDwg; $dwgSha256 = Get-Sha256 $tempDwg
  $reopened = Invoke-ComRetry { $acad.Documents.Open($tempDwg) }; Invoke-ComRetry { $reopened.Activate() } | Out-Null; Wait-AcadIdle $reopened
  $paper = Invoke-ComRetry { $reopened.Layouts.Item('F102 PAGE SETUP') }
  Invoke-ComRetry { $reopened.ActiveLayout = $paper; $reopened.ActiveSpace = 0; $reopened.MSpace = $false; $paper.RefreshPlotDeviceInfo(); $reopened.Regen(1) } | Out-Null
  Start-Sleep -Milliseconds 500
  $viewport = Invoke-ComRetry { $reopened.HandleToObject($configured.viewport.handle) }
  $afterReopen = Get-PlotSnapshot $paper $viewport

  Invoke-ComRetry { $paper.PlotType = 1; $paper.UseStandardScale = $true; $paper.StandardScale = 0; $paper.CenterPlot = $true; $reopened.Regen(1) } | Out-Null
  $fit = Get-PlotSnapshot $paper $viewport
  [double[]]$outsideLower = @(-25, -40); [double[]]$outsideUpper = @(275, 360)
  Invoke-ComRetry {
    $paper.SetWindowToPlot($outsideLower, $outsideUpper); $paper.PlotType = 4
    $paper.UseStandardScale = $false; $paper.SetCustomScale(1.0, 2.0); $paper.CenterPlot = $false; $paper.PlotOrigin = [double[]]@(0, 0); $reopened.Regen(1)
  } | Out-Null
  $outsideWindow = Get-PlotSnapshot $paper $viewport
  $displayScreenTarget = Set-AcadDrawingAspect $acad $reopened ($DisplayWidth / $DisplayHeight)
  $displayCenter = [double[]]@(($DisplayX + $DisplayWidth / 2), ($DisplayY + $DisplayHeight / 2), 0)
  $displayMagnification = $DisplayHeight
  Invoke-ComRetry { $acad.ZoomCenter($displayCenter, $displayMagnification); $reopened.Regen(1) } | Out-Null
  $displayWindow = Get-CurrentPaperView $reopened
  Invoke-ComRetry { $paper.PlotType = 0; $paper.UseStandardScale = $true; $paper.StandardScale = 0; $paper.CenterPlot = $true; $reopened.Regen(1) } | Out-Null
  $display = Get-PlotSnapshot $paper $viewport
  $displayPlotSucceeded = [bool](Invoke-ComRetry { $reopened.Plot.PlotToFile($displayPdf) } -TimeoutSeconds 60)
  if (-not $displayPlotSucceeded -or -not (Test-Path -LiteralPath $displayPdf)) { throw 'AutoCAD PlotToFile did not create the F-102 Display PDF.' }
  $displayPdfInfo = Get-Item -LiteralPath $displayPdf; $displayPdfSha256 = Get-Sha256 $displayPdf
  $layoutCenterRejected = $false
  Invoke-ComRetry { $paper.PlotType = 5 } | Out-Null
  try { Invoke-ComRetry { $paper.CenterPlot = $true } | Out-Null } catch { $layoutCenterRejected = $true }
  $layoutCenterValue = [bool](Invoke-ComRetry { $paper.CenterPlot })
  Invoke-ComRetry { $paper.PlotType = 1; $paper.CenterPlot = $false; $paper.UseStandardScale = $false; $paper.SetCustomScale(1.0, 1.0); $paper.PlotOrigin = [double[]]@(0, 0) } | Out-Null
  $null = Set-IsoMedia $paper 'A3' 'landscape'; Invoke-ComRetry { $paper.PlotType = 5; $reopened.Regen(1) } | Out-Null
  $restored = Get-PlotSnapshot $paper $viewport

  $close = { param([double]$A, [double]$B, [double]$Tolerance = 0.001) [Math]::Abs($A - $B) -le $Tolerance }
  $sameViewport = { param($A, $B) (& $close $A.center.x $B.center.x) -and (& $close $A.center.y $B.center.y) -and (& $close $A.width $B.width) -and (& $close $A.height $B.height) }
  $sameWindow = {
    param($A, $B)
    if ($null -eq $A -or $null -eq $B) { return $null -eq $A -and $null -eq $B }
    return (& $close $A.lowerLeft.x $B.lowerLeft.x) -and (& $close $A.lowerLeft.y $B.lowerLeft.y) -and
      (& $close $A.upperRight.x $B.upperRight.x) -and (& $close $A.upperRight.y $B.upperRight.y)
  }
  $samePageSetup = {
    param($A, $B)
    return $A.layoutName -eq $B.layoutName -and $A.configName -eq $B.configName -and
      $A.canonicalMediaName -eq $B.canonicalMediaName -and $A.paperUnits -eq $B.paperUnits -and
      $A.plotRotation -eq $B.plotRotation -and (& $close $A.paper.widthMm $B.paper.widthMm) -and
      (& $close $A.paper.heightMm $B.paper.heightMm) -and (& $close $A.paper.rawWidthMm $B.paper.rawWidthMm) -and
      (& $close $A.paper.rawHeightMm $B.paper.rawHeightMm) -and $A.plotType -eq $B.plotType -and
      $A.useStandardScale -eq $B.useStandardScale -and $A.standardScale -eq $B.standardScale -and
      (& $close $A.customScale.paperUnits $B.customScale.paperUnits) -and
      (& $close $A.customScale.drawingUnits $B.customScale.drawingUnits) -and
      (& $close $A.customScale.denominator $B.customScale.denominator) -and $A.centerPlot -eq $B.centerPlot -and
      (& $close $A.plotOrigin.x $B.plotOrigin.x) -and (& $close $A.plotOrigin.y $B.plotOrigin.y) -and
      (& $sameWindow $A.window $B.window) -and (& $sameViewport $A.viewport $B.viewport)
  }
  $checks = [ordered]@{
    baselineA3LandscapeLayoutOneToOne = (& $close $baseline.paper.widthMm 420) -and (& $close $baseline.paper.heightMm 297) -and $baseline.plotType -eq 5 -and (& $close $baseline.customScale.denominator 1) -and -not $baseline.centerPlot
    configuredA4PortraitWindowOneToTwo = (& $close $configured.paper.widthMm 210) -and (& $close $configured.paper.heightMm 297) -and $configured.plotType -eq 4 -and (& $close $configured.customScale.denominator 2) -and -not $configured.centerPlot
    exactWindow = (& $close $configured.window.lowerLeft.x 10) -and (& $close $configured.window.lowerLeft.y 20) -and (& $close $configured.window.upperRight.x 190) -and (& $close $configured.window.upperRight.y 270)
    viewportPaperCoordinatesRemainUnchanged = & $sameViewport $baseline.viewport $configured.viewport
    nativePdfPlot = $plotSucceeded -and $pdfInfo.Length -gt 0 -and $pdfSha256 -match '^[a-f0-9]{64}$'
    nativeDwgReopen = $dwgInfo.Length -gt 0 -and $dwgSha256 -match '^[a-f0-9]{64}$'
    pageSetupPersisted = & $samePageSetup $configured $afterReopen
    extentsFitCentered = $fit.plotType -eq 1 -and $fit.useStandardScale -and $fit.standardScale -eq 0 -and $fit.centerPlot
    arbitraryWindowCoordinates = $outsideWindow.plotType -eq 4 -and (& $close $outsideWindow.window.lowerLeft.x -25) -and (& $close $outsideWindow.window.lowerLeft.y -40) -and (& $close $outsideWindow.window.upperRight.x 275) -and (& $close $outsideWindow.window.upperRight.y 360)
    displayUsesCurrentView = $display.plotType -eq 0 -and $display.useStandardScale -and $display.standardScale -eq 0 -and $display.centerPlot -and $displayPlotSucceeded -and $displayPdfInfo.Length -gt 0
    displaySameAsBrowserView = (& $close $displayWindow.window.x $DisplayX 0.01) -and (& $close $displayWindow.window.y $DisplayY 0.01) -and (& $close $displayWindow.window.width $DisplayWidth 0.01) -and (& $close $displayWindow.window.height $DisplayHeight 0.01)
    layoutCenterUnavailable = $layoutCenterRejected -or -not $layoutCenterValue
    restoredA3Layout = (& $close $restored.paper.widthMm 420) -and (& $close $restored.paper.heightMm 297) -and $restored.plotType -eq 5 -and (& $close $restored.customScale.denominator 1) -and -not $restored.centerPlot
  }
  $status = if (@($checks.Values | Where-Object { $_ -ne $true }).Count -eq 0) { 'PASS' } else { 'FAIL' }
  $result = [ordered]@{
    schemaVersion = 1; rowId = 'F-102'; benchmark = 'AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation'
    engine = 'Autodesk AutoCAD 2024 desktop COM/native Layout PlotConfiguration and PlotToFile'; engineVersion = $engineVersion
    automationProcessId = $automationProcessId; automationProcessOwned = $owned; media = [ordered]@{ a3 = $a3Media; a4 = $a4Media }
    baseline = $baseline; configured = $configured; afterReopen = $afterReopen; fit = $fit; outsideWindow = $outsideWindow; display = $display
    displayRequestedWindow = [ordered]@{ x = $DisplayX; y = $DisplayY; width = $DisplayWidth; height = $DisplayHeight }; displayScreenTarget = $displayScreenTarget; displayWindow = $displayWindow
    layoutCenterAttempt = [ordered]@{ rejected = $layoutCenterRejected; resultingValue = $layoutCenterValue }
    restored = $restored; checks = $checks
    dwg = [ordered]@{ bytes = [long]$dwgInfo.Length; sha256 = $dwgSha256; saveAsType = 64; retained = $false }
    pdf = [ordered]@{ bytes = [long]$pdfInfo.Length; sha256 = $pdfSha256; retained = $false }
    displayPdf = [ordered]@{ bytes = [long]$displayPdfInfo.Length; sha256 = $displayPdfSha256; retained = $false }
    status = $status
  }
} catch {
  Write-Error ("F-102 failure at {0}: {1}" -f $_.InvocationInfo.PositionMessage, $_.Exception.Message); throw
} finally {
  if ($reopened) { try { Invoke-ComRetry { $reopened.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
  if ($scratch) { try { Invoke-ComRetry { $scratch.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
  if (Test-Path -LiteralPath $tempDwg) { Remove-Item -LiteralPath $tempDwg -Force }
}
if (-not $result) { throw 'F-102 AutoCAD matrix produced no result.' }
$result.userDocument = [ordered]@{ isolatedOwnedProcess = $owned; blankRestored = $owned }
$finalStatus = $result.status; $result | ConvertTo-Json -Depth 14
if ($finalStatus -ne 'PASS') { exit 1 }
