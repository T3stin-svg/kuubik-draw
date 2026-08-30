param(
  [Parameter(Mandatory = $true)][string]$TempDwgPath,
  [Parameter(Mandatory = $true)][string]$TempPdfPath,
  [Parameter(Mandatory = $true)][string]$TempReopenPdfPath,
  [Parameter(Mandatory = $true)][string]$PidPath,
  [Parameter(Mandatory = $true)][string]$OwnershipToken
)

$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class F104WindowProcess {
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

function Invoke-NonEmptyCom {
  param([Parameter(Mandatory = $true)][scriptblock]$Action, [string]$Label = 'COM value', [int]$TimeoutSeconds = 20)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    try {
      $value = [string](& $Action)
      if (-not [string]::IsNullOrWhiteSpace($value)) { return $value }
    } catch {
      if ([DateTime]::UtcNow -ge $deadline) { throw }
    }
    if ([DateTime]::UtcNow -ge $deadline) { throw "$Label remained empty for $TimeoutSeconds seconds." }
    Start-Sleep -Milliseconds 150
  } while ($true)
}

function Wait-AcadIdle {
  param([Parameter(Mandatory = $true)]$Document, [int]$TimeoutSeconds = 30)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 100
    try { if ([string]::IsNullOrWhiteSpace([string]$Document.GetVariable('CMDNAMES')) -and [int]$Document.GetVariable('CMDACTIVE') -eq 0) { return } } catch {}
  } while ([DateTime]::UtcNow -lt $deadline)
  $commands = try { [string]$Document.GetVariable('CMDNAMES') } catch { '' }
  $prompt = try { [string]$Document.GetVariable('LASTPROMPT') } catch { '' }
  throw "AutoCAD did not return idle for F-104. CMDNAMES='$commands' LASTPROMPT='$prompt'"
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

function Get-Point2 {
  param($Value)
  if ($null -eq $Value -or @($Value).Count -lt 2) { throw 'AutoCAD returned an incomplete 2D point.' }
  return [ordered]@{ x = [double]$Value[0]; y = [double]$Value[1] }
}

function Set-IsoA3Landscape {
  param([Parameter(Mandatory = $true)]$Layout)
  $media = @($Layout.GetCanonicalMediaNames() | Where-Object {
    [string]$_ -match '(?i)A3' -and [string]$_ -match '297' -and [string]$_ -match '420'
  } | Sort-Object { [string]$_ -match '(?i)full.?bleed' } | Select-Object -First 1)
  if ($media.Count -ne 1) { throw 'DWG To PDF.pc3 did not expose ISO A3.' }
  Invoke-ComRetry { $Layout.CanonicalMediaName = [string]$media[0]; $Layout.PlotRotation = 0 } | Out-Null
  [double]$width = 0; [double]$height = 0
  Invoke-ComRetry { $Layout.GetPaperSize([ref]$width, [ref]$height) } | Out-Null
  if ($width -lt $height) { Invoke-ComRetry { $Layout.PlotRotation = 1 } | Out-Null }
  return [string]$media[0]
}

function Get-LayoutBlockEntities {
  param([Parameter(Mandatory = $true)]$Layout)
  $block = Invoke-ComRetry { $Layout.Block }
  $count = [int](Invoke-ComRetry { $block.Count })
  $entities = New-Object System.Collections.Generic.List[object]
  for ($index = 0; $index -lt $count; $index += 1) {
    $entities.Add((Invoke-ComRetry { $block.Item($index) }))
  }
  return [object[]]$entities.ToArray()
}

