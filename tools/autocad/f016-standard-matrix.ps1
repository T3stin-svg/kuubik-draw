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
  $minimum = $null
  $maximum = $null
  Invoke-ComRetry { $Entity.GetBoundingBox([ref]$minimum, [ref]$maximum) } | Out-Null
  return [ordered]@{
    min = @([double]$minimum[0], [double]$minimum[1])
    max = @([double]$maximum[0], [double]$maximum[1])
  }
}

function Get-EntityState {
  param([Parameter(Mandatory = $true)]$Entity, [Parameter(Mandatory = $true)][string]$Family)
  return [ordered]@{
    family = $Family
    objectName = [string](Invoke-ComRetry { $Entity.ObjectName })
    handle = [string](Invoke-ComRetry { $Entity.Handle })
    bounds = Get-Bounds $Entity
  }
}

function Test-TranslatedBounds {
  param($Before, $After, [double]$Dx, [double]$Dy)
  return [Math]::Abs(($After.min[0] - $Before.min[0]) - $Dx) -lt 0.000001 -and
    [Math]::Abs(($After.min[1] - $Before.min[1]) - $Dy) -lt 0.000001 -and
    [Math]::Abs(($After.max[0] - $Before.max[0]) - $Dx) -lt 0.000001 -and
    [Math]::Abs(($After.max[1] - $Before.max[1]) - $Dy) -lt 0.000001
}

function Test-EqualBounds {
  param($Expected, $Actual)
  return (Test-TranslatedBounds $Expected $Actual 0 0)
}

