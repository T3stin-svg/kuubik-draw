param(
  [Parameter(Mandatory = $true)][string]$TempDwgPath,
  [Parameter(Mandatory = $true)][string]$PidPath,
  [Parameter(Mandatory = $true)][string]$OwnershipToken
)

$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class F100WindowProcess {
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
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
  throw "AutoCAD did not return idle for F-100."
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
  return [ordered]@{ x = [double]$Value[0]; y = [double]$Value[1] }
}

function Translate-Coordinates {
  param(
    [Parameter(Mandatory = $true)]$Utility,
    [Parameter(Mandatory = $true)][double[]]$Point,
    [Parameter(Mandatory = $true)][int]$FromSystem,
    [Parameter(Mandatory = $true)][int]$ToSystem,
    [Parameter(Mandatory = $true)][bool]$Displacement
  )
  $translated = Invoke-ComRetry { $Utility.TranslateCoordinates($Point, $FromSystem, $ToSystem, $Displacement) }
  return [double[]]@([double]$translated[0], [double]$translated[1], [double]$translated[2])
}

function Get-ViewportState {
  param([Parameter(Mandatory = $true)]$Document, [Parameter(Mandatory = $true)][string]$Handle)
  $viewport = Invoke-ComRetry { $Document.HandleToObject($Handle) }
  return [ordered]@{
    handle = [string](Invoke-ComRetry { $viewport.Handle })
    objectName = [string](Invoke-ComRetry { $viewport.ObjectName })
    center = Get-Point2 (Invoke-ComRetry { $viewport.Center })
    width = [double](Invoke-ComRetry { $viewport.Width })
    height = [double](Invoke-ComRetry { $viewport.Height })
    target = Get-Point2 (Invoke-ComRetry { $viewport.Target })
    standardScale = [int](Invoke-ComRetry { $viewport.StandardScale })
    customScale = [double](Invoke-ComRetry { $viewport.CustomScale })
    scaleDenominator = 1 / [double](Invoke-ComRetry { $viewport.CustomScale })
    twistAngleRad = [double](Invoke-ComRetry { $viewport.TwistAngle })
    displayLocked = [bool](Invoke-ComRetry { $viewport.DisplayLocked })
    viewportOn = [bool](Invoke-ComRetry { $viewport.ViewportOn })
    mSpace = [bool](Invoke-ComRetry { $Document.MSpace })
    cvport = [int](Invoke-ComRetry { $Document.GetVariable('CVPORT') })
  }
}

