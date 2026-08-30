param(
  [Parameter(Mandatory = $true)][string]$TempDwgPath,
  [Parameter(Mandatory = $true)][string]$PidPath,
  [Parameter(Mandatory = $true)][string]$OwnershipToken
)

$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class F099WindowProcess {
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
  $commands = try { [string]$Document.GetVariable('CMDNAMES') } catch { '' }
  $prompt = try { [string]$Document.GetVariable('LASTPROMPT') } catch { '' }
  throw "AutoCAD did not return idle for F-099. CMDNAMES='$commands' LASTPROMPT='$prompt'"
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
  if ($null -eq $Value -or @($Value).Count -lt 2) { return $null }
  return [ordered]@{ x = [double]$Value[0]; y = [double]$Value[1] }
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

function Get-ViewportSnapshot {
  param(
    [Parameter(Mandatory = $true)]$Document,
    [Parameter(Mandatory = $true)][string]$LayoutName,
    [Parameter(Mandatory = $true)][string]$SystemViewportHandle
  )
  $layout = Invoke-ComRetry { $Document.Layouts.Item($LayoutName) }
  $blockEntities = @(Get-LayoutBlockEntities $layout)
  $viewports = @($blockEntities | Where-Object {
      if ([string]$_.ObjectName -ne 'AcDbViewport') { return $false }
      if ([string]$_.Handle -eq $SystemViewportHandle) { return $false }
      try {
        return $null -ne $_.Center -and [double]$_.Width -gt 0 -and [double]$_.Height -gt 0 -and
          [double]$_.Width -lt 1000 -and [double]$_.Height -lt 1000
      } catch { return $false }
    } | Sort-Object { [string]$_.Handle })
  $polylines = @($blockEntities | Where-Object { [string]$_.ObjectName -eq 'AcDbPolyline' } | Sort-Object { [string]$_.Handle })
  $layoutNameValue = [string](Invoke-ComRetry {
    $value = [string]$layout.Name
    if ([string]::IsNullOrWhiteSpace($value)) { throw 'Layout name is temporarily unavailable.' }
    $value
  })
  return [ordered]@{
    layoutName = $layoutNameValue
    tileMode = [int](Invoke-ComRetry { $Document.GetVariable('TILEMODE') })
    cvport = [int](Invoke-ComRetry { $Document.GetVariable('CVPORT') })
    mSpace = [bool](Invoke-ComRetry { $Document.MSpace })
    viewportCount = [int]$viewports.Count
    viewportHandles = @($viewports | ForEach-Object { [string]$_.Handle })
    viewports = @($viewports | ForEach-Object {
      [ordered]@{
        handle = [string]$_.Handle
        center = (Get-Point2 $_.Center)
        width = [double]$_.Width
        height = [double]$_.Height
        target = (Get-Point2 $_.Target)
        customScale = [double]$_.CustomScale
        twistAngle = [double]$_.TwistAngle
        clipped = [bool]$_.Clipped
        viewportOn = [bool]$_.ViewportOn
      }
    })
    boundaryCount = [int]$polylines.Count
    boundaryHandles = @($polylines | ForEach-Object { [string]$_.Handle })
  }
}

function Get-StableViewportSnapshot {
  param($Document, [string]$LayoutName, [string]$SystemViewportHandle, [string[]]$ExpectedViewportHandles, [string[]]$ExpectedBoundaryHandles, [int]$MaximumPasses = 12)
  $passes = New-Object System.Collections.Generic.List[object]
  $lastSnapshot = $null
  $previousFingerprint = $null
  $consecutiveExactReads = 0
  for ($pass = 1; $pass -le $MaximumPasses; $pass += 1) {
    Wait-AcadIdle $Document
    $lastSnapshot = Get-ViewportSnapshot $Document $LayoutName $SystemViewportHandle
    $handlesExact = $lastSnapshot.viewportCount -eq $ExpectedViewportHandles.Count -and @($ExpectedViewportHandles | Where-Object { $lastSnapshot.viewportHandles -notcontains $_ }).Count -eq 0
    $boundariesExact = $lastSnapshot.boundaryCount -eq $ExpectedBoundaryHandles.Count -and @($ExpectedBoundaryHandles | Where-Object { $lastSnapshot.boundaryHandles -notcontains $_ }).Count -eq 0
    $statesExact = $handlesExact -and @($lastSnapshot.viewports | Where-Object { -not $_.viewportOn }).Count -eq 0
    if ($ExpectedViewportHandles.Count -eq 2 -and $statesExact) {
      $firstState = @($lastSnapshot.viewports | Where-Object { $_.handle -eq $ExpectedViewportHandles[0] })[0]
      $secondState = @($lastSnapshot.viewports | Where-Object { $_.handle -eq $ExpectedViewportHandles[1] })[0]
      $statesExact = $null -ne $firstState -and $null -ne $secondState -and -not $firstState.clipped -and $secondState.clipped -and
        [Math]::Abs($firstState.target.x) -lt 0.001 -and [Math]::Abs($secondState.target.x - 2000) -lt 0.001 -and
        [Math]::Abs($firstState.customScale - 0.16) -lt 0.000001 -and [Math]::Abs($secondState.customScale - 0.08) -lt 0.000001
    }
    $exact = $handlesExact -and $boundariesExact -and $statesExact
    $fingerprint = if ($exact) { $lastSnapshot | ConvertTo-Json -Depth 8 -Compress } else { $null }
    if ($fingerprint -and $fingerprint -eq $previousFingerprint) { $consecutiveExactReads += 1 }
    elseif ($fingerprint) { $consecutiveExactReads = 1 }
    else { $consecutiveExactReads = 0 }
    $passes.Add([ordered]@{ pass=$pass; exact=$exact; consecutiveExactReads=$consecutiveExactReads; viewportHandles=$lastSnapshot.viewportHandles; boundaryHandles=$lastSnapshot.boundaryHandles })
    if ($consecutiveExactReads -ge 2) { return [ordered]@{ stable=$true; snapshot=$lastSnapshot; passes=[object[]]$passes.ToArray() } }
    $previousFingerprint = $fingerprint
    Start-Sleep -Milliseconds 150
  }
  return [ordered]@{ stable=$false; snapshot=$lastSnapshot; passes=[object[]]$passes.ToArray() }
}

$preExistingProcessIds = @(Get-Process -Name 'acad' -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.Id })
$acad = $null; $scratch = $null; $reopened = $null; $result = $null; $automationProcessId = 0; $owned = $false; $engineVersion = ''
$tempDwg = [IO.Path]::GetFullPath($TempDwgPath)
$pidFile = [IO.Path]::GetFullPath($PidPath)
try {
  $acad = New-Object -ComObject AutoCAD.Application.24.3
  Invoke-ComRetry { $acad.Visible = $true; $acad.WindowState = 3 } | Out-Null
  [uint32]$resolvedProcessId = 0
  [void][F099WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry { $acad.HWND }), [ref]$resolvedProcessId)
  $automationProcessId = [int]$resolvedProcessId
  $owned = $automationProcessId -gt 0 -and $preExistingProcessIds -notcontains $automationProcessId
  $engineVersion = [string](Invoke-ComRetry { $acad.Version })
  Write-Host "[F-099] automation-process pid=$automationProcessId owned=$owned"
  if (-not $owned) { throw 'F-099 refuses to use a pre-existing AutoCAD process.' }
  [ordered]@{ schemaVersion = 1; processId = $automationProcessId; owned = $true; token = $OwnershipToken } |
    ConvertTo-Json -Compress | Set-Content -LiteralPath $pidFile -Encoding ascii

  $scratch = if ([int](Invoke-ComRetry { $acad.Documents.Count }) -gt 0) { Invoke-ComRetry { $acad.ActiveDocument } } else { Invoke-ComRetry { $acad.Documents.Add() } }
  if ([string](Invoke-ComRetry { $scratch.FullName }) -or [int](Invoke-ComRetry { $scratch.ModelSpace.Count }) -ne 0) { throw 'F-099 refuses a saved or non-blank drawing.' }
  Invoke-ComRetry { $scratch.Activate() } | Out-Null
  Wait-AcadIdle $scratch
  $papers = @(Invoke-ComRetry { @($scratch.Layouts | Where-Object { [string]$_.Name -ne 'Model' } | Sort-Object TabOrder) } -TimeoutSeconds 30)
  if ($papers.Count -lt 1) { throw 'F-099 QNEW did not provide a paper layout.' }
  $paper = $papers[0]
  foreach ($extra in @($papers | Select-Object -Skip 1)) { Invoke-ComRetry { $extra.Delete() } | Out-Null }
  Invoke-ComRetry {
    $paper.Name = 'F099 VIEWPORTS'
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
  [double[]]$modelCenterOne = @(0, 0, 0); [double[]]$modelCenterTwo = @(2000, 0, 0)
  Invoke-ComRetry { $scratch.ModelSpace.AddCircle($modelCenterOne, 220) } | Out-Null
  Invoke-ComRetry { $scratch.ModelSpace.AddCircle($modelCenterTwo, 220) } | Out-Null
  [double[]]$firstCenter = @(108.75, 148.5, 0); [double[]]$secondCenter = @(311.25, 148.5, 0)
  $templateViewports = @(Invoke-ComRetry { @($paper.Block | Where-Object { [string]$_.ObjectName -eq 'AcDbViewport' }) })
  if ($templateViewports.Count -lt 1) { throw 'F-099 paper layout did not expose its system viewport.' }
  $systemViewportHandle = [string](Invoke-ComRetry { $templateViewports[0].Handle })
  foreach ($extraViewport in @($templateViewports | Select-Object -Skip 1)) { Invoke-ComRetry { $extraViewport.Delete() } | Out-Null }
  $first = Invoke-ComRetry { $scratch.PaperSpace.AddPViewport($firstCenter, 197.5, 277) }
  $second = Invoke-ComRetry { $scratch.PaperSpace.AddPViewport($secondCenter, 197.5, 277) }
  [double[]]$firstTarget = @(0, 0, 0); [double[]]$secondTarget = @(2000, 0, 0)
  Invoke-ComRetry {
    $first.Target = $firstTarget; $first.CustomScale = 0.16; $first.Display($true)
    $second.Target = $secondTarget; $second.CustomScale = 0.08; $second.Display($true)
  } | Out-Null
  $firstHandle = [string](Invoke-ComRetry { $first.Handle })
  $secondHandle = [string](Invoke-ComRetry { $second.Handle })
  [double[]]$boundaryCoordinates = @(212.5, 70.94, 255.95, 10, 366.55, 10, 410, 115.26, 386.3, 287, 236.2, 287)
  $boundary = Invoke-ComRetry { $scratch.PaperSpace.AddLightWeightPolyline($boundaryCoordinates) }
  Invoke-ComRetry { $boundary.Closed = $true } | Out-Null
  $boundaryHandle = [string](Invoke-ComRetry { $boundary.Handle })
  Send-AcadCommand $scratch "_.VPCLIP`n(handent `"$secondHandle`")`n(handent `"$boundaryHandle`")`n"
  Invoke-ComRetry { $scratch.MSpace = $false; $scratch.Regen(1) } | Out-Null
  $beforeSaveReadback = Get-StableViewportSnapshot $scratch 'F099 VIEWPORTS' $systemViewportHandle @($firstHandle,$secondHandle) @($boundaryHandle)
  $beforeSave = $beforeSaveReadback.snapshot

  Invoke-ComRetry { $scratch.SaveAs($tempDwg, 64) } | Out-Null
  Invoke-ComRetry { $scratch.Close($false) } | Out-Null
  $scratch = $null
  $dwgInfo = Get-Item -LiteralPath $tempDwg
  $dwgBytes = [long]$dwgInfo.Length
  $dwgSha256 = Get-Sha256 $tempDwg
  $reopened = Invoke-ComRetry { $acad.Documents.Open($tempDwg) }
  Invoke-ComRetry { $reopened.Activate() } | Out-Null
  Wait-AcadIdle $reopened
  $reopenedPaper = Invoke-ComRetry { $reopened.Layouts.Item('F099 VIEWPORTS') }
  Invoke-ComRetry { $reopened.ActiveLayout = $reopenedPaper; $reopened.ActiveSpace = 0; $reopened.MSpace = $false } | Out-Null
  $afterReopenReadback = Get-StableViewportSnapshot $reopened 'F099 VIEWPORTS' $systemViewportHandle @($firstHandle,$secondHandle) @($boundaryHandle)
  $afterReopen = $afterReopenReadback.snapshot
  $reopenedSecond = Invoke-ComRetry { $reopened.HandleToObject($secondHandle) }
  Invoke-ComRetry { $reopenedSecond.Display($true) } | Out-Null
  Send-AcadCommand $reopened "_.MSPACE`n"
  Send-AcadCommand $reopened "(progn (setvar `"CVPORT`" (cdr (assoc 69 (entget (handent `"$secondHandle`"))))) (princ))`n"
  $modelContextBeforeDelete = [ordered]@{
    mSpace = [bool](Invoke-ComRetry { $reopened.MSpace })
    cvport = [int](Invoke-ComRetry { $reopened.GetVariable('CVPORT') })
    activeHandle = [string](Invoke-ComRetry { $reopened.ActivePViewport.Handle })
  }
  Send-AcadCommand $reopened "_.PSPACE`n"
  Send-AcadCommand $reopened "(progn (command `"_.ERASE`" (handent `"$secondHandle`") `"`") (princ))`n"
  Invoke-ComRetry { $reopened.Regen(1) } | Out-Null
  Invoke-ComRetry { $reopened.Save() } | Out-Null
  Invoke-ComRetry { $reopened.Close($false) } | Out-Null
  $reopened = $null
  $reopened = Invoke-ComRetry { $acad.Documents.Open($tempDwg) }
  Invoke-ComRetry { $reopened.Activate() } | Out-Null
  Wait-AcadIdle $reopened
  $reopenedPaper = Invoke-ComRetry { $reopened.Layouts.Item('F099 VIEWPORTS') }
  Invoke-ComRetry { $reopened.ActiveLayout = $reopenedPaper; $reopened.ActiveSpace = 0; $reopened.MSpace = $false } | Out-Null
  $afterDeleteReadback = Get-StableViewportSnapshot $reopened 'F099 VIEWPORTS' $systemViewportHandle @($firstHandle) @()
  $afterDelete = $afterDeleteReadback.snapshot

  $beforeFirst = @($beforeSave.viewports | Where-Object { $_.handle -eq $firstHandle })[0]
  $beforeSecond = @($beforeSave.viewports | Where-Object { $_.handle -eq $secondHandle })[0]
  $reopenFirst = @($afterReopen.viewports | Where-Object { $_.handle -eq $firstHandle })[0]
  $reopenSecond = @($afterReopen.viewports | Where-Object { $_.handle -eq $secondHandle })[0]
  $deleteFirst = @($afterDelete.viewports | Where-Object { $_.handle -eq $firstHandle })[0]
  $checks = [ordered]@{
    nativePaperContext = $beforeSaveReadback.stable -and $afterReopenReadback.stable -and $afterDeleteReadback.stable -and $beforeSave.layoutName -eq 'F099 VIEWPORTS' -and $beforeSave.tileMode -eq 0 -and $beforeSave.cvport -eq 1 -and -not $beforeSave.mSpace
    twoNativeViewports = $beforeSave.viewportCount -eq 2 -and $beforeSave.viewportHandles -contains $firstHandle -and $beforeSave.viewportHandles -contains $secondHandle
    independentFrames = [Math]::Abs($reopenFirst.center.x - 108.75) -lt 0.001 -and [Math]::Abs($reopenSecond.center.x - 311.25) -lt 0.001 -and [Math]::Abs($reopenFirst.width - 197.5) -lt 0.001 -and [Math]::Abs($reopenSecond.width - 197.5) -lt 0.001 -and ($reopenFirst.center.x + $reopenFirst.width / 2) -lt ($reopenSecond.center.x - $reopenSecond.width / 2)
    independentViewStates = [Math]::Abs($reopenFirst.target.x - 0) -lt 0.001 -and [Math]::Abs($reopenSecond.target.x - 2000) -lt 0.001 -and [Math]::Abs($reopenFirst.customScale - 0.16) -lt 0.000001 -and [Math]::Abs($reopenSecond.customScale - 0.08) -lt 0.000001
    rectangleAndPolygonClip = -not $beforeFirst.clipped -and $beforeSecond.clipped -and $afterReopen.boundaryCount -ge 1 -and $afterReopen.boundaryHandles -contains $boundaryHandle
    viewportDisplayOn = $reopenFirst.viewportOn -and $reopenSecond.viewportOn
    nativeDwgReopen = $afterReopen.viewportCount -eq 2 -and $reopenFirst.handle -eq $firstHandle -and $reopenSecond.handle -eq $secondHandle -and -not $reopenFirst.clipped -and $reopenSecond.clipped
    statePersisted = $reopenFirst.handle -eq $firstHandle -and $reopenSecond.handle -eq $secondHandle -and [Math]::Abs($reopenFirst.height - 277) -lt 0.001 -and [Math]::Abs($reopenSecond.height - 277) -lt 0.001 -and -not $reopenFirst.clipped -and $reopenSecond.clipped
    modelContextActivated = $modelContextBeforeDelete.mSpace -and $modelContextBeforeDelete.cvport -gt 1 -and $modelContextBeforeDelete.activeHandle -eq $secondHandle
    deleteReturnsPaper = $afterDelete.viewportCount -eq 1 -and $afterDelete.viewportHandles[0] -eq $firstHandle -and -not $afterDelete.mSpace -and $afterDelete.cvport -eq 1
    remainingViewportUnaffected = [Math]::Abs($deleteFirst.center.x - $reopenFirst.center.x) -lt 0.001 -and [Math]::Abs($deleteFirst.target.x - $reopenFirst.target.x) -lt 0.001 -and [Math]::Abs($deleteFirst.customScale - $reopenFirst.customScale) -lt 0.000001
  }
  $status = if (@($checks.Values | Where-Object { $_ -ne $true }).Count -eq 0) { 'PASS' } else { 'FAIL' }
  $result = [ordered]@{
    schemaVersion = 1; rowId = 'F-099'; benchmark = 'AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation'
    engine = 'Autodesk AutoCAD 2024 desktop COM/native VPCLIP'; engineVersion = $engineVersion
    automationProcessId = $automationProcessId; automationProcessOwned = $owned
    handles = [ordered]@{ systemViewport = $systemViewportHandle; firstViewport = $firstHandle; secondViewport = $secondHandle; polygonBoundary = $boundaryHandle }
    beforeSave = $beforeSave; afterReopen = $afterReopen; modelContextBeforeDelete = $modelContextBeforeDelete; afterDelete = $afterDelete
    viewportReadback = [ordered]@{ beforeSave=$beforeSaveReadback; afterReopen=$afterReopenReadback; afterDelete=$afterDeleteReadback }
    checks = $checks
    dwg = [ordered]@{ bytes = $dwgBytes; sha256 = $dwgSha256; saveAsType = 64; retained = $false }
    status = $status
  }
} finally {
  if ($reopened) { try { Invoke-ComRetry { $reopened.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
  if ($scratch) { try { Invoke-ComRetry { $scratch.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
  if (Test-Path -LiteralPath $tempDwg) { Remove-Item -LiteralPath $tempDwg -Force }
}

if (-not $result) { throw 'F-099 AutoCAD matrix produced no result.' }
$result.userDocument = [ordered]@{ isolatedOwnedProcess = $owned; blankRestored = $owned }
$finalStatus = $result.status
$result | ConvertTo-Json -Depth 14
if ($finalStatus -ne 'PASS') { exit 1 }