function Get-LayoutSnapshot {
  param(
    [Parameter(Mandatory = $true)]$Document,
    [Parameter(Mandatory = $true)]$Layout,
    [Parameter(Mandatory = $true)][string]$SystemViewportHandle,
    [Parameter(Mandatory = $true)][string]$FirstHandle,
    [Parameter(Mandatory = $true)][string]$SecondHandle,
    [Parameter(Mandatory = $true)][string]$BoundaryHandle
  )
  [double]$rawWidth = 0; [double]$rawHeight = 0
  Invoke-ComRetry { $Layout.GetPaperSize([ref]$rawWidth, [ref]$rawHeight) } | Out-Null
  $rotation = [int](Invoke-ComRetry { $Layout.PlotRotation })
  $paperWidth = if ($rotation -eq 1 -or $rotation -eq 3) { $rawHeight } else { $rawWidth }
  $paperHeight = if ($rotation -eq 1 -or $rotation -eq 3) { $rawWidth } else { $rawHeight }
  $blockEntities = @(Get-LayoutBlockEntities $Layout)
  $viewports = @($blockEntities | Where-Object {
    $entity = $_
    [string](Invoke-ComRetry { $entity.ObjectName }) -eq 'AcDbViewport' -and [string](Invoke-ComRetry { $entity.Handle }) -ne $SystemViewportHandle
  } | Sort-Object { $entity = $_; [string](Invoke-ComRetry { $entity.Handle }) })
  return [ordered]@{
    layoutName = Invoke-NonEmptyCom { $Layout.Name } 'Layout name'
    configName = Invoke-NonEmptyCom { $Layout.ConfigName } 'Plot configuration name'
    canonicalMediaName = Invoke-NonEmptyCom { $Layout.CanonicalMediaName } 'Canonical media name'
    paper = [ordered]@{ widthMm = $paperWidth; heightMm = $paperHeight; rawWidthMm = $rawWidth; rawHeightMm = $rawHeight; rotation = $rotation }
    plotType = [int](Invoke-ComRetry { $Layout.PlotType })
    plotWithLineweights = [bool](Invoke-ComRetry { $Layout.PlotWithLineweights })
    plotWithPlotStyles = [bool](Invoke-ComRetry { $Layout.PlotWithPlotStyles })
    tileMode = [int](Invoke-ComRetry { $Document.GetVariable('TILEMODE') })
    cvport = [int](Invoke-ComRetry { $Document.GetVariable('CVPORT') })
    mSpace = [bool](Invoke-ComRetry { $Document.MSpace })
    viewportCount = [int]$viewports.Count
    viewports = @($viewports | ForEach-Object {
      $viewport = $_
      [ordered]@{
        handle = Invoke-NonEmptyCom { $viewport.Handle } 'Viewport handle'; center = Invoke-ComRetry { Get-Point2 $viewport.Center }
        width = [double](Invoke-ComRetry { $value = [double]$viewport.Width; if ($value -le 0) { throw 'Viewport width is transiently unavailable.' }; $value })
        height = [double](Invoke-ComRetry { $value = [double]$viewport.Height; if ($value -le 0) { throw 'Viewport height is transiently unavailable.' }; $value })
        target = Invoke-ComRetry { Get-Point2 $viewport.Target }; customScale = [double](Invoke-ComRetry { $viewport.CustomScale }); twistAngle = [double](Invoke-ComRetry { $viewport.TwistAngle })
        clipped = [bool](Invoke-ComRetry { $viewport.Clipped }); displayLocked = [bool](Invoke-ComRetry { $viewport.DisplayLocked }); viewportOn = [bool](Invoke-ComRetry { $viewport.ViewportOn })
      }
    })
    expectedHandles = [ordered]@{ first = $FirstHandle; second = $SecondHandle; polygonBoundary = $BoundaryHandle }
    boundaryPresent = @($blockEntities | Where-Object { $entity = $_; [string](Invoke-ComRetry { $entity.Handle }) -eq $BoundaryHandle }).Count -eq 1
    paperText = @($blockEntities | Where-Object { $entity = $_; [string](Invoke-ComRetry { $entity.ObjectName }) -match 'AcDb(Text|MText)' } | ForEach-Object { $entity = $_; Invoke-NonEmptyCom { $entity.TextString } 'Paper text' })
  }
}