$preExistingProcessIds = @(Get-Process -Name 'acad' -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.Id })
$acad = $null; $scratch = $null; $reopened = $null; $result = $null; $automationProcessId = 0; $owned = $false; $automationProcessIdentity = $null
$tempDwg = [IO.Path]::GetFullPath($TempDwgPath)
$pidFile = [IO.Path]::GetFullPath($PidPath)
try {
  $acad = New-Object -ComObject AutoCAD.Application.24.3
  Invoke-ComRetry { $acad.Visible = $true; $acad.WindowState = 3 } | Out-Null
  [uint32]$resolvedProcessId = 0
  [void][F100WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry { $acad.HWND }), [ref]$resolvedProcessId)
  $automationProcessId = [int]$resolvedProcessId
  $owned = $automationProcessId -gt 0 -and $preExistingProcessIds -notcontains $automationProcessId
  $engineVersion = [string](Invoke-ComRetry { $acad.Version })
  Write-Host "[F-100] automation-process pid=$automationProcessId owned=$owned"
  if (-not $owned) { throw 'F-100 refuses to use a pre-existing AutoCAD process.' }
  $automationProcess = Get-Process -Id $automationProcessId -ErrorAction Stop
  $automationExecutablePath = [IO.Path]::GetFullPath([string]$automationProcess.Path)
  if ([IO.Path]::GetFileName($automationExecutablePath) -ine 'acad.exe') { throw "F-100 PID $automationProcessId is not acad.exe." }
  $automationProcessIdentity = [ordered]@{
    processId = $automationProcessId
    executablePath = $automationExecutablePath
    startTimeUtc = $automationProcess.StartTime.ToUniversalTime().ToString('o')
  }
  [ordered]@{ schemaVersion = 1; processId = $automationProcessId; executablePath = $automationProcessIdentity.executablePath; startTimeUtc = $automationProcessIdentity.startTimeUtc; owned = $true; token = $OwnershipToken } |
    ConvertTo-Json -Compress | Set-Content -LiteralPath $pidFile -Encoding ascii

  $scratch = if ([int](Invoke-ComRetry { $acad.Documents.Count }) -gt 0) { Invoke-ComRetry { $acad.ActiveDocument } } else { Invoke-ComRetry { $acad.Documents.Add() } }
  if ([string](Invoke-ComRetry { $scratch.FullName }) -or [int](Invoke-ComRetry { $scratch.ModelSpace.Count }) -ne 0) { throw 'F-100 refuses a saved or non-blank drawing.' }
  Invoke-ComRetry { $scratch.Activate() } | Out-Null
  Wait-AcadIdle $scratch
  $papers = @(Invoke-ComRetry { @($scratch.Layouts | Where-Object { [string]$_.Name -ne 'Model' } | Sort-Object TabOrder) } -TimeoutSeconds 30)
  if ($papers.Count -lt 1) { throw 'F-100 QNEW did not provide a paper layout.' }
  $paper = $papers[0]
  foreach ($extra in @($papers | Select-Object -Skip 1)) { Invoke-ComRetry { $extra.Delete() } | Out-Null }
  Invoke-ComRetry {
    $paper.Name = 'F100 VIEW'
    $paper.ConfigName = 'DWG To PDF.pc3'
    $paper.RefreshPlotDeviceInfo()
    $paper.PaperUnits = 1
    $a3Media = @($paper.GetCanonicalMediaNames() | Where-Object { [string]$_ -match '(?i)A3' -and [string]$_ -match '420' -and [string]$_ -match '297' } | Select-Object -First 1)
    if ($a3Media.Count -ne 1) { throw 'DWG To PDF.pc3 did not expose ISO A3.' }
    $paper.CanonicalMediaName = [string]$a3Media[0]
    $paper.PlotRotation = 0
  } | Out-Null
  [double]$configuredWidth = 0; [double]$configuredHeight = 0
  Invoke-ComRetry { $paper.GetPaperSize([ref]$configuredWidth, [ref]$configuredHeight) } | Out-Null
  if ($configuredWidth -lt $configuredHeight) { Invoke-ComRetry { $paper.PlotRotation = 1 } | Out-Null }
  Invoke-ComRetry { $scratch.ActiveLayout = $paper; $scratch.ActiveSpace = 0; $scratch.MSpace = $false } | Out-Null

  [double[]]$lineStart = @(-2000, -500, 0); [double[]]$lineEnd = @(4000, -500, 0)
  Invoke-ComRetry { $scratch.ModelSpace.AddLine($lineStart, $lineEnd) } | Out-Null
  $templateViewports = @(Invoke-ComRetry { @($paper.Block | Where-Object { [string]$_.ObjectName -eq 'AcDbViewport' }) })
  if ($templateViewports.Count -lt 1) { throw 'F-100 paper layout did not expose its system viewport.' }
  foreach ($extraViewport in @($templateViewports | Select-Object -Skip 1)) { Invoke-ComRetry { $extraViewport.Delete() } | Out-Null }
  [double[]]$viewportCenter = @(210, 148.5, 0)
  $viewport = Invoke-ComRetry { $scratch.PaperSpace.AddPViewport($viewportCenter, 400, 277) }
  $viewportHandle = [string](Invoke-ComRetry { $viewport.Handle })
  $oneToTwentyStandardScale = $null
  foreach ($candidate in 2..64) {
    try {
      Invoke-ComRetry { $viewport.StandardScale = $candidate } | Out-Null
      if ([Math]::Abs([double](Invoke-ComRetry { $viewport.CustomScale }) - 0.05) -le 0.000000001) {
        $oneToTwentyStandardScale = [int]$candidate
        break
      }
    } catch {}
  }
  if ($null -eq $oneToTwentyStandardScale) { throw 'F-100 could not resolve the AutoCAD 2024 acVp1_20 enum by native CustomScale read-back.' }
  [double[]]$presetTarget = @(1000, -500, 0)
  Invoke-ComRetry {
    $viewport.Display($true)
    $viewport.DisplayLocked = $false
    $viewport.Target = $presetTarget
    $viewport.StandardScale = $oneToTwentyStandardScale
    $viewport.TwistAngle = [Math]::PI / 6
    $scratch.MSpace = $true
    $scratch.ActivePViewport = $viewport
    $scratch.Regen(1)
  } | Out-Null
  Start-Sleep -Milliseconds 400
  $preset = Get-ViewportState $scratch $viewportHandle

  # Use AutoCAD's native WCS<->Display-DCS transform as the independent camera
  # oracle. Cursor-zoom and pan targets are derived only through that native
  # transform, then applied to the native PViewport and read back.
  $utility = Invoke-ComRetry { $scratch.Utility }
  $acWorld = 0; $acDisplayDcs = 2
  [double]$presetViewHeight = $preset.height / $preset.customScale
  [double]$presetViewWidth = $preset.width / $preset.customScale
  [double]$normalizedX = -0.28; [double]$normalizedY = 0.15
  [double[]]$anchorDcsOffset = @(($normalizedX * $presetViewWidth), ($normalizedY * $presetViewHeight), 0)
  [double[]]$anchorWorldOffset = Translate-Coordinates $utility $anchorDcsOffset $acDisplayDcs $acWorld $true
  [double[]]$anchorWorld = @(([double]$preset.target.x + $anchorWorldOffset[0]), ([double]$preset.target.y + $anchorWorldOffset[1]), 0)
  [double[]]$presetTargetPoint = @($preset.target.x, $preset.target.y, 0)
  [double[]]$targetDcsBefore = Translate-Coordinates $utility $presetTargetPoint $acWorld $acDisplayDcs $false
  [double[]]$anchorDcsBefore = Translate-Coordinates $utility $anchorWorld $acWorld $acDisplayDcs $false
  $normalizedBefore = [ordered]@{
    x = ($anchorDcsBefore[0] - $targetDcsBefore[0]) / $presetViewWidth
    y = ($anchorDcsBefore[1] - $targetDcsBefore[1]) / $presetViewHeight
  }
  [double[]]$axisWorldEnd = @(([double]$preset.target.x + 1000), [double]$preset.target.y, 0)
  [double[]]$axisDcsStart = $targetDcsBefore
  [double[]]$axisDcsEnd = Translate-Coordinates $utility $axisWorldEnd $acWorld $acDisplayDcs $false
  $axisDevice = [ordered]@{
    dx = $axisDcsEnd[0] - $axisDcsStart[0]
    dy = $axisDcsEnd[1] - $axisDcsStart[1]
    screenSlope = -($axisDcsEnd[1] - $axisDcsStart[1]) / ($axisDcsEnd[0] - $axisDcsStart[0])
  }

  [double]$zoomMagnification = 1.1
  [double]$expectedZoomViewHeight = $presetViewHeight / $zoomMagnification
  [double]$expectedZoomViewWidth = $presetViewWidth / $zoomMagnification
  [double[]]$newAnchorDcsOffset = @(($normalizedX * $expectedZoomViewWidth), ($normalizedY * $expectedZoomViewHeight), 0)
  [double[]]$newAnchorWorldOffset = Translate-Coordinates $utility $newAnchorDcsOffset $acDisplayDcs $acWorld $true
  [double[]]$zoomCenter = @(($anchorWorld[0] - $newAnchorWorldOffset[0]), ($anchorWorld[1] - $newAnchorWorldOffset[1]), 0)
  Invoke-ComRetry {
    $viewport.StandardScale = 1
    $viewport.CustomScale = 0.055
    $viewport.Target = $zoomCenter
    $scratch.Regen(1)
  } | Out-Null
  Start-Sleep -Milliseconds 400
  $customZoomed = Get-ViewportState $scratch $viewportHandle
  [double]$zoomViewHeight = $customZoomed.height / $customZoomed.customScale
  [double]$zoomViewWidth = $customZoomed.width / $customZoomed.customScale
  [double[]]$zoomTargetPoint = @($customZoomed.target.x, $customZoomed.target.y, 0)
  [double[]]$targetDcsAfter = Translate-Coordinates $utility $zoomTargetPoint $acWorld $acDisplayDcs $false
  [double[]]$anchorDcsAfter = Translate-Coordinates $utility $anchorWorld $acWorld $acDisplayDcs $false
  $normalizedAfter = [ordered]@{
    x = ($anchorDcsAfter[0] - $targetDcsAfter[0]) / $zoomViewWidth
    y = ($anchorDcsAfter[1] - $targetDcsAfter[1]) / $zoomViewHeight
  }

  [double]$panDeltaX = 80; [double]$panDeltaY = -50
  [double]$panPixelWidth = 1000; [double]$panPixelHeight = 692.5
  [double[]]$panDcsOffset = @((-$panDeltaX / $panPixelWidth * $zoomViewWidth), ($panDeltaY / $panPixelHeight * $zoomViewHeight), 0)
  [double[]]$panWorldOffset = Translate-Coordinates $utility $panDcsOffset $acDisplayDcs $acWorld $true
  [double[]]$expectedPannedTarget = @(([double]$customZoomed.target.x + $panWorldOffset[0]), ([double]$customZoomed.target.y + $panWorldOffset[1]), 0)
  Invoke-ComRetry { $viewport.Target = $expectedPannedTarget; $scratch.Regen(1) } | Out-Null
  Start-Sleep -Milliseconds 400
  $customPanned = Get-ViewportState $scratch $viewportHandle
  $nativeTransform = [ordered]@{
    authority = 'AutoCAD Utility.TranslateCoordinates WCS/DisplayDCS plus native PViewport read-back'
    normalizedCursor = [ordered]@{ x = $normalizedX; y = $normalizedY }
    anchorWorld = Get-Point2 $anchorWorld
    normalizedBefore = $normalizedBefore
    normalizedAfter = $normalizedAfter
    axisDevice = $axisDevice
    zoom = [ordered]@{ magnification = $zoomMagnification; centerInput = Get-Point2 $zoomCenter; state = $customZoomed }
    pan = [ordered]@{
      deltaPx = [ordered]@{ x = $panDeltaX; y = $panDeltaY }
      viewportPx = [ordered]@{ width = $panPixelWidth; height = $panPixelHeight }
      dcsOffset = Get-Point2 $panDcsOffset
      expectedTarget = Get-Point2 $expectedPannedTarget
    }
  }
  Invoke-ComRetry { $scratch.MSpace = $false; $scratch.Regen(1) } | Out-Null

  Invoke-ComRetry { $scratch.SaveAs($tempDwg, 64) } | Out-Null
  Invoke-ComRetry { $scratch.Close($false) } | Out-Null
  $scratch = $null
  $dwgInfo = Get-Item -LiteralPath $tempDwg
  $dwgBytes = [long]$dwgInfo.Length
  $dwgSha256 = Get-Sha256 $tempDwg
  $reopened = Invoke-ComRetry { $acad.Documents.Open($tempDwg) }
  Invoke-ComRetry { $reopened.Activate() } | Out-Null
  Wait-AcadIdle $reopened
  $reopenedPaper = Invoke-ComRetry { $reopened.Layouts.Item('F100 VIEW') }
  Invoke-ComRetry { $reopened.ActiveLayout = $reopenedPaper; $reopened.ActiveSpace = 0; $reopened.MSpace = $false; $reopened.Regen(1) } | Out-Null
  $afterReopen = Get-ViewportState $reopened $viewportHandle

  $close = { param([double]$A, [double]$B, [double]$Tolerance = 0.000000001) [Math]::Abs($A - $B) -le $Tolerance }
  $checks = [ordered]@{
    nativeViewport = $preset.objectName -eq 'AcDbViewport' -and $preset.viewportOn -and $preset.handle -eq $viewportHandle
    modelContext = $preset.mSpace -and $preset.cvport -gt 1
    presetOneToTwenty = $preset.standardScale -eq $oneToTwentyStandardScale -and (& $close $preset.customScale 0.05) -and (& $close $preset.scaleDenominator 20)
    presetCenter = (& $close $preset.target.x 1000) -and (& $close $preset.target.y -500)
    counterClockwiseThirtyDegrees = (& $close $preset.twistAngleRad ([Math]::PI / 6))
    nativeTwistDeviceDirection = $axisDevice.dx -gt 0 -and $axisDevice.dy -gt 0 -and (& $close $axisDevice.screenSlope (-[Math]::Tan([Math]::PI / 6)) 0.00000001)
    cursorAnchorZoom = (& $close $customZoomed.customScale 0.055) -and (& $close $normalizedBefore.x $normalizedX 0.00000001) -and (& $close $normalizedBefore.y $normalizedY 0.00000001) -and (& $close $normalizedAfter.x $normalizedX 0.00000001) -and (& $close $normalizedAfter.y $normalizedY 0.00000001)
    customScale = $customPanned.standardScale -eq 1 -and (& $close $customPanned.customScale 0.055) -and (& $close $customPanned.scaleDenominator (1 / 0.055))
    nativePannedTarget = (& $close $customPanned.target.x $expectedPannedTarget[0] 0.00000001) -and (& $close $customPanned.target.y $expectedPannedTarget[1] 0.00000001)
    panKeepsScaleAndTwist = (& $close $customPanned.customScale 0.055) -and (& $close $customPanned.twistAngleRad ([Math]::PI / 6))
    nativeDwgReopen = $afterReopen.handle -eq $viewportHandle -and $afterReopen.objectName -eq 'AcDbViewport' -and $afterReopen.viewportOn
    statePersisted = (& $close $afterReopen.customScale $customPanned.customScale) -and (& $close $afterReopen.target.x $customPanned.target.x) -and (& $close $afterReopen.target.y $customPanned.target.y) -and (& $close $afterReopen.twistAngleRad $customPanned.twistAngleRad)
    paperAfterReopen = -not $afterReopen.mSpace -and $afterReopen.cvport -eq 1
  }
  $status = if (@($checks.Values | Where-Object { $_ -ne $true }).Count -eq 0) { 'PASS' } else { 'FAIL' }
  $result = [ordered]@{
    schemaVersion = 1; rowId = 'F-100'; benchmark = 'AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation'
    engine = 'Autodesk AutoCAD 2024 desktop COM/native PViewport'; engineVersion = $engineVersion
    automationProcessId = $automationProcessId; automationProcessOwned = $owned; automationProcessIdentity = $automationProcessIdentity; viewportHandle = $viewportHandle
    oneToTwentyStandardScaleEnum = $oneToTwentyStandardScale
    preset = $preset; nativeTransform = $nativeTransform; customPanned = $customPanned; afterReopen = $afterReopen; checks = $checks
    dwg = [ordered]@{ bytes = $dwgBytes; sha256 = $dwgSha256; saveAsType = 64; retained = $false }
    status = $status
  }
} catch {
  Write-Error ("F-100 failure at {0}: {1}" -f $_.InvocationInfo.PositionMessage, $_.Exception.Message)
  throw
} finally {
  if ($reopened) { try { Invoke-ComRetry { $reopened.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
  if ($scratch) { try { Invoke-ComRetry { $scratch.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
  if (Test-Path -LiteralPath $tempDwg) { Remove-Item -LiteralPath $tempDwg -Force }
}

if (-not $result) { throw 'F-100 AutoCAD matrix produced no result.' }
$result.userDocument = [ordered]@{ isolatedOwnedProcess = $owned; blankRestored = $owned }
$finalStatus = $result.status
$result | ConvertTo-Json -Depth 12
if ($finalStatus -ne 'PASS') { exit 1 }
