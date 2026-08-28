$ErrorActionPreference = 'Stop'

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
    handle = [string](Invoke-ComRetry { $Entity.Handle })
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

$acad = $null; $scratch = $null; $reusedBlank = $false; $result = $null
try {
  $acad = New-Object -ComObject AutoCAD.Application.24.3
  Invoke-ComRetry { $acad.Visible = $true } | Out-Null
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
  $boundaryHandle = [string](Invoke-ComRetry { $hatchBoundary.Handle })
  $hatchLisp = "(progn (vl-load-com) (setq f018:ms (vla-get-ModelSpace (vla-get-ActiveDocument (vlax-get-acad-object)))) (setq f018:h (vla-AddHatch f018:ms 0 `"SOLID`" :vlax-false 0)) (setq f018:loop (vlax-make-safearray vlax-vbObject '(0 . 0))) (vlax-safearray-put-element f018:loop 0 (vlax-ename->vla-object (handent `"$boundaryHandle`"))) (vla-AppendOuterLoop f018:h f018:loop) (vla-Evaluate f018:h) (vla-put-Layer f018:h `"F018_MATRIX`") (setvar `"USERS1`" (vla-get-Handle f018:h)) (princ))`n"
  Invoke-ComRetry { $scratch.SendCommand($hatchLisp) } | Out-Null
  Wait-AcadIdle $scratch
  $hatchHandle = [string](Invoke-ComRetry { $scratch.GetVariable('USERS1') })
  $entities.hatch = Invoke-ComRetry { $scratch.HandleToObject($hatchHandle) }

  $blockLisp = "(progn (vl-load-com) (setq f018:doc (vla-get-ActiveDocument (vlax-get-acad-object))) (setq f018:block (vla-Add (vla-get-Blocks f018:doc) (vlax-3d-point '(0.0 0.0 0.0)) `"F018_BLOCK`")) (vla-AddLine f018:block (vlax-3d-point '(0.0 0.0 0.0)) (vlax-3d-point '(100.0 0.0 0.0))) (setq f018:insert (vla-InsertBlock (vla-get-ModelSpace f018:doc) (vlax-3d-point '(1900.0 0.0 0.0)) `"F018_BLOCK`" 1.5 0.5 1.0 0.25)) (vla-put-Layer f018:insert `"F018_MATRIX`") (setvar `"USERS2`" (vla-get-Handle f018:insert)) (princ))`n"
  Invoke-ComRetry { $scratch.SendCommand($blockLisp) } | Out-Null
  Wait-AcadIdle $scratch
  $blockHandle = [string](Invoke-ComRetry { $scratch.GetVariable('USERS2') })
  $entities.blockRef = Invoke-ComRetry { $scratch.HandleToObject($blockHandle) }

  foreach ($entity in $entities.Values) {
    Invoke-ComRetry { $entity.Layer = 'F018_MATRIX' } | Out-Null
    Invoke-ComRetry { $entity.Color = 1 } | Out-Null
    Invoke-ComRetry { $entity.Linetype = 'Continuous' } | Out-Null
    Invoke-ComRetry { $entity.Lineweight = 50 } | Out-Null
  }
  Invoke-ComRetry { $scratch.Regen(1) } | Out-Null
  Wait-AcadIdle $scratch
  $before = @($entities.GetEnumerator() | ForEach-Object { Get-EntityState $_.Value $_.Key })

  $rotate = "(setq f018:ss (ssget `"_X`" '((8 . `"F018_MATRIX`"))))`n_.ROTATE`n!f018:ss`n`n100,200`n_Reference`n100,200`n1100,1200`n135`n"
  Invoke-ComRetry { $scratch.SendCommand($rotate) } | Out-Null
  Wait-AcadIdle $scratch
  $after = @()
  $checks = @()
  foreach ($prior in $before) {
    $entity = Invoke-ComRetry { $scratch.HandleToObject($prior.handle) }
    $state = Get-EntityState $entity $prior.family
    $expected = Get-RotatedBounds $prior.bounds 100 200 90
    $after += $state
    $checks += [ordered]@{
      family = $prior.family
      sameHandle = $state.handle -eq $prior.handle
      rotatedBounds = Test-Bounds $state.bounds $expected
      propertiesPreserved = Test-Properties $prior $state
    }
  }

  Invoke-ComRetry { $scratch.SendCommand("_.U`n") } | Out-Null
  Wait-AcadIdle $scratch
  $afterUndo = @()
  foreach ($prior in $before) {
    $state = Get-EntityState (Invoke-ComRetry { $scratch.HandleToObject($prior.handle) }) $prior.family
    $afterUndo += $state
    $check = @($checks | Where-Object { $_.family -eq $prior.family })[0]
    $check.undoRestored = (Test-Bounds $state.bounds $prior.bounds) -and (Test-Properties $prior $state)
  }

  $standardLine = New-Line $scratch 'F018_STANDARD' 1000 0 2000 0
  $standardBefore = Get-EntityState $standardLine 'standardNumeric'
  Invoke-RotateHandle $scratch $standardBefore.handle '0,0' '90'
  $standardAfter = Get-EntityState (Invoke-ComRetry { $scratch.HandleToObject($standardBefore.handle) }) 'standardNumeric'
  $standardPassed = Test-Bounds $standardAfter.bounds (Get-RotatedBounds $standardBefore.bounds 0 0 90)

  $pointLine = New-Line $scratch 'F018_POINT' 1000 0 2000 0
  $pointBefore = Get-EntityState $pointLine 'standardPoint'
  Invoke-RotateHandle $scratch $pointBefore.handle '0,0' '0,1000'
  $pointAfter = Get-EntityState (Invoke-ComRetry { $scratch.HandleToObject($pointBefore.handle) }) 'standardPoint'
  $pointPassed = Test-Bounds $pointAfter.bounds (Get-RotatedBounds $pointBefore.bounds 0 0 90)

  $referenceLine = New-Line $scratch 'F018_REFERENCE' 1000 0 2000 0
  $referenceBefore = Get-EntityState $referenceLine 'numericReferencePointTarget'
  Invoke-RotateHandle $scratch $referenceBefore.handle '0,0' '0,1000' '45'
  $referenceAfter = Get-EntityState (Invoke-ComRetry { $scratch.HandleToObject($referenceBefore.handle) }) 'numericReferencePointTarget'
  $referencePassed = Test-Bounds $referenceAfter.bounds (Get-RotatedBounds $referenceBefore.bounds 0 0 45)

  $negativeLine = New-Line $scratch 'F018_NEGATIVE' 1000 0 2000 0
  $negativeBefore = Get-EntityState $negativeLine 'negativeNumeric'
  Invoke-RotateHandle $scratch $negativeBefore.handle '0,0' '-90'
  $negativeAfter = Get-EntityState (Invoke-ComRetry { $scratch.HandleToObject($negativeBefore.handle) }) 'negativeNumeric'
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
  $editableAfter = Get-EntityState (Invoke-ComRetry { $scratch.HandleToObject($editableHandle) }) 'editable'
  $lockedAfter = Get-EntityState (Invoke-ComRetry { $scratch.HandleToObject($lockedHandle) }) 'locked'
  $mixedPassed = (Test-Bounds $editableAfter.bounds (Get-RotatedBounds $editableBefore.bounds 0 0 90)) -and
    (Test-Bounds $lockedAfter.bounds $lockedBefore.bounds) -and (Test-Properties $lockedBefore $lockedAfter)

  $failed = @($checks | Where-Object { -not $_.sameHandle -or -not $_.rotatedBounds -or -not $_.propertiesPreserved -or -not $_.undoRestored })
  $matrixPassed = $checks.Count -eq 12 -and $failed.Count -eq 0
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
  if ($reusedBlank -and $acad) { try { Invoke-ComRetry { $acad.Documents.Add() } -TimeoutSeconds 10 | Out-Null } catch {} }
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
if ($openDocumentsAfter -gt 0) {
  $activeNameAfter = [string](Invoke-ComRetry { $acad.ActiveDocument.Name })
  $activeFullNameAfter = [string](Invoke-ComRetry { $acad.ActiveDocument.FullName })
  $activeSavedAfter = [bool](Invoke-ComRetry { $acad.ActiveDocument.Saved })
  $activeEntityCountAfter = [int](Invoke-ComRetry { $acad.ActiveDocument.ModelSpace.Count })
}
$blankRestored = $openDocumentsAfter -eq 1 -and [string]::IsNullOrWhiteSpace($activeFullNameAfter) -and
  $activeSavedAfter -and $activeEntityCountAfter -eq 0
$result.userDocument = [ordered]@{
  reusedBlank = $reusedBlank
  openDocumentsAfter = $openDocumentsAfter
  activeNameAfter = $activeNameAfter
  activeFullNameAfter = $activeFullNameAfter
  activeSavedAfter = $activeSavedAfter
  activeEntityCountAfter = $activeEntityCountAfter
  blankRestored = $blankRestored
}
if (-not $blankRestored) { $result.status = 'FAIL' }
$result | ConvertTo-Json -Depth 12
if ($result.status -ne 'PASS') { exit 1 }
