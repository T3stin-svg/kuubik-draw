$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class F018WindowProcess {
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

function Get-EntityByHandle {
  param(
    [Parameter(Mandatory = $true)]$Document,
    [Parameter(Mandatory = $true)][string]$Handle,
    [int]$TimeoutSeconds = 20
  )
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    try {
      $entity = $Document.HandleToObject($Handle)
      if ($entity -and [string]$entity.Handle -eq $Handle) { return $entity }
    } catch {}
    try {
      foreach ($candidate in $Document.ModelSpace) {
        if ([string]$candidate.Handle -eq $Handle) { return $candidate }
      }
    } catch {}
    if ([DateTime]::UtcNow -ge $deadline) { throw "AutoCAD could not resolve model-space handle $Handle." }
    Start-Sleep -Milliseconds 150
  } while ($true)
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
  param([Parameter(Mandatory = $true)]$Entity)
  $minimum = $null; $maximum = $null
  Invoke-ComRetry { $Entity.GetBoundingBox([ref]$minimum, [ref]$maximum) } | Out-Null
  return [ordered]@{ min = @([double]$minimum[0], [double]$minimum[1]); max = @([double]$maximum[0], [double]$maximum[1]) }
}

function Get-EntityState {
  param([Parameter(Mandatory = $true)]$Entity, [Parameter(Mandatory = $true)][string]$Family)
  return [ordered]@{
    family = $Family
    objectName = [string](Invoke-ComRetry { $Entity.ObjectName })
    handle = Invoke-NonEmptyCom { $Entity.Handle } "$Family handle"
    layer = [string](Invoke-ComRetry { $Entity.Layer })
    color = [int](Invoke-ComRetry { $Entity.Color })
    linetype = [string](Invoke-ComRetry { $Entity.Linetype })
    lineweight = [int](Invoke-ComRetry { $Entity.Lineweight })
    bounds = Get-Bounds $Entity
  }
}

function Rotate-Point {
  param([double]$X, [double]$Y, [double]$BaseX, [double]$BaseY, [double]$AngleDeg)
  $angle = $AngleDeg * [Math]::PI / 180.0
  $dx = $X - $BaseX; $dy = $Y - $BaseY
  $rx = $BaseX + $dx * [Math]::Cos($angle) - $dy * [Math]::Sin($angle)
  $ry = $BaseY + $dx * [Math]::Sin($angle) + $dy * [Math]::Cos($angle)
  return [pscustomobject]@{ x = $rx; y = $ry }
}

function Get-RotatedBounds {
  param($Bounds, [double]$BaseX, [double]$BaseY, [double]$AngleDeg)
  $points = @(
    (Rotate-Point -X $Bounds.min[0] -Y $Bounds.min[1] -BaseX $BaseX -BaseY $BaseY -AngleDeg $AngleDeg)
    (Rotate-Point -X $Bounds.min[0] -Y $Bounds.max[1] -BaseX $BaseX -BaseY $BaseY -AngleDeg $AngleDeg)
    (Rotate-Point -X $Bounds.max[0] -Y $Bounds.min[1] -BaseX $BaseX -BaseY $BaseY -AngleDeg $AngleDeg)
    (Rotate-Point -X $Bounds.max[0] -Y $Bounds.max[1] -BaseX $BaseX -BaseY $BaseY -AngleDeg $AngleDeg)
  )
  return [ordered]@{
    min = @(($points.x | Measure-Object -Minimum).Minimum, ($points.y | Measure-Object -Minimum).Minimum)
    max = @(($points.x | Measure-Object -Maximum).Maximum, ($points.y | Measure-Object -Maximum).Maximum)
  }
}

function Test-Bounds {
  param($Actual, $Expected, [double]$Tolerance = 0.0001)
  return [Math]::Abs($Actual.min[0] - $Expected.min[0]) -lt $Tolerance -and
    [Math]::Abs($Actual.min[1] - $Expected.min[1]) -lt $Tolerance -and
    [Math]::Abs($Actual.max[0] - $Expected.max[0]) -lt $Tolerance -and
    [Math]::Abs($Actual.max[1] - $Expected.max[1]) -lt $Tolerance
}