function Get-StableF104LayoutSnapshot {
  param(
    [Parameter(Mandatory = $true)]$Document,
    [Parameter(Mandatory = $true)]$Layout,
    [Parameter(Mandatory = $true)][string]$SystemViewportHandle,
    [Parameter(Mandatory = $true)][string]$FirstHandle,
    [Parameter(Mandatory = $true)][string]$SecondHandle,
    [Parameter(Mandatory = $true)][string]$BoundaryHandle,
    [int]$TimeoutSeconds = 30
  )
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $snapshot = $null
  do {
    $snapshot = Get-LayoutSnapshot $Document $Layout $SystemViewportHandle $FirstHandle $SecondHandle $BoundaryHandle
    $firstSnapshot = @($snapshot.viewports | Where-Object { $_.handle -eq $FirstHandle })[0]
    $secondSnapshot = @($snapshot.viewports | Where-Object { $_.handle -eq $SecondHandle })[0]
    $stable = $null -ne $firstSnapshot -and $null -ne $secondSnapshot `
      -and [Math]::Abs([double]$firstSnapshot.customScale - 0.02) -le 0.000001 `
      -and [Math]::Abs([double]$secondSnapshot.customScale - 0.01) -le 0.000001 `
      -and [Math]::Abs([double]$firstSnapshot.target.x) -le 0.001 `
      -and [Math]::Abs([double]$secondSnapshot.target.x - 20000) -le 0.001 `
      -and $firstSnapshot.displayLocked -and $secondSnapshot.displayLocked `
      -and $firstSnapshot.viewportOn -and $secondSnapshot.viewportOn `
      -and -not $firstSnapshot.clipped -and $secondSnapshot.clipped `
      -and $snapshot.paperText -contains 'KUUBIK F-104 VECTOR LAYOUT' `
      -and $snapshot.paperText -contains 'A3 420x297 | 1:50 + 1:100'
    if ($stable) { return $snapshot }
    Invoke-ComRetry {
      $firstViewport = $Document.HandleToObject($FirstHandle); $secondViewport = $Document.HandleToObject($SecondHandle)
      $firstViewport.Display($true); $firstViewport.Target = [double[]]@(0, 0, 0); $firstViewport.CustomScale = 0.02; $firstViewport.DisplayLocked = $true
      $secondViewport.Display($true); $secondViewport.Target = [double[]]@(20000, 0, 0); $secondViewport.CustomScale = 0.01; $secondViewport.DisplayLocked = $true
      $Document.Regen(1)
    } | Out-Null
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "F-104 layout did not stabilize before evidence capture: $($snapshot | ConvertTo-Json -Depth 8 -Compress)"
}

$preExistingProcessIds = @(Get-Process -Name 'acad' -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.Id })
$acad = $null; $scratch = $null; $reopened = $null; $result = $null; $automationProcessId = 0; $owned = $false
$tempDwg = [IO.Path]::GetFullPath($TempDwgPath); $tempPdf = [IO.Path]::GetFullPath($TempPdfPath); $tempReopenPdf = [IO.Path]::GetFullPath($TempReopenPdfPath); $pidFile = [IO.Path]::GetFullPath($PidPath)
try {
  # COM activation is single-shot: retrying New-Object can launch multiple
  # unauthenticated acad.exe processes when registration is slow.
  $acad = New-Object -ComObject AutoCAD.Application.24.3
  Invoke-ComRetry { $acad.Visible = $true; $acad.WindowState = 3 } | Out-Null
  [uint32]$resolvedProcessId = 0
  [void][F104WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry { $acad.HWND }), [ref]$resolvedProcessId)
  $automationProcessId = [int]$resolvedProcessId; $owned = $automationProcessId -gt 0 -and $preExistingProcessIds -notcontains $automationProcessId
  if (-not $owned) { throw 'F-104 refuses to use a pre-existing AutoCAD process.' }
  $automationProcess = Get-Process -Id $automationProcessId -ErrorAction Stop
  $automationExecutablePath = [IO.Path]::GetFullPath([string]$automationProcess.Path)
  if ([IO.Path]::GetFileName($automationExecutablePath) -ine 'acad.exe') { throw "F-104 PID $automationProcessId is not acad.exe." }
  $automationStartTimeUtc = $automationProcess.StartTime.ToUniversalTime().ToString('o')
  [ordered]@{ schemaVersion = 1; processId = $automationProcessId; executablePath = $automationExecutablePath; startTimeUtc = $automationStartTimeUtc; owned = $true; token = $OwnershipToken } | ConvertTo-Json -Compress | Set-Content -LiteralPath $pidFile -Encoding ascii
  $engineVersion = [string](Invoke-ComRetry { $acad.Version })

  $scratch = if ([int](Invoke-ComRetry { $acad.Documents.Count }) -gt 0) { Invoke-ComRetry { $acad.ActiveDocument } } else { Invoke-ComRetry { $acad.Documents.Add() } }
  if ([string](Invoke-ComRetry { $scratch.FullName }) -or [int](Invoke-ComRetry { $scratch.ModelSpace.Count }) -ne 0) { throw 'F-104 refuses a saved or non-blank drawing.' }
  Invoke-ComRetry { $scratch.Activate(); $scratch.SetVariable('BACKGROUNDPLOT', 0) } | Out-Null
  Wait-AcadIdle $scratch
  $papers = @(Invoke-ComRetry { @($scratch.Layouts | Where-Object { [string]$_.Name -ne 'Model' } | Sort-Object TabOrder) } -TimeoutSeconds 30)
  if ($papers.Count -lt 1) { throw 'F-104 QNEW did not provide a paper layout.' }
  $paper = $papers[0]; foreach ($extra in @($papers | Select-Object -Skip 1)) { Invoke-ComRetry { $extra.Delete() } | Out-Null }
  Invoke-ComRetry {
    $paper.Name = 'F104 VECTOR OUTPUT'; $paper.ConfigName = 'DWG To PDF.pc3'; $paper.RefreshPlotDeviceInfo(); $paper.PaperUnits = 1
    $scratch.ActiveLayout = $paper; $scratch.ActiveSpace = 0; $scratch.MSpace = $false
  } | Out-Null
  $a3Media = Set-IsoA3Landscape $paper
  Invoke-ComRetry {
    # AutoCAD rejects CenterPlot changes while PlotType is already Layout.
    # Configure the values in Extents first, then switch back to Layout.
    $paper.PlotType = 1; $paper.CenterPlot = $false; $paper.UseStandardScale = $false; $paper.SetCustomScale(1.0, 1.0)
    $paper.PlotOrigin = [double[]]@(0, 0); $paper.PlotWithLineweights = $true; $paper.PlotWithPlotStyles = $false; $paper.PlotType = 5
  } | Out-Null

  $redLayer = Invoke-ComRetry { $scratch.Layers.Add('F104 RED') }; $blueLayer = Invoke-ComRetry { $scratch.Layers.Add('F104 BLUE') }; $viewportLayer = Invoke-ComRetry { $scratch.Layers.Add('F104 VIEWPORTS') }
  Invoke-ComRetry { $redLayer.Color = 1; $blueLayer.Color = 5; $viewportLayer.Plottable = $false } | Out-Null
  $redLine = Invoke-ComRetry { $scratch.ModelSpace.AddLine([double[]]@(-3500, -2000, 0), [double[]]@(3500, 2000, 0)) }
  $redText = Invoke-ComRetry { $scratch.ModelSpace.AddText('VIEW 1 SCALE 1:50', [double[]]@(-2800, 3000, 0), 500) }
  $blueCircle = Invoke-ComRetry { $scratch.ModelSpace.AddCircle([double[]]@(20000, 0, 0), 3000) }
  $blueLine = Invoke-ComRetry { $scratch.ModelSpace.AddLine([double[]]@(16500, 0, 0), [double[]]@(23500, 0, 0)) }
  $blueText = Invoke-ComRetry { $scratch.ModelSpace.AddText('VIEW 2 SCALE 1:100', [double[]]@(16600, 4500, 0), 900) }
  Invoke-ComRetry { $redLine.Layer = 'F104 RED'; $redText.Layer = 'F104 RED'; $blueCircle.Layer = 'F104 BLUE'; $blueLine.Layer = 'F104 BLUE'; $blueText.Layer = 'F104 BLUE' } | Out-Null

  $frame = Invoke-ComRetry { $scratch.PaperSpace.AddLightWeightPolyline([double[]]@(10, 10, 410, 10, 410, 287, 10, 287)) }; Invoke-ComRetry { $frame.Closed = $true } | Out-Null
  Invoke-ComRetry { $scratch.PaperSpace.AddLine([double[]]@(210, 10, 0), [double[]]@(210, 287, 0)) } | Out-Null
  Invoke-ComRetry { $scratch.PaperSpace.AddText('KUUBIK F-104 VECTOR LAYOUT', [double[]]@(15, 17, 0), 5) } | Out-Null
  Invoke-ComRetry { $scratch.PaperSpace.AddText('A3 420x297 | 1:50 + 1:100', [double[]]@(255, 17, 0), 4) } | Out-Null

  $templateViewports = @(Invoke-ComRetry { @($paper.Block | Where-Object { [string]$_.ObjectName -eq 'AcDbViewport' }) })
  if ($templateViewports.Count -lt 1) { throw 'F-104 paper layout did not expose its system viewport.' }
  $systemViewportHandle = Invoke-NonEmptyCom { $templateViewports[0].Handle } 'System viewport handle'
  foreach ($extraViewport in @($templateViewports | Select-Object -Skip 1)) { Invoke-ComRetry { $extraViewport.Delete() } | Out-Null }
  $first = Invoke-ComRetry { $scratch.PaperSpace.AddPViewport([double[]]@(108.75, 148.5, 0), 185, 247) }
  $second = Invoke-ComRetry { $scratch.PaperSpace.AddPViewport([double[]]@(311.25, 148.5, 0), 185, 247) }
  Invoke-ComRetry {
    $first.Layer = 'F104 VIEWPORTS'; $first.Display($true); $first.Target = [double[]]@(0, 0, 0); $first.CustomScale = 0.02; $first.DisplayLocked = $true
    $second.Layer = 'F104 VIEWPORTS'; $second.Display($true); $second.Target = [double[]]@(20000, 0, 0); $second.CustomScale = 0.01; $second.DisplayLocked = $true
  } | Out-Null
  $firstHandle = Invoke-NonEmptyCom { $first.Handle } 'First viewport handle'; $secondHandle = Invoke-NonEmptyCom { $second.Handle } 'Second viewport handle'
  $boundary = Invoke-ComRetry { $scratch.PaperSpace.AddLightWeightPolyline([double[]]@(218.75, 25, 403.75, 25, 382, 272, 240.5, 272)) }
  Invoke-ComRetry { $boundary.Closed = $true; $boundary.Layer = 'F104 VIEWPORTS' } | Out-Null
  $boundaryHandle = Invoke-NonEmptyCom { $boundary.Handle } 'Viewport clip boundary handle'
  Send-AcadCommand $scratch "_.VPCLIP`n(handent `"$secondHandle`")`n(handent `"$boundaryHandle`")`n"
  # VPCLIP can transiently reset the active layout's plot area to Display.
  # Reacquire the native layout and both viewports, then restore their persisted
  # display/lock state and Layout plot type before evidence capture.
  $paper = Invoke-ComRetry { $scratch.Layouts.Item('F104 VECTOR OUTPUT') }
  $first = Invoke-ComRetry { $scratch.HandleToObject($firstHandle) }
  $second = Invoke-ComRetry { $scratch.HandleToObject($secondHandle) }
  Invoke-ComRetry {
    $scratch.ActiveLayout = $paper; $scratch.MSpace = $false
    $first.Display($true); $first.Target = [double[]]@(0, 0, 0); $first.CustomScale = 0.02; $first.DisplayLocked = $true
    $second.Display($true); $second.Target = [double[]]@(20000, 0, 0); $second.CustomScale = 0.01; $second.DisplayLocked = $true
    $paper.PlotType = 5; $scratch.Regen(1)
  } | Out-Null
  $beforeSave = Get-StableF104LayoutSnapshot $scratch $paper $systemViewportHandle $firstHandle $secondHandle $boundaryHandle
  $plotSucceeded = [bool](Invoke-ComRetry { $scratch.Plot.PlotToFile($tempPdf) } -TimeoutSeconds 60)
  if (-not $plotSucceeded -or -not (Test-Path -LiteralPath $tempPdf)) { throw 'AutoCAD PlotToFile did not create the F-104 PDF.' }
  $pdfInfo = Get-Item -LiteralPath $tempPdf; $pdfSha256 = Get-Sha256 $tempPdf
  Invoke-ComRetry { $scratch.SaveAs($tempDwg, 64) } | Out-Null
  Invoke-ComRetry { $scratch.Close($false) } | Out-Null; $scratch = $null
  $dwgInfo = Get-Item -LiteralPath $tempDwg; $dwgSha256 = Get-Sha256 $tempDwg

  $reopened = Invoke-ComRetry { $acad.Documents.Open($tempDwg) }; Invoke-ComRetry { $reopened.Activate() } | Out-Null; Wait-AcadIdle $reopened
  $paper = Invoke-ComRetry { $reopened.Layouts.Item('F104 VECTOR OUTPUT') }
  Invoke-ComRetry { $reopened.ActiveLayout = $paper; $reopened.ActiveSpace = 0; $reopened.MSpace = $false; $reopened.Regen(1) } | Out-Null
  Start-Sleep -Milliseconds 500
  $afterReopen = Invoke-ComRetry { Get-LayoutSnapshot $reopened $paper $systemViewportHandle $firstHandle $secondHandle $boundaryHandle } -TimeoutSeconds 30
  $reopenPlotSucceeded = [bool](Invoke-ComRetry { $reopened.Plot.PlotToFile($tempReopenPdf) } -TimeoutSeconds 60)
  if (-not $reopenPlotSucceeded -or -not (Test-Path -LiteralPath $tempReopenPdf)) { throw 'AutoCAD reopened PlotToFile did not create the F-104 PDF.' }
  $reopenPdfInfo = Get-Item -LiteralPath $tempReopenPdf; $reopenPdfSha256 = Get-Sha256 $tempReopenPdf

  $beforeFirst = @($beforeSave.viewports | Where-Object { $_.handle -eq $firstHandle })[0]; $beforeSecond = @($beforeSave.viewports | Where-Object { $_.handle -eq $secondHandle })[0]
  $reopenFirst = @($afterReopen.viewports | Where-Object { $_.handle -eq $firstHandle })[0]; $reopenSecond = @($afterReopen.viewports | Where-Object { $_.handle -eq $secondHandle })[0]
  $close = { param([double]$A, [double]$B, [double]$Tolerance = 0.001) [Math]::Abs($A - $B) -le $Tolerance }
  $checks = [ordered]@{
    nativeA3Layout = (& $close $beforeSave.paper.widthMm 420) -and (& $close $beforeSave.paper.heightMm 297) -and $beforeSave.plotType -eq 5 -and $beforeSave.configName -eq 'DWG To PDF.pc3'
    twoNativeViewports = $beforeSave.viewportCount -eq 2 -and $null -ne $beforeFirst -and $null -ne $beforeSecond
    exactFrames = (& $close $beforeFirst.center.x 108.75) -and (& $close $beforeSecond.center.x 311.25) -and (& $close $beforeFirst.width 185) -and (& $close $beforeSecond.width 185) -and (& $close $beforeFirst.height 247) -and (& $close $beforeSecond.height 247)
    exactScalesAndTargets = (& $close $beforeFirst.customScale 0.02 0.000001) -and (& $close $beforeSecond.customScale 0.01 0.000001) -and (& $close $beforeFirst.target.x 0) -and (& $close $beforeSecond.target.x 20000)
    rectangleAndPolygonClip = -not $beforeFirst.clipped -and $beforeSecond.clipped -and $beforeSave.boundaryPresent
    lockedAndDisplayed = $beforeFirst.displayLocked -and $beforeSecond.displayLocked -and $beforeFirst.viewportOn -and $beforeSecond.viewportOn
    paperTitle = $beforeSave.paperText -contains 'KUUBIK F-104 VECTOR LAYOUT' -and $beforeSave.paperText -contains 'A3 420x297 | 1:50 + 1:100'
    nativePdfPlot = $plotSucceeded -and $pdfInfo.Length -gt 0 -and $pdfSha256 -match '^[a-f0-9]{64}$'
    nativeDwgReopen = $dwgInfo.Length -gt 0 -and $dwgSha256 -match '^[a-f0-9]{64}$' -and $afterReopen.viewportCount -eq 2
    statePersisted = (& $close $reopenFirst.customScale 0.02 0.000001) -and (& $close $reopenSecond.customScale 0.01 0.000001) -and $reopenFirst.displayLocked -and $reopenSecond.displayLocked -and -not $reopenFirst.clipped -and $reopenSecond.clipped -and $afterReopen.boundaryPresent
    reopenedNativePdfPlot = $reopenPlotSucceeded -and $reopenPdfInfo.Length -gt 0 -and $reopenPdfSha256 -match '^[a-f0-9]{64}$'
    paperSpaceRestored = $afterReopen.tileMode -eq 0 -and $afterReopen.cvport -eq 1 -and -not $afterReopen.mSpace
  }
  $status = if (@($checks.Values | Where-Object { $_ -ne $true }).Count -eq 0) { 'PASS' } else { 'FAIL' }
  $result = [ordered]@{
    schemaVersion = 1; rowId = 'F-104'; benchmark = 'AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation'
    engine = 'Autodesk AutoCAD 2024 desktop COM/native viewports, VPCLIP, DWG To PDF.pc3 and DWG reopen'; engineVersion = $engineVersion
    automationProcessId = $automationProcessId; automationProcessOwned = $owned; media = $a3Media
    handles = [ordered]@{ systemViewport = $systemViewportHandle; firstViewport = $firstHandle; secondViewport = $secondHandle; polygonBoundary = $boundaryHandle }
    beforeSave = $beforeSave; afterReopen = $afterReopen; checks = $checks
    dwg = [ordered]@{ bytes = [long]$dwgInfo.Length; sha256 = $dwgSha256; saveAsType = 64; retained = $false }
    pdf = [ordered]@{ bytes = [long]$pdfInfo.Length; sha256 = $pdfSha256; retained = $false }
    reopenPdf = [ordered]@{ bytes = [long]$reopenPdfInfo.Length; sha256 = $reopenPdfSha256; retained = $false }
    status = $status
  }
} catch {
  Write-Error ("F-104 failure at {0}: {1}" -f $_.InvocationInfo.PositionMessage, $_.Exception.Message); throw
} finally {
  if ($reopened) { try { Invoke-ComRetry { $reopened.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
  if ($scratch) { try { Invoke-ComRetry { $scratch.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
  if (Test-Path -LiteralPath $tempDwg) { Remove-Item -LiteralPath $tempDwg -Force }
}
if (-not $result) { throw 'F-104 AutoCAD matrix produced no result.' }
$result.userDocument = [ordered]@{ isolatedOwnedProcess = $owned; blankRestored = $owned }
$finalStatus = $result.status; $result | ConvertTo-Json -Depth 14
if ($finalStatus -ne 'PASS') { exit 1 }
