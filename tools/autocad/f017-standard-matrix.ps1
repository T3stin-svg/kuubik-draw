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

function Test-TranslatedBounds {
  param($Before, $After, [double]$Dx, [double]$Dy)
  return [Math]::Abs(($After.min[0] - $Before.min[0]) - $Dx) -lt 0.00001 -and
    [Math]::Abs(($After.min[1] - $Before.min[1]) - $Dy) -lt 0.00001 -and
    [Math]::Abs(($After.max[0] - $Before.max[0]) - $Dx) -lt 0.00001 -and
    [Math]::Abs(($After.max[1] - $Before.max[1]) - $Dy) -lt 0.00001
}

function Test-Properties {
  param($Before, $After)
  return $Before.objectName -eq $After.objectName -and $Before.layer -eq $After.layer -and
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
  param($Document, [string]$Layer, [double]$Y)
  [double[]]$a = @(0, $Y, 0); [double[]]$b = @(1000, $Y, 0)
  $line = Invoke-ComRetry { $Document.ModelSpace.AddLine($a, $b) }
  Invoke-ComRetry { $line.Layer = $Layer } | Out-Null
  return $line
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
      throw "F-017 standard matrix refuses to run beside active user drawing '$candidateName'."
    }
    $scratch = $candidate; $reusedBlank = $true
  } else {
    $scratch = Invoke-ComRetry { $acad.Documents.Add() }
  }
  Invoke-ComRetry { $scratch.Activate() } | Out-Null
  Wait-AcadIdle $scratch

  $null = Invoke-ComRetry { $scratch.Layers.Add('F017_MATRIX') }
  $null = Invoke-ComRetry { $scratch.Layers.Add('F017_AUX') }
  $null = Invoke-ComRetry { $scratch.Layers.Add('F017_EDIT') }
  $lockedLayer = Invoke-ComRetry { $scratch.Layers.Add('F017_LOCKED') }
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
  $entities.text = Invoke-ComRetry { $scratch.ModelSpace.AddText('F017 TEXT', $textPoint, 20) }
  [double[]]$mtextPoint = @(1250, 0, 0)
  $entities.mtext = Invoke-ComRetry { $scratch.ModelSpace.AddMText($mtextPoint, 200, 'F017 MTEXT') }
  [double[]]$leaderPoints = @(1400, 0, 0, 1450, 50, 0, 1500, 50, 0)
  [double[]]$leaderAnnotationPoint = @(1500, 50, 0)
  $leaderAnnotation = Invoke-ComRetry { $scratch.ModelSpace.AddMText($leaderAnnotationPoint, 100, 'F017 LEADER') }
  Invoke-ComRetry { $leaderAnnotation.Layer = 'F017_AUX' } | Out-Null
  $entities.leader = Invoke-ComRetry { $scratch.ModelSpace.AddLeader($leaderPoints, $leaderAnnotation, 0) }
  [double[]]$dimA = @(1550, 0, 0); [double[]]$dimB = @(1650, 0, 0); [double[]]$dimText = @(1600, 50, 0)
  $entities.dimension = Invoke-ComRetry { $scratch.ModelSpace.AddDimAligned($dimA, $dimB, $dimText) }

  [double[]]$hatchBoundaryPoints = @(1700, 0, 1800, 0, 1800, 100, 1700, 100)
  $hatchBoundary = Invoke-ComRetry { $scratch.ModelSpace.AddLightWeightPolyline($hatchBoundaryPoints) }
  Invoke-ComRetry { $hatchBoundary.Closed = $true } | Out-Null
  Invoke-ComRetry { $hatchBoundary.Layer = 'F017_AUX' } | Out-Null
  $boundaryHandle = [string](Invoke-ComRetry { $hatchBoundary.Handle })
  $hatchLisp = "(progn (vl-load-com) (setq f017:ms (vla-get-ModelSpace (vla-get-ActiveDocument (vlax-get-acad-object)))) (setq f017:h (vla-AddHatch f017:ms 0 `"SOLID`" :vlax-false 0)) (setq f017:loop (vlax-make-safearray vlax-vbObject '(0 . 0))) (vlax-safearray-put-element f017:loop 0 (vlax-ename->vla-object (handent `"$boundaryHandle`"))) (vla-AppendOuterLoop f017:h f017:loop) (vla-Evaluate f017:h) (vla-put-Layer f017:h `"F017_MATRIX`") (setvar `"USERS1`" (vla-get-Handle f017:h)) (princ))`n"
  Invoke-ComRetry { $scratch.SendCommand($hatchLisp) } | Out-Null
  Wait-AcadIdle $scratch
  $hatchHandle = [string](Invoke-ComRetry { $scratch.GetVariable('USERS1') })
  $entities.hatch = Invoke-ComRetry { $scratch.HandleToObject($hatchHandle) }

  $blockLisp = "(progn (vl-load-com) (setq f017:doc (vla-get-ActiveDocument (vlax-get-acad-object))) (setq f017:block (vla-Add (vla-get-Blocks f017:doc) (vlax-3d-point '(0.0 0.0 0.0)) `"F017_BLOCK`")) (vla-AddLine f017:block (vlax-3d-point '(0.0 0.0 0.0)) (vlax-3d-point '(100.0 0.0 0.0))) (setq f017:insert (vla-InsertBlock (vla-get-ModelSpace f017:doc) (vlax-3d-point '(1900.0 0.0 0.0)) `"F017_BLOCK`" 1.5 0.5 1.0 0.25)) (vla-put-Layer f017:insert `"F017_MATRIX`") (setvar `"USERS2`" (vla-get-Handle f017:insert)) (princ))`n"
  Invoke-ComRetry { $scratch.SendCommand($blockLisp) } | Out-Null
  Wait-AcadIdle $scratch
  $blockHandle = [string](Invoke-ComRetry { $scratch.GetVariable('USERS2') })
  $entities.blockRef = Invoke-ComRetry { $scratch.HandleToObject($blockHandle) }

  foreach ($entity in $entities.Values) {
    Invoke-ComRetry { $entity.Layer = 'F017_MATRIX' } | Out-Null
    Invoke-ComRetry { $entity.Color = 1 } | Out-Null
    Invoke-ComRetry { $entity.Linetype = 'Continuous' } | Out-Null
    Invoke-ComRetry { $entity.Lineweight = 50 } | Out-Null
  }
  Invoke-ComRetry { $scratch.Regen(1) } | Out-Null
  Wait-AcadIdle $scratch
  $before = @($entities.GetEnumerator() | ForEach-Object { Get-EntityState $_.Value $_.Key })

  $copy = "(setq f017:ss (ssget `"_X`" '((8 . `"F017_MATRIX`"))))`n_.COPY`n!f017:ss`n`n100,200`n600,950`n-200,300`n`n"
  Invoke-ComRetry { $scratch.SendCommand($copy) } | Out-Null
  Wait-AcadIdle $scratch

  $objectNames = [ordered]@{
    line = 'AcDbLine'; polyline = 'AcDbPolyline'; circle = 'AcDbCircle'; arc = 'AcDbArc'; ellipse = 'AcDbEllipse';
    spline = 'AcDbSpline'; text = 'AcDbText'; mtext = 'AcDbMText'; leader = 'AcDbLeader';
    dimension = 'AcDbAlignedDimension'; hatch = 'AcDbHatch'; blockRef = 'AcDbBlockReference'
  }
  $after = @()
  $checks = @()
  $afterEntities = @(Get-LayerEntities $scratch 'F017_MATRIX')
  foreach ($prior in $before) {
    $family = [string]$prior.family; $objectName = [string]$objectNames[$family]
    $states = @($afterEntities | Where-Object { [string]$_.ObjectName -eq $objectName } | ForEach-Object { Get-EntityState $_ $family })
    $after += [ordered]@{ family = $family; states = $states }
    $original = @($states | Where-Object { $_.handle -eq $prior.handle -and (Test-TranslatedBounds $prior.bounds $_.bounds 0 0) })
    $first = @($states | Where-Object { (Test-TranslatedBounds $prior.bounds $_.bounds 500 750) })
    $second = @($states | Where-Object { (Test-TranslatedBounds $prior.bounds $_.bounds -300 100) })
    $propertiesPreserved = $true
    foreach ($state in $states) {
      if (-not (Test-Properties $prior $state)) { $propertiesPreserved = $false }
    }
    $checks += [ordered]@{
      family = $family
      count = $states.Count
      originalPresent = $original.Count -eq 1
      firstCopy = $first.Count -eq 1
      secondCopy = $second.Count -eq 1
      propertiesPreserved = $propertiesPreserved
      uniqueHandles = @($states.handle | Select-Object -Unique).Count -eq 3
    }
  }

  Invoke-ComRetry { $scratch.SendCommand("_.U`n") } | Out-Null
  Wait-AcadIdle $scratch
  Invoke-ComRetry { $scratch.Regen(1) } | Out-Null
  Wait-AcadIdle $scratch
  $afterUndo = @()
  $undoEntities = @(Get-LayerEntities $scratch 'F017_MATRIX')
  foreach ($prior in $before) {
    $family = [string]$prior.family; $objectName = [string]$objectNames[$family]
    $states = @($undoEntities | Where-Object { [string]$_.ObjectName -eq $objectName } | ForEach-Object { Get-EntityState $_ $family })
    $afterUndo += [ordered]@{ family = $family; states = $states }
    $check = @($checks | Where-Object { $_.family -eq $family })[0]
    $check.undoRestored = $states.Count -eq 1 -and $states[0].handle -eq $prior.handle -and
      (Test-TranslatedBounds $prior.bounds $states[0].bounds 0 0) -and (Test-Properties $prior $states[0])
  }

  $editable = New-Line $scratch 'F017_EDIT' 2500
  $locked = New-Line $scratch 'F017_LOCKED' 2700
  Invoke-ComRetry { $lockedLayer.Lock = $true } | Out-Null
  $editableHandle = [string](Invoke-ComRetry { $editable.Handle }); $lockedHandle = [string](Invoke-ComRetry { $locked.Handle })
  $mixedCopy = "(setq f017:mixed (ssadd))`n(ssadd (handent `"$editableHandle`") f017:mixed)`n(ssadd (handent `"$lockedHandle`") f017:mixed)`n_.COPY`n!f017:mixed`n`n0,0`n100,50`n`n"
  Invoke-ComRetry { $scratch.SendCommand($mixedCopy) } | Out-Null
  Wait-AcadIdle $scratch
  Invoke-ComRetry { $scratch.Regen(1) } | Out-Null
  Wait-AcadIdle $scratch
  $mixedEntities = @()
  foreach ($entity in $scratch.ModelSpace) { $mixedEntities += $entity }
  $editableStates = @($mixedEntities | Where-Object { [string]$_.Layer -eq 'F017_EDIT' } | ForEach-Object { Get-EntityState $_ 'editable' })
  $lockedStates = @($mixedEntities | Where-Object { [string]$_.Layer -eq 'F017_LOCKED' } | ForEach-Object { Get-EntityState $_ 'locked' })
  $lockedCheck = [ordered]@{
    editableCount = $editableStates.Count
    lockedCount = $lockedStates.Count
    editableCopied = @($editableStates | Where-Object { $_.bounds.min[0] -eq 100 -and $_.bounds.min[1] -eq 2550 }).Count -eq 1
    lockedUnchanged = $lockedStates.Count -eq 1 -and $lockedStates[0].bounds.min[0] -eq 0 -and $lockedStates[0].bounds.min[1] -eq 2700
  }

  $failed = @($checks | Where-Object {
    $_.count -ne 3 -or -not $_.originalPresent -or -not $_.firstCopy -or -not $_.secondCopy -or
    -not $_.propertiesPreserved -or -not $_.uniqueHandles -or -not $_.undoRestored
  })
  $allChecksPassed = $checks.Count -eq 12 -and $failed.Count -eq 0
  $lockedPassed = $lockedCheck.editableCount -eq 2 -and $lockedCheck.lockedCount -eq 1 -and
    $lockedCheck.editableCopied -and $lockedCheck.lockedUnchanged
  $result = [ordered]@{
    schemaVersion = 1
    rowId = 'F-017'
    benchmark = 'AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation'
    engine = 'Autodesk AutoCAD 2024 desktop COM'
    engineVersion = [string](Invoke-ComRetry { $acad.Version })
    workflow = '12 native entity families; repeated COPY from base 100,200 to +500,+750 and -300,+100; one U; mixed locked layer'
    vectors = @(@(500, 750), @(-300, 100))
    before = $before
    after = $after
    afterUndo = $afterUndo
    checks = $checks
    gate = [ordered]@{ checkCount = $checks.Count; failedCount = $failed.Count; failed = $failed; allChecksPassed = $allChecksPassed; lockedPassed = $lockedPassed }
    mixedLocked = [ordered]@{ editable = $editableStates; locked = $lockedStates; checks = $lockedCheck }
    cmdNamesAfter = [string](Invoke-ComRetry { $scratch.GetVariable('CMDNAMES') })
    status = if ($allChecksPassed -and $lockedPassed) { 'PASS' } else { 'FAIL' }
  }
} finally {
  if ($scratch) { try { Invoke-ComRetry { $scratch.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
  if ($reusedBlank -and $acad) { try { Invoke-ComRetry { $acad.Documents.Add() } -TimeoutSeconds 10 | Out-Null } catch {} }
}

if (-not $result) { throw 'F-017 standard AutoCAD matrix produced no result.' }
$result | ConvertTo-Json -Depth 12
if ($result.status -ne 'PASS') { exit 1 }
