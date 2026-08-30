param(
  [Parameter(Mandatory = $true)][string]$PidPath,
  [Parameter(Mandatory = $true)][string]$OwnershipToken
)

$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class F019WindowProcess {
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

function Get-ComRequiredString {
  param([Parameter(Mandatory = $true)][scriptblock]$Action, [string]$Name)
  $readValue = $Action
  return [string](Invoke-ComRetry {
    $value = [string](& $readValue)
    if ([string]::IsNullOrWhiteSpace($value)) { throw "AutoCAD returned an empty $Name." }
    return $value
  })
}

function Wait-AcadIdle {
  param([Parameter(Mandatory = $true)]$Document, [int]$TimeoutSeconds = 30)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 100
    try {
      if ([string]::IsNullOrWhiteSpace([string]$Document.GetVariable('CMDNAMES')) -and
        [int]$Document.GetVariable('CMDACTIVE') -eq 0) { return }
    } catch {}
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'AutoCAD did not return to an idle command state.'
}

function Get-Bounds {
  param([Parameter(Mandatory = $true)]$Entity, [int]$TimeoutSeconds = 20)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $minimum = $null; $maximum = $null
    try {
      $Entity.GetBoundingBox([ref]$minimum, [ref]$maximum)
      if ($null -ne $minimum -and $null -ne $maximum -and $minimum.Count -ge 2 -and $maximum.Count -ge 2) {
        return [ordered]@{ min = @([double]$minimum[0], [double]$minimum[1]); max = @([double]$maximum[0], [double]$maximum[1]) }
      }
    } catch {
      if ([DateTime]::UtcNow -ge $deadline) { throw }
    }
    if ([DateTime]::UtcNow -ge $deadline) { throw 'AutoCAD returned an incomplete bounding box.' }
    Start-Sleep -Milliseconds 150
  } while ($true)
}

function Get-EntityState {
  param([Parameter(Mandatory = $true)]$Entity, [Parameter(Mandatory = $true)][string]$Family)
  $details = [ordered]@{}
  switch ($Family) {
    'circle' { $details.radius = [double](Invoke-ComRetry { $Entity.Radius }) }
    'arc' { $details.radius = [double](Invoke-ComRetry { $Entity.Radius }) }
    'text' { $details.height = [double](Invoke-ComRetry { $Entity.Height }) }
    'mtext' { $details.textHeight = [double](Invoke-ComRetry { $Entity.Height }) }
    'dimension' {
      $x1 = Invoke-ComRetry { $Entity.ExtLine1Point }
      $x2 = Invoke-ComRetry { $Entity.ExtLine2Point }
      $text = Invoke-ComRetry { $Entity.TextPosition }
      $details.extLine1Point = @([double]$x1[0], [double]$x1[1])
      $details.extLine2Point = @([double]$x2[0], [double]$x2[1])
      $details.textPosition = @([double]$text[0], [double]$text[1])
      $details.measurement = [double](Invoke-ComRetry { $Entity.Measurement })
    }
    'blockRef' {
      $details.xScale = [double](Invoke-ComRetry { $Entity.XScaleFactor })
      $details.yScale = [double](Invoke-ComRetry { $Entity.YScaleFactor })
    }
  }
  $objectName = Get-ComRequiredString { $Entity.ObjectName } 'ObjectName'
  $handle = Get-ComRequiredString { $Entity.Handle } 'Handle'
  $layer = Get-ComRequiredString { $Entity.Layer } 'Layer'
  $linetype = Get-ComRequiredString { $Entity.Linetype } 'Linetype'
  return [ordered]@{
    family = $Family
    objectName = $objectName
    handle = $handle
    layer = $layer
    color = [int](Invoke-ComRetry { $Entity.Color })
    linetype = $linetype
    lineweight = [int](Invoke-ComRetry { $Entity.Lineweight })
    bounds = Get-Bounds $Entity
    details = $details
  }
}

function Get-ScaledBounds {
  param($Bounds, [double]$BaseX, [double]$BaseY, [double]$Factor)
  return [ordered]@{
    min = @(($BaseX + (($Bounds.min[0] - $BaseX) * $Factor)), ($BaseY + (($Bounds.min[1] - $BaseY) * $Factor)))
    max = @(($BaseX + (($Bounds.max[0] - $BaseX) * $Factor)), ($BaseY + (($Bounds.max[1] - $BaseY) * $Factor)))
  }
}

function Test-Bounds {
  param($Actual, $Expected, [double]$Tolerance = 0.001)
  return [Math]::Abs($Actual.min[0] - $Expected.min[0]) -lt $Tolerance -and
    [Math]::Abs($Actual.min[1] - $Expected.min[1]) -lt $Tolerance -and
    [Math]::Abs($Actual.max[0] - $Expected.max[0]) -lt $Tolerance -and
    [Math]::Abs($Actual.max[1] - $Expected.max[1]) -lt $Tolerance
}