function Test-Properties {
  param($Before, $After)
  return $Before.objectName -eq $After.objectName -and $Before.handle -eq $After.handle -and
    $Before.layer -eq $After.layer -and $Before.color -eq $After.color -and
    $Before.linetype -eq $After.linetype -and $Before.lineweight -eq $After.lineweight
}

function Get-StableMatrixStates {
  param($Document, $FamilyHandles, [bool]$Regenerate = $false, [int]$MaximumPasses = 12)
  $passes = New-Object System.Collections.Generic.List[object]
  $lastStates = @()
  $previousFingerprint = $null
  $consecutiveExactReads = 0
  for ($pass = 1; $pass -le $MaximumPasses; $pass += 1) {
    Wait-AcadIdle $Document
    if ($Regenerate) {
      Invoke-ComRetry { $Document.Regen(1) } | Out-Null
      Wait-AcadIdle $Document
    }
    $lastStates = @($FamilyHandles.GetEnumerator() | ForEach-Object {
      Get-EntityState (Get-EntityByHandle $Document ([string]$_.Value)) ([string]$_.Key)
    })
    $propertiesExact = $lastStates.Count -eq $FamilyHandles.Count -and @($lastStates | Where-Object {
      $_.layer -ne 'F018_MATRIX' -or $_.color -ne 1 -or $_.linetype -ne 'Continuous' -or $_.lineweight -ne 50
    }).Count -eq 0
    $fingerprint = if ($propertiesExact) { $lastStates | ConvertTo-Json -Depth 8 -Compress } else { $null }
    if ($fingerprint -and $fingerprint -eq $previousFingerprint) { $consecutiveExactReads += 1 }
    elseif ($fingerprint) { $consecutiveExactReads = 1 }
    else { $consecutiveExactReads = 0 }
    $passes.Add([ordered]@{
      pass = $pass
      entityCount = $lastStates.Count
      propertiesExact = $propertiesExact
      consecutiveExactReads = $consecutiveExactReads
      propertyMismatches = @($lastStates | Where-Object {
        $_.layer -ne 'F018_MATRIX' -or $_.color -ne 1 -or $_.linetype -ne 'Continuous' -or $_.lineweight -ne 50
      } | ForEach-Object { [ordered]@{ family=$_.family; handle=$_.handle; layer=$_.layer; color=$_.color; linetype=$_.linetype; lineweight=$_.lineweight } })
    })
    if ($consecutiveExactReads -ge 2) {
      return [ordered]@{ stable=$true; states=@($lastStates); passes=[object[]]$passes.ToArray() }
    }
    $previousFingerprint = $fingerprint
    Start-Sleep -Milliseconds 100
  }
  return [ordered]@{ stable=$false; states=@($lastStates); passes=[object[]]$passes.ToArray() }
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

function Invoke-RotateHandle {
  param($Document, [string]$Handle, [string]$Base, [string]$AngleInput, [string]$ReferenceInput = '')
  if ($ReferenceInput) {
    $script = "(setq f018:one (ssadd))`n(ssadd (handent `"$Handle`") f018:one)`n_.ROTATE`n!f018:one`n`n$Base`n_Reference`n$ReferenceInput`n$AngleInput`n"
  } else {
    $script = "(setq f018:one (ssadd))`n(ssadd (handent `"$Handle`") f018:one)`n_.ROTATE`n!f018:one`n`n$Base`n$AngleInput`n"
  }
  Invoke-ComRetry { $Document.SendCommand($script) } | Out-Null
  Wait-AcadIdle $Document
}

$preExistingAcadProcessIds = @(Get-Process -Name 'acad' -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.Id })
$acad = $null; $scratch = $null; $reusedBlank = $false; $result = $null
$automationProcessId = 0; $automationProcessOwned = $false; $automationProcessIdentity = $null
try {
  $acad = New-Object -ComObject AutoCAD.Application.24.3
  Invoke-ComRetry { $acad.Visible = $true } | Out-Null
  [uint32]$resolvedAutomationProcessId = 0
  [void][F018WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry { $acad.HWND }), [ref]$resolvedAutomationProcessId)
  $automationProcessId = [int]$resolvedAutomationProcessId
  $automationProcessOwned = $automationProcessId -gt 0 -and $preExistingAcadProcessIds -notcontains $automationProcessId
  Write-Host "[F-018] automation-process pid=$automationProcessId owned=$automationProcessOwned"
  if (-not $automationProcessOwned) { throw 'F-018 refuses to use a pre-existing AutoCAD process.' }
  $automationProcess = Get-Process -Id $automationProcessId -ErrorAction Stop
  $automationExecutablePath = [IO.Path]::GetFullPath([string]$automationProcess.Path)
  if ([IO.Path]::GetFileName($automationExecutablePath) -ine 'acad.exe') { throw "F-018 PID $automationProcessId is not acad.exe." }
  $automationProcessIdentity = [ordered]@{
    processId = $automationProcessId
    executablePath = $automationExecutablePath
    startTimeUtc = $automationProcess.StartTime.ToUniversalTime().ToString('o')
  }
  $initialCount = [int](Invoke-ComRetry { $acad.Documents.Count })
  if ($initialCount -gt 0) {
    $candidate = Invoke-ComRetry { $acad.ActiveDocument }
    $candidateName = [string](Invoke-ComRetry { $candidate.Name })
    $candidateFullName = [string](Invoke-ComRetry { $candidate.FullName })
    $candidateSaved = [bool](Invoke-ComRetry { $candidate.Saved })
    $candidateEntityCount = [int](Invoke-ComRetry { $candidate.ModelSpace.Count })
    if ($candidateFullName -or -not $candidateSaved -or $candidateEntityCount -ne 0) {
      throw "F-018 standard matrix refuses to run beside active user drawing '$candidateName'."
    }
    $scratch = $candidate; $reusedBlank = $true
  } else {
    $scratch = Invoke-ComRetry { $acad.Documents.Add() }
  }
  Invoke-ComRetry { $scratch.Activate() } | Out-Null
  Wait-AcadIdle $scratch

  foreach ($name in @('F018_MATRIX', 'F018_AUX', 'F018_STANDARD', 'F018_POINT', 'F018_REFERENCE', 'F018_NEGATIVE', 'F018_EDIT', 'F018_LOCKED')) {
    $null = Invoke-ComRetry { $scratch.Layers.Add($name) }
  }
  $lockedLayer = Invoke-ComRetry { $scratch.Layers.Item('F018_LOCKED') }
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
  $entities.text = Invoke-ComRetry { $scratch.ModelSpace.AddText('F018 TEXT', $textPoint, 20) }
  [double[]]$mtextPoint = @(1250, 0, 0)
  $entities.mtext = Invoke-ComRetry { $scratch.ModelSpace.AddMText($mtextPoint, 200, 'F018 MTEXT') }
  [double[]]$leaderPoints = @(1400, 0, 0, 1450, 50, 0, 1500, 50, 0)
  [double[]]$leaderAnnotationPoint = @(1500, 50, 0)
  $leaderAnnotation = Invoke-ComRetry { $scratch.ModelSpace.AddMText($leaderAnnotationPoint, 100, 'F018 LEADER') }
  Invoke-ComRetry { $leaderAnnotation.Layer = 'F018_AUX' } | Out-Null
  $entities.leader = Invoke-ComRetry { $scratch.ModelSpace.AddLeader($leaderPoints, $leaderAnnotation, 0) }
  [double[]]$dimA = @(1550, 0, 0); [double[]]$dimB = @(1650, 0, 0); [double[]]$dimText = @(1600, 50, 0)
  $entities.dimension = Invoke-ComRetry { $scratch.ModelSpace.AddDimAligned($dimA, $dimB, $dimText) }

  [double[]]$hatchBoundaryPoints = @(1700, 0, 1800, 0, 1800, 100, 1700, 100)
  $hatchBoundary = Invoke-ComRetry { $scratch.ModelSpace.AddLightWeightPolyline($hatchBoundaryPoints) }
  Invoke-ComRetry { $hatchBoundary.Closed = $true } | Out-Null
  Invoke-ComRetry { $hatchBoundary.Layer = 'F018_AUX' } | Out-Null
  $boundaryHandle = Invoke-NonEmptyCom { $hatchBoundary.Handle } 'Hatch boundary handle'
  $hatchLisp = "(progn (vl-load-com) (setq f018:ms (vla-get-ModelSpace (vla-get-ActiveDocument (vlax-get-acad-object)))) (setq f018:h (vla-AddHatch f018:ms 0 `"SOLID`" :vlax-false 0)) (setq f018:loop (vlax-make-safearray vlax-vbObject '(0 . 0))) (vlax-safearray-put-element f018:loop 0 (vlax-ename->vla-object (handent `"$boundaryHandle`"))) (vla-AppendOuterLoop f018:h f018:loop) (vla-Evaluate f018:h) (vla-put-Layer f018:h `"F018_MATRIX`") (setvar `"USERS1`" (vla-get-Handle f018:h)) (princ))`n"
  Invoke-ComRetry { $scratch.SendCommand($hatchLisp) } | Out-Null
  Wait-AcadIdle $scratch
  $hatchHandle = Invoke-NonEmptyCom { $scratch.GetVariable('USERS1') } 'Hatch handle'
  $entities.hatch = Get-EntityByHandle $scratch $hatchHandle

  $blockLisp = "(progn (vl-load-com) (setq f018:doc (vla-get-ActiveDocument (vlax-get-acad-object))) (setq f018:block (vla-Add (vla-get-Blocks f018:doc) (vlax-3d-point '(0.0 0.0 0.0)) `"F018_BLOCK`")) (vla-AddLine f018:block (vlax-3d-point '(0.0 0.0 0.0)) (vlax-3d-point '(100.0 0.0 0.0))) (setq f018:insert (vla-InsertBlock (vla-get-ModelSpace f018:doc) (vlax-3d-point '(1900.0 0.0 0.0)) `"F018_BLOCK`" 1.5 0.5 1.0 0.25)) (vla-put-Layer f018:insert `"F018_MATRIX`") (setvar `"USERS2`" (vla-get-Handle f018:insert)) (princ))`n"
  Invoke-ComRetry { $scratch.SendCommand($blockLisp) } | Out-Null
  Wait-AcadIdle $scratch
  $blockHandle = Invoke-NonEmptyCom { $scratch.GetVariable('USERS2') } 'Block reference handle'
  $entities.blockRef = Get-EntityByHandle $scratch $blockHandle

  foreach ($entity in $entities.Values) {
    Invoke-ComRetry { $entity.Layer = 'F018_MATRIX' } | Out-Null
    Invoke-ComRetry { $entity.Color = 1 } | Out-Null
    Invoke-ComRetry { $entity.Linetype = 'Continuous' } | Out-Null
    Invoke-ComRetry { $entity.Lineweight = 50 } | Out-Null
  }
  $familyHandles = [ordered]@{}
  foreach ($entry in $entities.GetEnumerator()) { $familyHandles[$entry.Key] = Invoke-NonEmptyCom { $entry.Value.Handle } "$($entry.Key) handle" }
  $beforeReadback = Get-StableMatrixStates $scratch $familyHandles $true
  $before = @($beforeReadback.states)

  $rotate = "(setq f018:ss (ssget `"_X`" '((8 . `"F018_MATRIX`"))))`n_.ROTATE`n!f018:ss`n`n100,200`n_Reference`n100,200`n1100,1200`n135`n"
  Invoke-ComRetry { $scratch.SendCommand($rotate) } | Out-Null
  Wait-AcadIdle $scratch
  $afterReadback = Get-StableMatrixStates $scratch $familyHandles $false
  $after = @($afterReadback.states)
  $checks = @()
  foreach ($prior in $before) {
    $state = @($after | Where-Object { $_.family -eq $prior.family })[0]
    $expected = Get-RotatedBounds $prior.bounds 100 200 90
    $checks += [ordered]@{
      family = $prior.family
      sameHandle = $state.handle -eq $prior.handle
      rotatedBounds = Test-Bounds $state.bounds $expected
      propertiesPreserved = Test-Properties $prior $state
    }
  }

  Invoke-ComRetry { $scratch.SendCommand("_.U`n") } | Out-Null
  Wait-AcadIdle $scratch
  $afterUndoReadback = Get-StableMatrixStates $scratch $familyHandles $false
  $afterUndo = @($afterUndoReadback.states)
  foreach ($prior in $before) {
    $state = @($afterUndo | Where-Object { $_.family -eq $prior.family })[0]
    $check = @($checks | Where-Object { $_.family -eq $prior.family })[0]
    $check.undoRestored = (Test-Bounds $state.bounds $prior.bounds) -and (Test-Properties $prior $state)
  }

  $standardLine = New-Line $scratch 'F018_STANDARD' 1000 0 2000 0
  $standardBefore = Get-EntityState $standardLine 'standardNumeric'
  Invoke-RotateHandle $scratch $standardBefore.handle '0,0' '90'
  $standardAfter = Get-EntityState (Get-EntityByHandle $scratch $standardBefore.handle) 'standardNumeric'
  $standardPassed = Test-Bounds $standardAfter.bounds (Get-RotatedBounds $standardBefore.bounds 0 0 90)

  $pointLine = New-Line $scratch 'F018_POINT' 1000 0 2000 0
  $pointBefore = Get-EntityState $pointLine 'standardPoint'
  Invoke-RotateHandle $scratch $pointBefore.handle '0,0' '0,1000'
  $pointAfter = Get-EntityState (Get-EntityByHandle $scratch $pointBefore.handle) 'standardPoint'
  $pointPassed = Test-Bounds $pointAfter.bounds (Get-RotatedBounds $pointBefore.bounds 0 0 90)

  $referenceLine = New-Line $scratch 'F018_REFERENCE' 1000 0 2000 0
  $referenceBefore = Get-EntityState $referenceLine 'numericReferencePointTarget'
  Invoke-RotateHandle $scratch $referenceBefore.handle '0,0' '0,1000' '45'
  $referenceAfter = Get-EntityState (Get-EntityByHandle $scratch $referenceBefore.handle) 'numericReferencePointTarget'
  $referencePassed = Test-Bounds $referenceAfter.bounds (Get-RotatedBounds $referenceBefore.bounds 0 0 45)

  $negativeLine = New-Line $scratch 'F018_NEGATIVE' 1000 0 2000 0
  $negativeBefore = Get-EntityState $negativeLine 'negativeNumeric'
  Invoke-RotateHandle $scratch $negativeBefore.handle '0,0' '-90'
  $negativeAfter = Get-EntityState (Get-EntityByHandle $scratch $negativeBefore.handle) 'negativeNumeric'
  $negativePassed = Test-Bounds $negativeAfter.bounds (Get-RotatedBounds $negativeBefore.bounds 0 0 -90)

  $editable = New-Line $scratch 'F018_EDIT' 0 2500 1000 2500
  $locked = New-Line $scratch 'F018_LOCKED' 0 2700 1000 2700
  Invoke-ComRetry { $lockedLayer.Lock = $true } | Out-Null
  $editableBefore = Get-EntityState $editable 'editable'
  $lockedBefore = Get-EntityState $locked 'locked'
  $editableHandle = $editableBefore.handle; $lockedHandle = $lockedBefore.handle
  $mixedRotate = "(setq f018:mixed (ssadd))`n(ssadd (handent `"$editableHandle`") f018:mixed)`n(ssadd (handent `"$lockedHandle`") f018:mixed)`n_.ROTATE`n!f018:mixed`n`n0,0`n90`n"
  Invoke-ComRetry { $scratch.SendCommand($mixedRotate) } | Out-Null
  Wait-AcadIdle $scratch
  $editableAfter = Get-EntityState (Get-EntityByHandle $scratch $editableHandle) 'editable'
  $lockedAfter = Get-EntityState (Get-EntityByHandle $scratch $lockedHandle) 'locked'
  $mixedPassed = (Test-Bounds $editableAfter.bounds (Get-RotatedBounds $editableBefore.bounds 0 0 90)) -and
    (Test-Bounds $lockedAfter.bounds $lockedBefore.bounds) -and (Test-Properties $lockedBefore $lockedAfter)

  $failed = @($checks | Where-Object { -not $_.sameHandle -or -not $_.rotatedBounds -or -not $_.propertiesPreserved -or -not $_.undoRestored })
  $matrixPassed = $beforeReadback.stable -and $afterReadback.stable -and $afterUndoReadback.stable -and $checks.Count -eq 12 -and $failed.Count -eq 0
  $inputModesPassed = $standardPassed -and $pointPassed -and $referencePassed -and $negativePassed
  $result = [ordered]@{
    schemaVersion = 1
    rowId = 'F-018'
    benchmark = 'AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation'
    engine = 'Autodesk AutoCAD 2024 desktop COM'
    engineVersion = [string](Invoke-ComRetry { $acad.Version })
    workflow = '12 native entity families; ROTATE base 100,200, two-point Reference 45 to absolute 135; U; numeric/point/negative input; mixed locked layer'
    referenceAngleDeg = 45
    newAngleDeg = 135
    deltaAngleDeg = 90
    before = $before
    after = $after
    afterUndo = $afterUndo
    readback = [ordered]@{ before=$beforeReadback; after=$afterReadback; afterUndo=$afterUndoReadback }
    checks = $checks
    inputModes = [ordered]@{
      standardNumeric = [ordered]@{ before = $standardBefore; after = $standardAfter; passed = $standardPassed }
      standardPoint = [ordered]@{ before = $pointBefore; after = $pointAfter; passed = $pointPassed }
      numericReferencePointTarget = [ordered]@{ before = $referenceBefore; after = $referenceAfter; passed = $referencePassed }
      negativeNumeric = [ordered]@{ before = $negativeBefore; after = $negativeAfter; passed = $negativePassed }
      passed = $inputModesPassed
    }
    mixedLocked = [ordered]@{ editableBefore = $editableBefore; editableAfter = $editableAfter; lockedBefore = $lockedBefore; lockedAfter = $lockedAfter; passed = $mixedPassed }
    gate = [ordered]@{ checkCount = $checks.Count; failedCount = $failed.Count; failed = $failed; matrixPassed = $matrixPassed; inputModesPassed = $inputModesPassed; mixedLockedPassed = $mixedPassed }
    cmdNamesAfter = [string](Invoke-ComRetry { $scratch.GetVariable('CMDNAMES') })
    status = if ($matrixPassed -and $inputModesPassed -and $mixedPassed) { 'PASS' } else { 'FAIL' }
  }
} finally {
  if ($scratch) { try { Invoke-ComRetry { $scratch.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
}

if (-not $result) { throw 'F-018 standard AutoCAD matrix produced no result.' }
if ([int](Invoke-ComRetry { $acad.Documents.Count }) -eq 0) {
  $restoredBlank = Invoke-ComRetry { $acad.Documents.Add() } -TimeoutSeconds 20
  Invoke-ComRetry { $restoredBlank.Activate() } | Out-Null
  Wait-AcadIdle $restoredBlank
}
$openDocumentsAfter = [int](Invoke-ComRetry { $acad.Documents.Count })
$activeNameAfter = ''
$activeFullNameAfter = ''
$activeSavedAfter = $true
$activeEntityCountAfter = 0
$ownedDocumentsClean = $true
foreach ($ownedDocument in $acad.Documents) {
  $ownedFullName = [string](Invoke-ComRetry { $ownedDocument.FullName })
  $ownedSaved = [bool](Invoke-ComRetry { $ownedDocument.Saved })
  $ownedEntityCount = [int](Invoke-ComRetry { $ownedDocument.ModelSpace.Count })
  if (-not [string]::IsNullOrWhiteSpace($ownedFullName) -or -not $ownedSaved -or $ownedEntityCount -ne 0) { $ownedDocumentsClean = $false }
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
  automationProcessId = $automationProcessId
  automationProcessIdentity = $automationProcessIdentity
  openDocumentsAfter = $openDocumentsAfter
  activeNameAfter = $activeNameAfter
  activeFullNameAfter = $activeFullNameAfter
  activeSavedAfter = $activeSavedAfter
  activeEntityCountAfter = $activeEntityCountAfter
  ownedDocumentsClean = $ownedDocumentsClean
  blankRestored = $blankRestored
}
if (-not $blankRestored) { $result.status = 'FAIL' }
$status = $result.status
$result | ConvertTo-Json -Depth 12
if ($automationProcessOwned -and $acad) { try { Invoke-ComRetry { $acad.Quit() } -TimeoutSeconds 10 | Out-Null } catch {} }
if ($status -ne 'PASS') { exit 1 }