$acad = $null
$scratch = $null
$reusedBlank = $false
$result = $null
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
      throw "F-016 standard matrix refuses to run beside active user drawing '$candidateName'."
    }
    $scratch = $candidate
    $reusedBlank = $true
  } else {
    $scratch = Invoke-ComRetry { $acad.Documents.Add() }
  }
  Invoke-ComRetry { $scratch.Activate() } | Out-Null
  Wait-AcadIdle $scratch

  $matrixLayer = Invoke-ComRetry { $scratch.Layers.Add('F016_MATRIX') }
  $auxLayer = Invoke-ComRetry { $scratch.Layers.Add('F016_AUX') }
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
  $entities.text = Invoke-ComRetry { $scratch.ModelSpace.AddText('F016 TEXT', $textPoint, 20) }
  [double[]]$mtextPoint = @(1250, 0, 0)
  $entities.mtext = Invoke-ComRetry { $scratch.ModelSpace.AddMText($mtextPoint, 200, 'F016 MTEXT') }
  [double[]]$leaderPoints = @(1400, 0, 0, 1450, 50, 0, 1500, 50, 0)
  [double[]]$leaderAnnotationPoint = @(1500, 50, 0)
  $leaderAnnotation = Invoke-ComRetry { $scratch.ModelSpace.AddMText($leaderAnnotationPoint, 100, 'F016 LEADER') }
  Invoke-ComRetry { $leaderAnnotation.Layer = 'F016_AUX' } | Out-Null
  $entities.leader = Invoke-ComRetry { $scratch.ModelSpace.AddLeader($leaderPoints, $leaderAnnotation, 0) }
  [double[]]$dimA = @(1550, 0, 0); [double[]]$dimB = @(1650, 0, 0); [double[]]$dimText = @(1600, 50, 0)
  $entities.dimension = Invoke-ComRetry { $scratch.ModelSpace.AddDimAligned($dimA, $dimB, $dimText) }

  [double[]]$hatchBoundaryPoints = @(1700, 0, 1800, 0, 1800, 100, 1700, 100)
  $hatchBoundary = Invoke-ComRetry { $scratch.ModelSpace.AddLightWeightPolyline($hatchBoundaryPoints) }
  Invoke-ComRetry { $hatchBoundary.Closed = $true } | Out-Null
  Invoke-ComRetry { $hatchBoundary.Layer = 'F016_AUX' } | Out-Null
  $boundaryHandle = [string](Invoke-ComRetry { $hatchBoundary.Handle })
  $hatchLisp = "(progn (vl-load-com) (setq f016:ms (vla-get-ModelSpace (vla-get-ActiveDocument (vlax-get-acad-object)))) (setq f016:h (vla-AddHatch f016:ms 0 `"SOLID`" :vlax-false 0)) (setq f016:loop (vlax-make-safearray vlax-vbObject '(0 . 0))) (vlax-safearray-put-element f016:loop 0 (vlax-ename->vla-object (handent `"$boundaryHandle`"))) (vla-AppendOuterLoop f016:h f016:loop) (vla-Evaluate f016:h) (vla-put-Layer f016:h `"F016_MATRIX`") (setvar `"USERS1`" (vla-get-Handle f016:h)) (princ))`n"
  Invoke-ComRetry { $scratch.SendCommand($hatchLisp) } | Out-Null
  Wait-AcadIdle $scratch
  $hatchHandle = [string](Invoke-ComRetry { $scratch.GetVariable('USERS1') })
  $entities.hatch = Invoke-ComRetry { $scratch.HandleToObject($hatchHandle) }

  $blockLisp = "(progn (vl-load-com) (setq f016:doc (vla-get-ActiveDocument (vlax-get-acad-object))) (setq f016:block (vla-Add (vla-get-Blocks f016:doc) (vlax-3d-point '(0.0 0.0 0.0)) `"F016_BLOCK`")) (vla-AddLine f016:block (vlax-3d-point '(0.0 0.0 0.0)) (vlax-3d-point '(100.0 0.0 0.0))) (setq f016:insert (vla-InsertBlock (vla-get-ModelSpace f016:doc) (vlax-3d-point '(1900.0 0.0 0.0)) `"F016_BLOCK`" 1.5 0.5 1.0 0.25)) (vla-put-Layer f016:insert `"F016_MATRIX`") (setvar `"USERS2`" (vla-get-Handle f016:insert)) (princ))`n"
  Invoke-ComRetry { $scratch.SendCommand($blockLisp) } | Out-Null
  Wait-AcadIdle $scratch
  $blockHandle = [string](Invoke-ComRetry { $scratch.GetVariable('USERS2') })
  $entities.blockRef = Invoke-ComRetry { $scratch.HandleToObject($blockHandle) }

  foreach ($entity in $entities.Values) { Invoke-ComRetry { $entity.Layer = 'F016_MATRIX' } | Out-Null }
  Invoke-ComRetry { $scratch.Regen(1) } | Out-Null
  Wait-AcadIdle $scratch
  $before = @($entities.GetEnumerator() | ForEach-Object { Get-EntityState $_.Value $_.Key })
  $handles = [ordered]@{}
  foreach ($state in $before) { $handles[$state.family] = $state.handle }

  $move = "(setq f016:ss (ssget `"_X`" '((8 . `"F016_MATRIX`"))))`n_.MOVE`n!f016:ss`n`n100,200`n600,950`n"
  Invoke-ComRetry { $scratch.SendCommand($move) } | Out-Null
  Wait-AcadIdle $scratch
  $after = @($handles.GetEnumerator() | ForEach-Object {
    $family = $_.Key; $handle = $_.Value
    $entity = Invoke-ComRetry { $scratch.HandleToObject($handle) }
    Get-EntityState $entity $family
  })

  Invoke-ComRetry { $scratch.SendCommand("_.U`n") } | Out-Null
  Wait-AcadIdle $scratch
  $afterUndo = @($handles.GetEnumerator() | ForEach-Object {
    $family = $_.Key; $handle = $_.Value
    $entity = Invoke-ComRetry { $scratch.HandleToObject($handle) }
    Get-EntityState $entity $family
  })

  $checks = for ($index = 0; $index -lt $before.Count; $index++) {
    [ordered]@{
      family = $before[$index].family
      translated = Test-TranslatedBounds $before[$index].bounds $after[$index].bounds 500 750
      restored = Test-EqualBounds $before[$index].bounds $afterUndo[$index].bounds
    }
  }
  $result = [ordered]@{
    schemaVersion = 1
    rowId = 'F-016'
    benchmark = 'AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation'
    engine = 'Autodesk AutoCAD 2024 desktop COM'
    engineVersion = [string](Invoke-ComRetry { $acad.Version })
    workflow = '12 standard native entity families selected by layer; MOVE base 100,200 to destination 600,950; one-command UNDO'
    vector = @(500, 750)
    before = $before
    after = $after
    afterUndo = $afterUndo
    checks = $checks
    cmdNamesAfter = [string](Invoke-ComRetry { $scratch.GetVariable('CMDNAMES') })
    status = if ($checks.Count -eq 12 -and @($checks | Where-Object { -not $_.translated -or -not $_.restored }).Count -eq 0) { 'PASS' } else { 'FAIL' }
  }
} finally {
  if ($scratch) { try { Invoke-ComRetry { $scratch.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
  if ($reusedBlank -and $acad) { try { Invoke-ComRetry { $acad.Documents.Add() } -TimeoutSeconds 10 | Out-Null } catch {} }
}

if (-not $result) { throw 'F-016 standard AutoCAD matrix produced no result.' }
$result | ConvertTo-Json -Depth 10
if ($result.status -ne 'PASS') { exit 1 }