function Test-ScaledPoint {
  param($BeforePoint, $AfterPoint, [double]$BaseX, [double]$BaseY, [double]$Factor, [double]$Tolerance = 0.001)
  $expectedX = $BaseX + (($BeforePoint[0] - $BaseX) * $Factor)
  $expectedY = $BaseY + (($BeforePoint[1] - $BaseY) * $Factor)
  return [Math]::Abs($AfterPoint[0] - $expectedX) -lt $Tolerance -and [Math]::Abs($AfterPoint[1] - $expectedY) -lt $Tolerance
}

function Test-PointEqual {
  param($Actual, $Expected, [double]$Tolerance = 0.001)
  return [Math]::Abs($Actual[0] - $Expected[0]) -lt $Tolerance -and
    [Math]::Abs($Actual[1] - $Expected[1]) -lt $Tolerance
}

function Test-DimensionStateEqual {
  param($Actual, $Expected, [double]$Tolerance = 0.001)
  return (Test-PointEqual $Actual.details.extLine1Point $Expected.details.extLine1Point $Tolerance) -and
    (Test-PointEqual $Actual.details.extLine2Point $Expected.details.extLine2Point $Tolerance) -and
    (Test-PointEqual $Actual.details.textPosition $Expected.details.textPosition $Tolerance) -and
    [Math]::Abs($Actual.details.measurement - $Expected.details.measurement) -lt $Tolerance
}

function Test-ScaledEntity {
  param($Before, $After, [double]$BaseX, [double]$BaseY, [double]$Factor)
  if ($Before.family -eq 'dimension') {
    $dimensionLinePoint = $Before.details.dimensionLinePointInput
    if ($null -eq $dimensionLinePoint) { return $false }
    $scaledDimensionLinePoint = @(
      ($BaseX + (($dimensionLinePoint[0] - $BaseX) * $Factor))
      ($BaseY + (($dimensionLinePoint[1] - $BaseY) * $Factor))
    )
    $textGap = @(
      ($Before.details.textPosition[0] - $dimensionLinePoint[0])
      ($Before.details.textPosition[1] - $dimensionLinePoint[1])
    )
    $expectedTextPosition = @(
      ($scaledDimensionLinePoint[0] + $textGap[0])
      ($scaledDimensionLinePoint[1] + $textGap[1])
    )
    return (Test-ScaledPoint $Before.details.extLine1Point $After.details.extLine1Point $BaseX $BaseY $Factor) -and
      (Test-ScaledPoint $Before.details.extLine2Point $After.details.extLine2Point $BaseX $BaseY $Factor) -and
      (Test-PointEqual $After.details.textPosition $expectedTextPosition) -and
      [Math]::Abs($After.details.measurement - ($Before.details.measurement * $Factor)) -lt 0.001
  }
  return Test-Bounds $After.bounds (Get-ScaledBounds $Before.bounds $BaseX $BaseY $Factor)
}

function Test-Properties {
  param($Before, $After, [bool]$SameHandle = $true)
  return ((-not $SameHandle) -or $Before.handle -eq $After.handle) -and
    $Before.objectName -eq $After.objectName -and $Before.layer -eq $After.layer -and
    $Before.color -eq $After.color -and $Before.linetype -eq $After.linetype -and
    $Before.lineweight -eq $After.lineweight
}

function Get-LayerEntities {
  param($Document, [string]$Layer)
  $items = @()
  foreach ($entity in $Document.ModelSpace) {
    if ([string]$entity.Layer -eq $Layer) { $items += $entity }
  }
  return @($items)
}

function New-Line {
  param($Document, [string]$Layer, [double]$StartX, [double]$StartY, [double]$EndX, [double]$EndY)
  [double[]]$a = @($StartX, $StartY, 0); [double[]]$b = @($EndX, $EndY, 0)
  $line = Invoke-ComRetry { $Document.ModelSpace.AddLine($a, $b) }
  Invoke-ComRetry { $line.Layer = $Layer } | Out-Null
  return $line
}

function Invoke-ScaleHandle {
  param($Document, [string]$Handle, [string]$Base, [string]$ScaleInput, [string]$ReferenceInput = '', [bool]$Copy = $false)
  $options = if ($Copy) { "_Copy`n" } else { '' }
  if ($ReferenceInput) { $options += "_Reference`n$ReferenceInput`n" }
  $script = "(setq f019:one (ssadd))`n(ssadd (handent `"$Handle`") f019:one)`n_.SCALE`n!f019:one`n`n$Base`n$options$ScaleInput`n"
  Invoke-ComRetry { $Document.SendCommand($script) } | Out-Null
  Wait-AcadIdle $Document
}

function Invoke-RefusedScale {
  param($Document, [string]$Handle, [string]$PromptInput)
  $script = "(setq f019:bad (ssadd))`n(ssadd (handent `"$Handle`") f019:bad)`n_.SCALE`n!f019:bad`n`n0,0`n$PromptInput`n"
  $windowHandle = [int64](Invoke-ComRetry { $Document.Application.HWND })
  [uint32]$targetProcessId = 0
  [void][F019WindowProcess]::GetWindowThreadProcessId([IntPtr]$windowHandle, [ref]$targetProcessId)
  if ($targetProcessId -le 0) { throw 'Could not resolve the isolated F-019 AutoCAD process.' }
  $helperPath = Join-Path $PSScriptRoot 'send-escape.ps1'
  $cancelProcess = Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -PassThru -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $helperPath,
    '-TargetProcessId', [string]$targetProcessId, '-DelayMs', '900'
  )
  $timer = [Diagnostics.Stopwatch]::StartNew()
  Invoke-ComRetry { $Document.SendCommand($script) } | Out-Null
  $timer.Stop()
  if (-not $cancelProcess.WaitForExit(5000)) { Stop-Process -Id $cancelProcess.Id -Force; throw 'F-019 cancel helper did not finish.' }
  $cancelExitCode = [int]$cancelProcess.ExitCode
  Wait-AcadIdle $Document
  $elapsedMs = [int]$timer.ElapsedMilliseconds
  return [ordered]@{
    cancelHelperExitCode = $cancelExitCode
    cancelTargetProcessId = [int]$targetProcessId
    sendCommandBlockedMs = $elapsedMs
    invalidPromptRemainedActive = $elapsedMs -ge 700
    idleAfterCancel = [string]::IsNullOrWhiteSpace([string](Invoke-ComRetry { $Document.GetVariable('CMDNAMES') })) -and [int](Invoke-ComRetry { $Document.GetVariable('CMDACTIVE') }) -eq 0
  }
}

$preExistingAcadProcessIds = @(Get-Process -Name 'acad' -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.Id })
$acad = $null; $scratch = $null; $reusedBlank = $false; $result = $null
$automationProcessId = 0; $automationProcessOwned = $false
try {
  # Creating the COM server is deliberately single-shot. Retrying New-Object can
  # launch several orphan acad.exe processes when the COM registration is slow.
  $acad = New-Object -ComObject AutoCAD.Application.24.3
  $automationWindowHandle = [int64](Invoke-ComRetry { $acad.HWND })
  [uint32]$resolvedAutomationProcessId = 0
  [void][F019WindowProcess]::GetWindowThreadProcessId([IntPtr]$automationWindowHandle, [ref]$resolvedAutomationProcessId)
  $automationProcessId = [int]$resolvedAutomationProcessId
  if ($automationProcessId -le 0) { throw 'Could not resolve the F-019 AutoCAD automation process.' }
  $automationProcessOwned = $preExistingAcadProcessIds -notcontains $automationProcessId
  Write-Host "[F-019] automation-process pid=$automationProcessId owned=$automationProcessOwned"
  if (-not $automationProcessOwned) {
    throw "F-019 refuses to use pre-existing AutoCAD process $automationProcessId."
  }
  [ordered]@{ schemaVersion = 1; processId = $automationProcessId; owned = $true; token = $OwnershipToken } | ConvertTo-Json -Compress | Set-Content -LiteralPath $PidPath -Encoding ascii
  Invoke-ComRetry { $acad.Visible = $true } | Out-Null
  $initialCount = [int](Invoke-ComRetry { $acad.Documents.Count })
  if ($initialCount -gt 0) {
    $candidate = Invoke-ComRetry { $acad.ActiveDocument }
    $candidateName = [string](Invoke-ComRetry { $candidate.Name })
    $candidateFullName = [string](Invoke-ComRetry { $candidate.FullName })
    $candidateSaved = [bool](Invoke-ComRetry { $candidate.Saved })
    $candidateEntityCount = [int](Invoke-ComRetry { $candidate.ModelSpace.Count })
    if ($candidateFullName -or -not $candidateSaved -or $candidateEntityCount -ne 0) {
      throw "F-019 standard matrix refuses to run beside active user drawing '$candidateName'."
    }
    $scratch = $candidate; $reusedBlank = $true
  } else {
    $scratch = Invoke-ComRetry { $acad.Documents.Add() }
  }
  Invoke-ComRetry { $scratch.Activate() } | Out-Null
  Wait-AcadIdle $scratch

  foreach ($name in @('F019_MATRIX', 'F019_AUX', 'F019_STANDARD', 'F019_POINT', 'F019_REFERENCE', 'F019_POINTS', 'F019_NOOP', 'F019_NOOP_SENTINEL', 'F019_ZERO', 'F019_NEGATIVE', 'F019_COINCIDENT', 'F019_EDIT', 'F019_LOCKED')) {
    $null = Invoke-ComRetry { $scratch.Layers.Add($name) }
  }
  $lockedLayer = Invoke-ComRetry { $scratch.Layers.Item('F019_LOCKED') }
  $entities = [ordered]@{}

  [double[]]$p0 = @(0, 0, 0); [double[]]$p50 = @(50, 0, 0)
  $entities.line = Invoke-ComRetry { $scratch.ModelSpace.AddLine($p0, $p50) }
  [double[]]$polyPoints = @(100, 0, 150, 25, 200, 0)
  $entities.polyline = Invoke-ComRetry { $scratch.ModelSpace.AddLightWeightPolyline($polyPoints) }
  [double[]]$circleCenter = @(300, 0, 0)
  $entities.circle = Invoke-ComRetry { $scratch.ModelSpace.AddCircle($circleCenter, 25) }
  [double[]]$arcCenter = @(500, 0, 0)
  $entities.arc = Invoke-ComRetry { $scratch.ModelSpace.AddArc($arcCenter, 30, 0, ([Math]::PI / 2)) }
  [double[]]$ellipseCenter = @(700, 0, 0); [double[]]$ellipseAxis = @(50, 10, 0)
  $entities.ellipse = Invoke-ComRetry { $scratch.ModelSpace.AddEllipse($ellipseCenter, $ellipseAxis, 0.5) }
  [double[]]$fitPoints = @(900, 0, 0, 950, 75, 0, 1000, 0, 0)
  [double[]]$startTangent = @(50, 75, 0); [double[]]$endTangent = @(50, -75, 0)
  $entities.spline = Invoke-ComRetry { $scratch.ModelSpace.AddSpline($fitPoints, $startTangent, $endTangent) }
  [double[]]$textPoint = @(1100, 0, 0)
  $entities.text = Invoke-ComRetry { $scratch.ModelSpace.AddText('F019 TEXT', $textPoint, 20) }
  [double[]]$mtextPoint = @(1250, 0, 0)
  $entities.mtext = Invoke-ComRetry { $scratch.ModelSpace.AddMText($mtextPoint, 200, 'F019 MTEXT') }
  [double[]]$leaderPoints = @(1400, 0, 0, 1450, 50, 0, 1500, 50, 0)
  [double[]]$leaderAnnotationPoint = @(1500, 50, 0)
  $leaderAnnotation = Invoke-ComRetry { $scratch.ModelSpace.AddMText($leaderAnnotationPoint, 100, 'F019 LEADER') }
  Invoke-ComRetry { $leaderAnnotation.Layer = 'F019_AUX' } | Out-Null
  $entities.leader = Invoke-ComRetry { $scratch.ModelSpace.AddLeader($leaderPoints, $leaderAnnotation, 0) }
  [double[]]$dimA = @(1550, 0, 0); [double[]]$dimB = @(1650, 0, 0); [double[]]$dimText = @(1600, 50, 0)
  $entities.dimension = Invoke-ComRetry { $scratch.ModelSpace.AddDimAligned($dimA, $dimB, $dimText) }

  [double[]]$hatchBoundaryPoints = @(1700, 0, 1800, 0, 1800, 100, 1700, 100)
  $hatchBoundary = Invoke-ComRetry { $scratch.ModelSpace.AddLightWeightPolyline($hatchBoundaryPoints) }
  Invoke-ComRetry { $hatchBoundary.Closed = $true } | Out-Null
  Invoke-ComRetry { $hatchBoundary.Layer = 'F019_AUX' } | Out-Null
  $boundaryHandle = [string](Invoke-ComRetry { $hatchBoundary.Handle })
  $hatchLisp = "(progn (vl-load-com) (setq f019:ms (vla-get-ModelSpace (vla-get-ActiveDocument (vlax-get-acad-object)))) (setq f019:h (vla-AddHatch f019:ms 0 `"SOLID`" :vlax-false 0)) (setq f019:loop (vlax-make-safearray vlax-vbObject '(0 . 0))) (vlax-safearray-put-element f019:loop 0 (vlax-ename->vla-object (handent `"$boundaryHandle`"))) (vla-AppendOuterLoop f019:h f019:loop) (vla-Evaluate f019:h) (vla-put-Layer f019:h `"F019_MATRIX`") (setvar `"USERS1`" (vla-get-Handle f019:h)) (princ))`n"
  Invoke-ComRetry { $scratch.SendCommand($hatchLisp) } | Out-Null
  Wait-AcadIdle $scratch
  $hatchHandle = [string](Invoke-ComRetry { $scratch.GetVariable('USERS1') })
  $entities.hatch = Invoke-ComRetry { $scratch.HandleToObject($hatchHandle) }

  $blockLisp = "(progn (vl-load-com) (setq f019:doc (vla-get-ActiveDocument (vlax-get-acad-object))) (setq f019:block (vla-Add (vla-get-Blocks f019:doc) (vlax-3d-point '(0.0 0.0 0.0)) `"F019_BLOCK`")) (vla-AddLine f019:block (vlax-3d-point '(0.0 0.0 0.0)) (vlax-3d-point '(100.0 0.0 0.0))) (setq f019:insert (vla-InsertBlock (vla-get-ModelSpace f019:doc) (vlax-3d-point '(1900.0 0.0 0.0)) `"F019_BLOCK`" 1.5 0.5 1.0 0.25)) (vla-put-Layer f019:insert `"F019_MATRIX`") (setvar `"USERS2`" (vla-get-Handle f019:insert)) (princ))`n"
  Invoke-ComRetry { $scratch.SendCommand($blockLisp) } | Out-Null
  Wait-AcadIdle $scratch
  $blockHandle = [string](Invoke-ComRetry { $scratch.GetVariable('USERS2') })
  $entities.blockRef = Invoke-ComRetry { $scratch.HandleToObject($blockHandle) }

  foreach ($entity in $entities.Values) {
    Invoke-ComRetry { $entity.Layer = 'F019_MATRIX' } | Out-Null
    Invoke-ComRetry { $entity.Color = 1 } | Out-Null
    Invoke-ComRetry { $entity.Linetype = 'Continuous' } | Out-Null
    Invoke-ComRetry { $entity.Lineweight = 50 } | Out-Null
  }
  Invoke-ComRetry { $scratch.Regen(1) } | Out-Null
  Wait-AcadIdle $scratch
  $before = @($entities.GetEnumerator() | ForEach-Object { Get-EntityState $_.Value $_.Key })
  $dimensionBefore = @($before | Where-Object { $_.family -eq 'dimension' })[0]
  $dimensionBefore.details.dimensionLinePointInput = @([double]$dimText[0], [double]$dimText[1])
  $sourceHandles = @($before | ForEach-Object { $_.handle })

  $scale = "(setq f019:ss (ssget `"_X`" '((8 . `"F019_MATRIX`"))))`n_.SCALE`n!f019:ss`n`n100,200`n_Reference`n100,200`n1100,200`n2000`n"
  Invoke-ComRetry { $scratch.SendCommand($scale) } | Out-Null
  Wait-AcadIdle $scratch
  Write-Host '[F-019] primary reference scale idle'
  $after = @(); $checks = @()
  foreach ($prior in $before) {
    Write-Host "[F-019] read scaled $($prior.family) $($prior.handle)"
    $state = Get-EntityState (Invoke-ComRetry { $scratch.HandleToObject($prior.handle) }) $prior.family
    $after += $state
    $checks += [ordered]@{
      family = $prior.family
      sameHandle = $state.handle -eq $prior.handle
      scaledBounds = Test-ScaledEntity $prior $state 100 200 2
      propertiesPreserved = Test-Properties $prior $state
    }
  }

  Invoke-ComRetry { $scratch.SendCommand("_.U`n") } | Out-Null
  Wait-AcadIdle $scratch
  Write-Host '[F-019] primary undo idle'
  $afterUndo = @()
  foreach ($prior in $before) {
    $state = Get-EntityState (Invoke-ComRetry { $scratch.HandleToObject($prior.handle) }) $prior.family
    $afterUndo += $state
    $check = @($checks | Where-Object { $_.family -eq $prior.family })[0]
    $geometryRestored = if ($prior.family -eq 'dimension') {
      Test-DimensionStateEqual $state $prior
    } else {
      Test-Bounds $state.bounds $prior.bounds
    }
    $check.undoRestored = $geometryRestored -and (Test-Properties $prior $state)
  }

  $copyScript = "(setq f019:copy (ssget `"_X`" '((8 . `"F019_MATRIX`"))))`n_.SCALE`n!f019:copy`n`n100,200`n_Copy`n_Reference`n100,200`n1100,200`n2000`n"
  Invoke-ComRetry { $scratch.SendCommand($copyScript) } | Out-Null
  Wait-AcadIdle $scratch
  Write-Host '[F-019] copy scale idle'
  $copyEntities = @(Get-LayerEntities $scratch 'F019_MATRIX')
  $copyChecks = @(); $copyStates = @()
  foreach ($prior in $before) {
    $candidate = @($copyEntities | Where-Object {
      ([string]$_.ObjectName -eq $prior.objectName) -and ($sourceHandles -notcontains [string]$_.Handle)
    })[0]
    if ($null -eq $candidate) {
      $copyChecks += [ordered]@{ family = $prior.family; found = $false; scaledBounds = $false; freshHandle = $false; propertiesPreserved = $false }
      continue
    }
    $state = Get-EntityState $candidate $prior.family
    $copyStates += $state
    $copyChecks += [ordered]@{
      family = $prior.family
      found = $true
      scaledBounds = Test-ScaledEntity $prior $state 100 200 2
      freshHandle = $state.handle -ne $prior.handle
      propertiesPreserved = Test-Properties $prior $state $false
    }
  }
  Invoke-ComRetry { $scratch.SendCommand("_.U`n") } | Out-Null
  Wait-AcadIdle $scratch
  Write-Host '[F-019] copy undo idle'
  $copyUndoCount = @(Get-LayerEntities $scratch 'F019_MATRIX').Count

  $standardLine = New-Line $scratch 'F019_STANDARD' 1000 0 2000 0
  $standardBefore = Get-EntityState $standardLine 'standardNumeric'
  Invoke-ScaleHandle $scratch $standardBefore.handle '0,0' '2'
  Write-Host '[F-019] numeric factor idle'
  $standardAfter = Get-EntityState (Invoke-ComRetry { $scratch.HandleToObject($standardBefore.handle) }) 'standardNumeric'
  $standardPassed = Test-Bounds $standardAfter.bounds (Get-ScaledBounds $standardBefore.bounds 0 0 2)

  $pointLine = New-Line $scratch 'F019_POINT' 1000 0 2000 0
  $pointBefore = Get-EntityState $pointLine 'factorPoint'
  Invoke-ScaleHandle $scratch $pointBefore.handle '0,0' '2,0'
  Write-Host '[F-019] point factor idle'
  $pointAfter = Get-EntityState (Invoke-ComRetry { $scratch.HandleToObject($pointBefore.handle) }) 'factorPoint'
  $pointObservedFactor = ($pointAfter.bounds.max[0] - $pointAfter.bounds.min[0]) / ($pointBefore.bounds.max[0] - $pointBefore.bounds.min[0])
  $pointProbeObserved = $pointObservedFactor -gt 0 -and [Math]::Abs($pointObservedFactor - 2) -gt 0.001

  $referenceLine = New-Line $scratch 'F019_REFERENCE' 1000 0 2000 0
  $referenceBefore = Get-EntityState $referenceLine 'numericReferencePointTarget'
  Invoke-ScaleHandle $scratch $referenceBefore.handle '0,0' '2000,0' '1000'
  Write-Host '[F-019] numeric reference and point target idle'
  $referenceAfter = Get-EntityState (Invoke-ComRetry { $scratch.HandleToObject($referenceBefore.handle) }) 'numericReferencePointTarget'
  $referencePassed = Test-Bounds $referenceAfter.bounds (Get-ScaledBounds $referenceBefore.bounds 0 0 2)

  $pointsLine = New-Line $scratch 'F019_POINTS' 1000 0 2000 0
  $pointsBefore = Get-EntityState $pointsLine 'twoPointReferenceAndNewLength'
  Invoke-ScaleHandle $scratch $pointsBefore.handle '0,0' "_Points`n3000,2000`n3000,4000" "0,0`n1000,0"
  Write-Host '[F-019] two-point reference and new length idle'
  $pointsAfter = Get-EntityState (Invoke-ComRetry { $scratch.HandleToObject($pointsBefore.handle) }) 'twoPointReferenceAndNewLength'
  $pointsPassed = Test-Bounds $pointsAfter.bounds (Get-ScaledBounds $pointsBefore.bounds 0 0 2)

  $noOpLine = New-Line $scratch 'F019_NOOP' 1000 0 2000 0
  $noOpBefore = Get-EntityState $noOpLine 'factorOne'
  $noOpSentinel = New-Line $scratch 'F019_NOOP_SENTINEL' 0 3000 100 3000
  $noOpSentinelBefore = Get-EntityState $noOpSentinel 'factorOneUndoSentinel'
  $noOpSentinelHandle = $noOpSentinelBefore.handle
  $sentinelMove = "(setq f019:sentinel (ssadd))`n(ssadd (handent `"$noOpSentinelHandle`") f019:sentinel)`n_.MOVE`n!f019:sentinel`n`n0,0`n100,0`n"
  Invoke-ComRetry { $scratch.SendCommand($sentinelMove) } | Out-Null
  Wait-AcadIdle $scratch
  $noOpSentinelMoved = Get-EntityState (Invoke-ComRetry { $scratch.HandleToObject($noOpSentinelHandle) }) 'factorOneUndoSentinel'
  Invoke-ScaleHandle $scratch $noOpBefore.handle '0,0' '1'
  Write-Host '[F-019] factor-one idle'
  $noOpAfter = Get-EntityState (Invoke-ComRetry { $scratch.HandleToObject($noOpBefore.handle) }) 'factorOne'
  Invoke-ComRetry { $scratch.SendCommand("_.U`n") } | Out-Null
  Wait-AcadIdle $scratch
  $noOpAfterOneUndo = Get-EntityState (Invoke-ComRetry { $scratch.HandleToObject($noOpBefore.handle) }) 'factorOne'
  $noOpSentinelAfterOneUndo = Get-EntityState (Invoke-ComRetry { $scratch.HandleToObject($noOpSentinelHandle) }) 'factorOneUndoSentinel'
  $factorOneCreatesUndoEntry = Test-Bounds $noOpSentinelAfterOneUndo.bounds $noOpSentinelMoved.bounds
  $factorOneIsRevisionFree = Test-Bounds $noOpSentinelAfterOneUndo.bounds $noOpSentinelBefore.bounds
  $undoBehaviorObserved = $factorOneCreatesUndoEntry -xor $factorOneIsRevisionFree
  $noOpPassed = (Test-Bounds $noOpAfter.bounds $noOpBefore.bounds) -and
    (Test-Bounds $noOpAfterOneUndo.bounds $noOpBefore.bounds) -and
    (Test-Properties $noOpBefore $noOpAfter) -and (Test-Properties $noOpBefore $noOpAfterOneUndo) -and
    $undoBehaviorObserved

  $zeroLine = New-Line $scratch 'F019_ZERO' 1000 0 2000 0
  $zeroBefore = Get-EntityState $zeroLine 'zeroRefused'
  $zeroCommandResult = Invoke-RefusedScale $scratch $zeroBefore.handle '0'
  Write-Host '[F-019] zero refusal and recovery idle'
  $zeroAfter = Get-EntityState (Invoke-ComRetry { $scratch.HandleToObject($zeroBefore.handle) }) 'zeroRefused'
  $zeroPassed = $zeroCommandResult.cancelHelperExitCode -eq 0 -and $zeroCommandResult.invalidPromptRemainedActive -and $zeroCommandResult.idleAfterCancel -and (Test-Bounds $zeroAfter.bounds $zeroBefore.bounds) -and (Test-Properties $zeroBefore $zeroAfter)

  $negativeLine = New-Line $scratch 'F019_NEGATIVE' 1000 0 2000 0
  $negativeBefore = Get-EntityState $negativeLine 'negativeRefused'
  $negativeCommandResult = Invoke-RefusedScale $scratch $negativeBefore.handle '-2'
  Write-Host '[F-019] negative refusal and recovery idle'
  $negativeAfter = Get-EntityState (Invoke-ComRetry { $scratch.HandleToObject($negativeBefore.handle) }) 'negativeRefused'
  $negativePassed = $negativeCommandResult.cancelHelperExitCode -eq 0 -and $negativeCommandResult.invalidPromptRemainedActive -and $negativeCommandResult.idleAfterCancel -and (Test-Bounds $negativeAfter.bounds $negativeBefore.bounds) -and (Test-Properties $negativeBefore $negativeAfter)

  $coincidentLine = New-Line $scratch 'F019_COINCIDENT' 1000 0 2000 0
  $coincidentBefore = Get-EntityState $coincidentLine 'coincidentRefused'
  $coincidentCommandResult = Invoke-RefusedScale $scratch $coincidentBefore.handle "_Reference`n0,0`n0,0`n1"
  Write-Host '[F-019] coincident reference refusal and recovery idle'
  $coincidentAfter = Get-EntityState (Invoke-ComRetry { $scratch.HandleToObject($coincidentBefore.handle) }) 'coincidentRefused'
  $coincidentPassed = $coincidentCommandResult.cancelHelperExitCode -eq 0 -and $coincidentCommandResult.invalidPromptRemainedActive -and $coincidentCommandResult.idleAfterCancel -and (Test-Bounds $coincidentAfter.bounds $coincidentBefore.bounds) -and (Test-Properties $coincidentBefore $coincidentAfter)

  $editable = New-Line $scratch 'F019_EDIT' 0 2500 1000 2500
  $locked = New-Line $scratch 'F019_LOCKED' 0 2700 1000 2700
  Invoke-ComRetry { $lockedLayer.Lock = $true } | Out-Null
  $editableBefore = Get-EntityState $editable 'editable'
  $lockedBefore = Get-EntityState $locked 'locked'
  $editableHandle = $editableBefore.handle; $lockedHandle = $lockedBefore.handle
  $mixedScale = "(setq f019:mixed (ssadd))`n(ssadd (handent `"$editableHandle`") f019:mixed)`n(ssadd (handent `"$lockedHandle`") f019:mixed)`n_.SCALE`n!f019:mixed`n`n0,0`n2`n"
  Invoke-ComRetry { $scratch.SendCommand($mixedScale) } | Out-Null
  Wait-AcadIdle $scratch
  Write-Host '[F-019] mixed locked selection idle'
  $editableAfter = Get-EntityState (Invoke-ComRetry { $scratch.HandleToObject($editableHandle) }) 'editable'
  $lockedAfter = Get-EntityState (Invoke-ComRetry { $scratch.HandleToObject($lockedHandle) }) 'locked'
  $mixedPassed = (Test-Bounds $editableAfter.bounds (Get-ScaledBounds $editableBefore.bounds 0 0 2)) -and
    (Test-Bounds $lockedAfter.bounds $lockedBefore.bounds) -and (Test-Properties $lockedBefore $lockedAfter)

  $failed = @($checks | Where-Object { -not $_.sameHandle -or -not $_.scaledBounds -or -not $_.propertiesPreserved -or -not $_.undoRestored })
  $copyFailed = @($copyChecks | Where-Object { -not $_.found -or -not $_.scaledBounds -or -not $_.freshHandle -or -not $_.propertiesPreserved })
  $matrixPassed = $checks.Count -eq 12 -and $failed.Count -eq 0
  $copyPassed = $copyEntities.Count -eq 24 -and $copyChecks.Count -eq 12 -and $copyFailed.Count -eq 0 -and $copyUndoCount -eq 12
  $inputModesPassed = $standardPassed -and $referencePassed -and $pointsPassed -and $noOpPassed -and $zeroPassed -and $negativePassed -and $coincidentPassed
  Write-Host "[F-019] input results numeric=$standardPassed referencePoint=$referencePassed points=$pointsPassed noop=$noOpPassed zero=$zeroPassed negative=$negativePassed coincident=$coincidentPassed"
  $result = [ordered]@{
    schemaVersion = 1
    rowId = 'F-019'
    benchmark = 'AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation'
    engine = 'Autodesk AutoCAD 2024 desktop COM'
    engineVersion = [string](Invoke-ComRetry { $acad.Version })
    automationProcessId = $automationProcessId
    automationProcessOwned = $automationProcessOwned
    workflow = '12 native entity families; SCALE base 100,200, two-point Reference 1000 to 2000; U; Copy/U; factor/point/Points/no-op plus undo sentinel/refused inputs; mixed locked layer'
    referenceLength = 1000
    newLength = 2000
    factor = 2
    before = $before
    after = $after
    afterUndo = $afterUndo
    checks = $checks
    copy = [ordered]@{ states = $copyStates; checks = $copyChecks; entityCount = $copyEntities.Count; undoCount = $copyUndoCount; passed = $copyPassed }
    inputModes = [ordered]@{
      standardNumeric = [ordered]@{ before = $standardBefore; after = $standardAfter; passed = $standardPassed }
      dynamicDragPointProbe = [ordered]@{ before = $pointBefore; after = $pointAfter; observedFactor = $pointObservedFactor; observed = $pointProbeObserved; certificationAuthority = $false }
      numericReferencePointTarget = [ordered]@{ before = $referenceBefore; after = $referenceAfter; passed = $referencePassed }
      twoPointReferenceAndNewLength = [ordered]@{ before = $pointsBefore; after = $pointsAfter; passed = $pointsPassed }
      factorOneNoOp = [ordered]@{
        before = $noOpBefore
        after = $noOpAfter
        afterOneUndo = $noOpAfterOneUndo
        undoSentinelBefore = $noOpSentinelBefore
        undoSentinelMoved = $noOpSentinelMoved
        undoSentinelAfterOneUndo = $noOpSentinelAfterOneUndo
        createsUndoEntry = $factorOneCreatesUndoEntry
        revisionFree = $factorOneIsRevisionFree
        undoBehaviorObserved = $undoBehaviorObserved
        passed = $noOpPassed
      }
      zeroRefused = [ordered]@{ before = $zeroBefore; after = $zeroAfter; commandResult = $zeroCommandResult; passed = $zeroPassed }
      negativeRefused = [ordered]@{ before = $negativeBefore; after = $negativeAfter; commandResult = $negativeCommandResult; passed = $negativePassed }
      coincidentReferenceRefused = [ordered]@{ before = $coincidentBefore; after = $coincidentAfter; commandResult = $coincidentCommandResult; passed = $coincidentPassed }
      passed = $inputModesPassed
    }
    mixedLocked = [ordered]@{ editableBefore = $editableBefore; editableAfter = $editableAfter; lockedBefore = $lockedBefore; lockedAfter = $lockedAfter; passed = $mixedPassed }
    gate = [ordered]@{ checkCount = $checks.Count; failedCount = $failed.Count; failed = $failed; copyFailedCount = $copyFailed.Count; copyFailed = $copyFailed; matrixPassed = $matrixPassed; copyPassed = $copyPassed; inputModesPassed = $inputModesPassed; mixedLockedPassed = $mixedPassed }
    cmdNamesAfter = [string](Invoke-ComRetry { $scratch.GetVariable('CMDNAMES') })
    status = if ($matrixPassed -and $copyPassed -and $inputModesPassed -and $mixedPassed) { 'PASS' } else { 'FAIL' }
  }
} finally {
  if ($scratch) { try { Invoke-ComRetry { $scratch.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
}

if (-not $result) { throw 'F-019 standard AutoCAD matrix produced no result.' }
$openDocumentsAfter = [int](Invoke-ComRetry { $acad.Documents.Count })
$activeNameAfter = ''; $activeFullNameAfter = ''; $activeSavedAfter = $true; $activeEntityCountAfter = 0
$ownedDocumentsClean = $true
foreach ($ownedDocument in $acad.Documents) {
  $ownedFullName = [string](Invoke-ComRetry { $ownedDocument.FullName })
  $ownedSaved = [bool](Invoke-ComRetry { $ownedDocument.Saved })
  $ownedEntityCount = [int](Invoke-ComRetry { $ownedDocument.ModelSpace.Count })
  if (-not [string]::IsNullOrWhiteSpace($ownedFullName) -or -not $ownedSaved -or $ownedEntityCount -ne 0) {
    $ownedDocumentsClean = $false
  }
}
if ($openDocumentsAfter -gt 0) {
  $activeNameAfter = [string](Invoke-ComRetry { $acad.ActiveDocument.Name })
  $activeFullNameAfter = [string](Invoke-ComRetry { $acad.ActiveDocument.FullName })
  $activeSavedAfter = [bool](Invoke-ComRetry { $acad.ActiveDocument.Saved })
  $activeEntityCountAfter = [int](Invoke-ComRetry { $acad.ActiveDocument.ModelSpace.Count })
}
$blankRestored = $automationProcessOwned -and $ownedDocumentsClean
$result.userDocument = [ordered]@{
  reusedBlank = $reusedBlank
  isolatedOwnedProcess = $automationProcessOwned
  openDocumentsAfter = $openDocumentsAfter
  activeNameAfter = $activeNameAfter
  activeFullNameAfter = $activeFullNameAfter
  activeSavedAfter = $activeSavedAfter
  activeEntityCountAfter = $activeEntityCountAfter
  ownedDocumentsClean = $ownedDocumentsClean
  blankRestored = $blankRestored
}
if (-not $blankRestored) { $result.status = 'FAIL' }
$finalStatus = $result.status
$result | ConvertTo-Json -Depth 12
if ($finalStatus -ne 'PASS') { exit 1 }
