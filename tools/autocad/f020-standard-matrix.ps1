param(
  [Parameter(Mandatory = $true)][string]$PidPath,
  [Parameter(Mandatory = $true)][string]$OwnershipToken
)

$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class F020WindowProcess {
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

function Get-EntityByHandle {
  param($Document, [string]$Handle, [int]$TimeoutSeconds = 20)
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
      if ([string]::IsNullOrWhiteSpace([string]$Document.GetVariable('CMDNAMES')) -and [int]$Document.GetVariable('CMDACTIVE') -eq 0) { return }
    } catch {}
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'AutoCAD did not return to an idle command state.'
}

function Set-RotationAndVerify {
  param(
    [Parameter(Mandatory = $true)]$Document,
    [Parameter(Mandatory = $true)]$Entity,
    [Parameter(Mandatory = $true)][double]$Expected
  )
  $handle = [string](Invoke-ComRetry { $Entity.Handle })
  Invoke-ComRetry { $Entity.Rotation = $Expected; $Entity.Update() } | Out-Null
  Invoke-ComRetry { $Document.Regen(1) } | Out-Null
  Wait-AcadIdle $Document
  return Invoke-ComRetry {
    $resolved = $Document.HandleToObject($handle)
    $actual = [double]$resolved.Rotation
    if ([Math]::Abs($actual - $Expected) -ge 0.000001) {
      throw "AutoCAD returned stale rotation $actual for handle $handle; expected $Expected."
    }
    return $resolved
  }
}

function Set-CommonPropertiesAndVerify {
  param(
    [Parameter(Mandatory = $true)]$Document,
    [Parameter(Mandatory = $true)]$Entity,
    [Parameter(Mandatory = $true)][string]$Layer
  )
  $handle = [string](Invoke-ComRetry { $Entity.Handle })
  Invoke-ComRetry {
    $Entity.Layer = $Layer
    $Entity.Color = 1
    $Entity.Linetype = 'Continuous'
    $Entity.Lineweight = 50
    $Entity.Update()
  } | Out-Null
  Invoke-ComRetry { $Document.Regen(1) } | Out-Null
  Wait-AcadIdle $Document
  return Invoke-ComRetry {
    $resolved = $Document.HandleToObject($handle)
    $actualLayer = [string]$resolved.Layer
    $actualColor = [int]$resolved.Color
    $actualLinetype = [string]$resolved.Linetype
    $actualLineweight = [int]$resolved.Lineweight
    if ($actualLayer -ne $Layer -or $actualColor -ne 1 -or $actualLinetype -ne 'Continuous' -or $actualLineweight -ne 50) {
      throw "AutoCAD returned stale properties for handle ${handle}: layer='$actualLayer', color=$actualColor, linetype='$actualLinetype', lineweight=$actualLineweight."
    }
    return $resolved
  }
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

function Convert-FlatPoints {
  param($Values, [int]$Stride = 3)
  $flat = @($Values); $points = @()
  for ($index = 0; $index + 1 -lt $flat.Count; $index += $Stride) {
    $points += ,@([double]$flat[$index], [double]$flat[$index + 1])
  }
  return @($points)
}

function Get-Point2 {
  param($Value)
  return @([double]$Value[0], [double]$Value[1])
}

function Get-EntityState {
  param([Parameter(Mandatory = $true)]$Entity, [Parameter(Mandatory = $true)][string]$Family)
  $details = [ordered]@{}
  switch ($Family) {
    'line' {
      $details.start = Get-Point2 (Invoke-ComRetry { $Entity.StartPoint })
      $details.end = Get-Point2 (Invoke-ComRetry { $Entity.EndPoint })
    }
    'polyline' {
      $details.vertices = Convert-FlatPoints (Invoke-ComRetry { $Entity.Coordinates }) 2
      $details.firstBulge = [double](Invoke-ComRetry { $Entity.GetBulge(0) })
      $details.closed = [bool](Invoke-ComRetry { $Entity.Closed })
    }
    'circle' {
      $details.center = Get-Point2 (Invoke-ComRetry { $Entity.Center })
      $details.radius = [double](Invoke-ComRetry { $Entity.Radius })
    }
    'arc' {
      $details.center = Get-Point2 (Invoke-ComRetry { $Entity.Center })
      $details.radius = [double](Invoke-ComRetry { $Entity.Radius })
      $details.startAngle = [double](Invoke-ComRetry { $Entity.StartAngle })
      $details.endAngle = [double](Invoke-ComRetry { $Entity.EndAngle })
    }
    'ellipse' {
      $details.center = Get-Point2 (Invoke-ComRetry { $Entity.Center })
      $details.majorAxis = Get-Point2 (Invoke-ComRetry { $Entity.MajorAxis })
      $details.radiusRatio = [double](Invoke-ComRetry { $Entity.RadiusRatio })
      $details.startParameter = [double](Invoke-ComRetry { $Entity.StartParameter })
      $details.endParameter = [double](Invoke-ComRetry { $Entity.EndParameter })
    }
    'spline' {
      $details.fitPoints = Convert-FlatPoints (Invoke-ComRetry { $Entity.FitPoints }) 3
      $details.degree = [int](Invoke-ComRetry { $Entity.Degree })
      $details.closed = [bool](Invoke-ComRetry { $Entity.Closed })
    }
    'text' {
      $point = Invoke-ComRetry { $Entity.InsertionPoint }
      $details.position = @([double]$point[0], [double]$point[1])
      $details.rotation = [double](Invoke-ComRetry { $Entity.Rotation })
      $details.text = [string](Invoke-ComRetry { $Entity.TextString })
      $details.alignment = [int](Invoke-ComRetry { $Entity.Alignment })
    }
    'mtext' {
      $point = Invoke-ComRetry { $Entity.InsertionPoint }
      $details.position = @([double]$point[0], [double]$point[1])
      $details.rotation = [double](Invoke-ComRetry { $Entity.Rotation })
      $details.text = [string](Invoke-ComRetry { $Entity.TextString })
      $details.attachmentPoint = [int](Invoke-ComRetry { $Entity.AttachmentPoint })
    }
    'leader' {
      $details.vertices = Convert-FlatPoints (Invoke-ComRetry { $Entity.Coordinates }) 3
    }
    'dimension' {
      $point1 = Invoke-ComRetry { $Entity.ExtLine1Point }; $point2 = Invoke-ComRetry { $Entity.ExtLine2Point }
      $details.extLine1Point = @([double]$point1[0], [double]$point1[1])
      $details.extLine2Point = @([double]$point2[0], [double]$point2[1])
      $details.measurement = [double](Invoke-ComRetry { $Entity.Measurement })
    }
    'hatch' {
      $details.area = [double](Invoke-ComRetry { $Entity.Area })
      $details.patternName = [string](Invoke-ComRetry { $Entity.PatternName })
      $details.associative = [bool](Invoke-ComRetry { $Entity.AssociativeHatch })
    }
    'blockRef' {
      $point = Invoke-ComRetry { $Entity.InsertionPoint }
      $details.position = @([double]$point[0], [double]$point[1])
      $details.rotation = [double](Invoke-ComRetry { $Entity.Rotation })
      $details.xScale = [double](Invoke-ComRetry { $Entity.XScaleFactor })
      $details.yScale = [double](Invoke-ComRetry { $Entity.YScaleFactor })
    }
  }
  return [ordered]@{
    family = $Family
    objectName = [string](Invoke-ComRetry { $Entity.ObjectName })
    handle = [string](Invoke-ComRetry { $Entity.Handle })
    layer = [string](Invoke-ComRetry { $Entity.Layer })
    color = [int](Invoke-ComRetry { $Entity.Color })
    linetype = [string](Invoke-ComRetry { $Entity.Linetype })
    lineweight = [int](Invoke-ComRetry { $Entity.Lineweight })
    bounds = Get-Bounds $Entity
    details = $details
  }
}

function Test-Near { param([double]$Actual, [double]$Expected, [double]$Tolerance = 0.001); return [Math]::Abs($Actual - $Expected) -lt $Tolerance }
function Test-Point { param($Actual, $Expected); return (Test-Near $Actual[0] $Expected[0]) -and (Test-Near $Actual[1] $Expected[1]) }
function Test-ReflectedPoint { param($Before, $After); return (Test-Near $After[0] (3000 - $Before[0])) -and (Test-Near $After[1] $Before[1]) }
function Test-ReflectedVector { param($Before, $After); return (Test-Near $After[0] (-$Before[0])) -and (Test-Near $After[1] $Before[1]) }
function Test-ReflectedPoints {
  param($Before, $After)
  if ($Before.Count -ne $After.Count) { return $false }
  for ($index = 0; $index -lt $Before.Count; $index++) { if (-not (Test-ReflectedPoint $Before[$index] $After[$index])) { return $false } }
  return $true
}
function Get-NormalizedAngle {
  param([double]$Angle)
  $fullTurn = 2 * [Math]::PI
  while ($Angle -lt 0) { $Angle += $fullTurn }
  while ($Angle -ge $fullTurn) { $Angle -= $fullTurn }
  return $Angle
}
function Test-ReflectedBounds {
  param($Before, $After, [double]$Tolerance = 0.001)
  return (Test-Near $After.min[0] (3000 - $Before.max[0]) $Tolerance) -and
    (Test-Near $After.max[0] (3000 - $Before.min[0]) $Tolerance) -and
    (Test-Near $After.min[1] $Before.min[1] $Tolerance) -and (Test-Near $After.max[1] $Before.max[1] $Tolerance)
}
function Test-TiltReflectedPoint { param($Before, $After); return (Test-Near $After[0] $Before[1]) -and (Test-Near $After[1] $Before[0]) }
function Test-TiltReflectedBounds {
  param($Before, $After, [double]$Tolerance = 0.001)
  return (Test-Near $After.min[0] $Before.min[1] $Tolerance) -and
    (Test-Near $After.max[0] $Before.max[1] $Tolerance) -and
    (Test-Near $After.min[1] $Before.min[0] $Tolerance) -and (Test-Near $After.max[1] $Before.max[0] $Tolerance)
}
function Test-Properties {
  param($Before, $After)
  return $Before.objectName -eq $After.objectName -and $Before.layer -eq $After.layer -and
    $Before.color -eq $After.color -and $Before.linetype -eq $After.linetype -and $Before.lineweight -eq $After.lineweight
}
function Test-FamilySemantics {
  param($Before, $After)
  switch ($Before.family) {
    'line' { return (Test-ReflectedPoint $Before.details.start $After.details.start) -and (Test-ReflectedPoint $Before.details.end $After.details.end) }
    'polyline' { return (Test-ReflectedPoints $Before.details.vertices $After.details.vertices) -and (Test-Near $After.details.firstBulge (-$Before.details.firstBulge)) -and $After.details.closed -eq $Before.details.closed }
    'circle' { return (Test-ReflectedPoint $Before.details.center $After.details.center) -and (Test-Near $After.details.radius $Before.details.radius) }
    'arc' {
      return (Test-ReflectedPoint $Before.details.center $After.details.center) -and (Test-Near $After.details.radius $Before.details.radius) -and
        (Test-Near $After.details.startAngle (Get-NormalizedAngle ([Math]::PI - $Before.details.endAngle))) -and
        (Test-Near $After.details.endAngle (Get-NormalizedAngle ([Math]::PI - $Before.details.startAngle)))
    }
    'ellipse' {
      return (Test-ReflectedPoint $Before.details.center $After.details.center) -and
        (Test-ReflectedVector $Before.details.majorAxis $After.details.majorAxis) -and
        (Test-Near $After.details.radiusRatio $Before.details.radiusRatio) -and
        (Test-Near ($After.details.endParameter - $After.details.startParameter) ($Before.details.endParameter - $Before.details.startParameter))
    }
    'spline' { return (Test-ReflectedPoints $Before.details.fitPoints $After.details.fitPoints) -and $After.details.degree -eq $Before.details.degree -and $After.details.closed -eq $Before.details.closed }
    'text' {
      $expectedRotation = Get-NormalizedAngle ((2 * [Math]::PI) - $Before.details.rotation)
      return $After.details.text -eq $Before.details.text -and (Test-Near $After.details.rotation $expectedRotation) -and $After.details.alignment -eq $Before.details.alignment
    }
    'mtext' {
      $expectedRotation = Get-NormalizedAngle ((2 * [Math]::PI) - $Before.details.rotation)
      $expectedAttachment = switch ([int]$Before.details.attachmentPoint) { 1 { 3 } 3 { 1 } 4 { 6 } 6 { 4 } 7 { 9 } 9 { 7 } default { [int]$Before.details.attachmentPoint } }
      return $After.details.text -eq $Before.details.text -and (Test-Near $After.details.rotation $expectedRotation) -and $After.details.attachmentPoint -eq $expectedAttachment
    }
    'leader' { return Test-ReflectedPoints $Before.details.vertices $After.details.vertices }
    'dimension' {
      return (Test-ReflectedPoint $Before.details.extLine1Point $After.details.extLine1Point) -and
        (Test-ReflectedPoint $Before.details.extLine2Point $After.details.extLine2Point) -and
        (Test-Near $Before.details.measurement $After.details.measurement)
    }
    'hatch' { return (Test-Near $After.details.area $Before.details.area) -and $After.details.patternName -eq $Before.details.patternName -and $After.details.associative -eq $Before.details.associative }
    'blockRef' {
      $expectedRotation = Get-NormalizedAngle ((2 * [Math]::PI) - $Before.details.rotation)
      return (Test-ReflectedPoint $Before.details.position $After.details.position) -and
        (Test-Near $After.details.rotation $expectedRotation) -and
        (Test-Near $After.details.xScale (-$Before.details.xScale)) -and (Test-Near $After.details.yScale $Before.details.yScale) -and
        (Test-ReflectedBounds $Before.bounds $After.bounds)
    }
    default { return $false }
  }
}

function Get-LayerEntities {
  param($Document, [string]$Layer)
  $items = @(); foreach ($entity in $Document.ModelSpace) { if ([string]$entity.Layer -eq $Layer) { $items += $entity } }
  return @($items)
}

function New-Line {
  param($Document, [string]$Layer, [double]$StartX, [double]$StartY, [double]$EndX, [double]$EndY)
  [double[]]$a = @($StartX, $StartY, 0); [double[]]$b = @($EndX, $EndY, 0)
  $line = Invoke-ComRetry { $Document.ModelSpace.AddLine($a, $b) }
  Invoke-ComRetry { $line.Layer = $Layer } | Out-Null
  return $line
}

function Invoke-MirrorSelection {
  param($Document, [string[]]$Handles, [bool]$EraseSource, [string]$AxisStart = '1500,-500', [string]$AxisEnd = '1500,1500')
  $selection = "(setq f020:ss (ssadd))`n"
  foreach ($handle in $Handles) { $selection += "(ssadd (handent `"$handle`") f020:ss)`n" }
  $answer = if ($EraseSource) { '_Y' } else { '' }
  $script = "${selection}_.MIRROR`n!f020:ss`n`n$AxisStart`n$AxisEnd`n$answer`n"
  Invoke-ComRetry { $Document.SendCommand($script) } | Out-Null
  Wait-AcadIdle $Document
}

function Invoke-RefusedCoincidentMirror {
  param($Document, [string]$Handle, [int]$TargetProcessId)
  $helperPath = Join-Path $PSScriptRoot 'send-escape.ps1'
  $cancelProcess = Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -PassThru -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $helperPath,
    '-TargetProcessId', [string]$TargetProcessId, '-DelayMs', '900'
  )
  $script = "(setq f020:bad (ssadd))`n(ssadd (handent `"$Handle`") f020:bad)`n_.MIRROR`n!f020:bad`n`n5,5`n5,5`n"
  $timer = [Diagnostics.Stopwatch]::StartNew()
  Invoke-ComRetry { $Document.SendCommand($script) } | Out-Null
  $timer.Stop()
  if (-not $cancelProcess.WaitForExit(5000)) { Stop-Process -Id $cancelProcess.Id -Force; throw 'F-020 cancel helper did not finish.' }
  Wait-AcadIdle $Document
  return [ordered]@{
    cancelHelperExitCode = [int]$cancelProcess.ExitCode
    invalidPromptRemainedActive = [int]$timer.ElapsedMilliseconds -ge 700
    idleAfterCancel = [string]::IsNullOrWhiteSpace([string](Invoke-ComRetry { $Document.GetVariable('CMDNAMES') }))
  }
}

$preExistingProcessIds = @(Get-Process -Name 'acad' -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.Id })
$acad = $null; $scratch = $null; $result = $null; $automationProcessId = 0; $owned = $false
try {
  # Creating the COM server is deliberately single-shot. Retrying New-Object can
  # launch several orphan acad.exe processes when COM registration is slow.
  $acad = New-Object -ComObject AutoCAD.Application.24.3
  [uint32]$resolvedProcessId = 0
  [void][F020WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry { $acad.HWND }), [ref]$resolvedProcessId)
  $automationProcessId = [int]$resolvedProcessId
  if ($automationProcessId -le 0) { throw 'Could not resolve the F-020 AutoCAD automation process.' }
  $owned = $automationProcessId -gt 0 -and $preExistingProcessIds -notcontains $automationProcessId
  Write-Host "[F-020] automation-process pid=$automationProcessId owned=$owned"
  if (-not $owned) { throw 'F-020 refuses to use a pre-existing AutoCAD process.' }
  [ordered]@{ schemaVersion = 1; processId = $automationProcessId; owned = $true; token = $OwnershipToken } | ConvertTo-Json -Compress | Set-Content -LiteralPath $PidPath -Encoding ascii
  Invoke-ComRetry { $acad.Visible = $true } | Out-Null
  $scratch = if ([int](Invoke-ComRetry { $acad.Documents.Count }) -gt 0) { Invoke-ComRetry { $acad.ActiveDocument } } else { Invoke-ComRetry { $acad.Documents.Add() } }
  if ([string](Invoke-ComRetry { $scratch.FullName }) -or -not [bool](Invoke-ComRetry { $scratch.Saved }) -or [int](Invoke-ComRetry { $scratch.ModelSpace.Count }) -ne 0) {
    throw 'F-020 standard matrix refuses a non-blank drawing.'
  }
  Invoke-ComRetry { $scratch.Activate() } | Out-Null
  Wait-AcadIdle $scratch
  Invoke-ComRetry { $scratch.SetVariable('MIRRTEXT', 0) } | Out-Null
  foreach ($name in @('F020_MATRIX', 'F020_AUX', 'F020_EDIT', 'F020_LOCKED', 'F020_BAD', 'F020_TILT_LINE', 'F020_TILT_TEXT', 'F020_TILT_BLOCK')) { $null = Invoke-ComRetry { $scratch.Layers.Add($name) } }
  $lockedLayer = Invoke-ComRetry { $scratch.Layers.Item('F020_LOCKED') }

  $entities = [ordered]@{}
  [double[]]$p0 = @(0, 0, 0); [double[]]$p50 = @(50, 0, 0)
  $entities.line = Invoke-ComRetry { $scratch.ModelSpace.AddLine($p0, $p50) }
  [double[]]$polyPoints = @(100, 0, 150, 25, 200, 0)
  $entities.polyline = Invoke-ComRetry { $scratch.ModelSpace.AddLightWeightPolyline($polyPoints) }
  Invoke-ComRetry { $entities.polyline.SetBulge(0, 0.25) } | Out-Null
  [double[]]$circleCenter = @(300, 0, 0); $entities.circle = Invoke-ComRetry { $scratch.ModelSpace.AddCircle($circleCenter, 25) }
  [double[]]$arcCenter = @(500, 0, 0); $entities.arc = Invoke-ComRetry { $scratch.ModelSpace.AddArc($arcCenter, 30, 0, ([Math]::PI / 2)) }
  [double[]]$ellipseCenter = @(700, 0, 0); [double[]]$ellipseAxis = @(50, 10, 0)
  $entities.ellipse = Invoke-ComRetry { $scratch.ModelSpace.AddEllipse($ellipseCenter, $ellipseAxis, 0.5) }
  [double[]]$fitPoints = @(900, 0, 0, 950, 75, 0, 1000, 0, 0); [double[]]$startTangent = @(50, 75, 0); [double[]]$endTangent = @(50, -75, 0)
  $entities.spline = Invoke-ComRetry { $scratch.ModelSpace.AddSpline($fitPoints, $startTangent, $endTangent) }
  [double[]]$textPoint = @(1100, 0, 0); $entities.text = Invoke-ComRetry { $scratch.ModelSpace.AddText('F020 TEXT', $textPoint, 20) }
  $entities.text = Set-RotationAndVerify $scratch $entities.text 0.25
  [double[]]$mtextPoint = @(1250, 0, 0); $entities.mtext = Invoke-ComRetry { $scratch.ModelSpace.AddMText($mtextPoint, 200, 'F020 MTEXT') }
  [double[]]$leaderPoints = @(1400, 0, 0, 1450, 50, 0, 1500, 50, 0); [double[]]$leaderAnnotationPoint = @(1500, 50, 0)
  $leaderAnnotation = Invoke-ComRetry { $scratch.ModelSpace.AddMText($leaderAnnotationPoint, 100, 'F020 LEADER') }
  Invoke-ComRetry { $leaderAnnotation.Layer = 'F020_AUX' } | Out-Null
  $entities.leader = Invoke-ComRetry { $scratch.ModelSpace.AddLeader($leaderPoints, $leaderAnnotation, 0) }
  [double[]]$dimA = @(1550, 0, 0); [double[]]$dimB = @(1650, 0, 0); [double[]]$dimText = @(1600, 50, 0)
  $entities.dimension = Invoke-ComRetry { $scratch.ModelSpace.AddDimAligned($dimA, $dimB, $dimText) }
  [double[]]$hatchPoints = @(1700, 0, 1800, 0, 1800, 100, 1700, 100)
  $hatchBoundary = Invoke-ComRetry { $scratch.ModelSpace.AddLightWeightPolyline($hatchPoints) }
  Invoke-ComRetry { $hatchBoundary.Closed = $true; $hatchBoundary.Layer = 'F020_AUX' } | Out-Null
  $boundaryHandle = [string](Invoke-ComRetry { $hatchBoundary.Handle })
  $hatchLisp = "(progn (vl-load-com) (setq f020:ms (vla-get-ModelSpace (vla-get-ActiveDocument (vlax-get-acad-object)))) (setq f020:h (vla-AddHatch f020:ms 0 `"SOLID`" :vlax-false 0)) (setq f020:loop (vlax-make-safearray vlax-vbObject '(0 . 0))) (vlax-safearray-put-element f020:loop 0 (vlax-ename->vla-object (handent `"$boundaryHandle`"))) (vla-AppendOuterLoop f020:h f020:loop) (vla-Evaluate f020:h) (vla-put-Layer f020:h `"F020_MATRIX`") (setvar `"USERS1`" (vla-get-Handle f020:h)) (princ))`n"
  Invoke-ComRetry { $scratch.SendCommand($hatchLisp) } | Out-Null; Wait-AcadIdle $scratch
  $hatchHandle = Get-ComRequiredString { $scratch.GetVariable('USERS1') } 'F020 hatch handle'
  $entities.hatch = Get-EntityByHandle $scratch $hatchHandle
  $blockLisp = "(progn (vl-load-com) (setq f020:doc (vla-get-ActiveDocument (vlax-get-acad-object))) (setq f020:block (vla-Add (vla-get-Blocks f020:doc) (vlax-3d-point '(0.0 0.0 0.0)) `"F020_BLOCK`")) (vla-AddLine f020:block (vlax-3d-point '(0.0 0.0 0.0)) (vlax-3d-point '(100.0 0.0 0.0))) (setq f020:insert (vla-InsertBlock (vla-get-ModelSpace f020:doc) (vlax-3d-point '(1900.0 0.0 0.0)) `"F020_BLOCK`" 1.5 0.5 1.0 0.25)) (vla-put-Layer f020:insert `"F020_MATRIX`") (setvar `"USERS2`" (vla-get-Handle f020:insert)) (princ))`n"
  Invoke-ComRetry { $scratch.SendCommand($blockLisp) } | Out-Null; Wait-AcadIdle $scratch
  $blockHandle = Get-ComRequiredString { $scratch.GetVariable('USERS2') } 'F020 block handle'
  $entities.blockRef = Get-EntityByHandle $scratch $blockHandle
  foreach ($family in @($entities.Keys)) {
    $entities[$family] = Set-CommonPropertiesAndVerify $scratch $entities[$family] 'F020_MATRIX'
  }
  Invoke-ComRetry { $scratch.Regen(1) } | Out-Null; Wait-AcadIdle $scratch
  $before = @($entities.GetEnumerator() | ForEach-Object { Get-EntityState $_.Value $_.Key })
  $sourceHandles = @($before | ForEach-Object { $_.handle })

  Invoke-MirrorSelection $scratch $sourceHandles $false
  $defaultEntities = @(Get-LayerEntities $scratch 'F020_MATRIX')
  $defaultStates = @(); $defaultChecks = @()
  foreach ($prior in $before) {
    $candidate = @($defaultEntities | Where-Object { [string]$_.ObjectName -eq $prior.objectName -and $sourceHandles -notcontains [string]$_.Handle })[0]
    if ($null -eq $candidate) { $defaultChecks += [ordered]@{ family = $prior.family; found = $false }; continue }
    $state = Get-EntityState $candidate $prior.family; $defaultStates += $state
    $geometryPassed = if ($prior.family -in @('text', 'mtext')) { Test-ReflectedBounds $prior.bounds $state.bounds 3 } elseif ($prior.family -in @('dimension', 'blockRef')) { Test-FamilySemantics $prior $state } else { Test-ReflectedBounds $prior.bounds $state.bounds }
    $defaultChecks += [ordered]@{
      family = $prior.family; found = $true; freshHandle = $state.handle -ne $prior.handle
      reflectedGeometry = $geometryPassed; propertiesPreserved = Test-Properties $prior $state
      familySemantics = Test-FamilySemantics $prior $state
    }
  }
  Invoke-ComRetry { $scratch.SendCommand("_.U`n") } | Out-Null; Wait-AcadIdle $scratch
  $defaultUndoStates = @($before | ForEach-Object { Get-EntityState (Invoke-ComRetry { $scratch.HandleToObject($_.handle) }) $_.family })
  $defaultUndoCount = @(Get-LayerEntities $scratch 'F020_MATRIX').Count

  Invoke-MirrorSelection $scratch $sourceHandles $true
  $yesStates = @(); $yesChecks = @()
  foreach ($prior in $before) {
    $state = Get-EntityState (Invoke-ComRetry { $scratch.HandleToObject($prior.handle) }) $prior.family; $yesStates += $state
    $geometryPassed = if ($prior.family -in @('text', 'mtext')) { Test-ReflectedBounds $prior.bounds $state.bounds 3 } elseif ($prior.family -in @('dimension', 'blockRef')) { Test-FamilySemantics $prior $state } else { Test-ReflectedBounds $prior.bounds $state.bounds }
    $yesChecks += [ordered]@{
      family = $prior.family; stableHandle = $state.handle -eq $prior.handle
      reflectedGeometry = $geometryPassed; propertiesPreserved = Test-Properties $prior $state
      familySemantics = Test-FamilySemantics $prior $state
    }
  }
  Invoke-ComRetry { $scratch.SendCommand("_.U`n") } | Out-Null; Wait-AcadIdle $scratch
  $yesUndoStates = @($before | ForEach-Object { Get-EntityState (Invoke-ComRetry { $scratch.HandleToObject($_.handle) }) $_.family })

  $tiltLine = New-Line $scratch 'F020_TILT_LINE' 100 0 200 0
  [double[]]$tiltTextPoint = @(300, 0, 0)
  $tiltText = Invoke-ComRetry { $scratch.ModelSpace.AddText('F020 TILTED', $tiltTextPoint, 20) }
  Invoke-ComRetry { $tiltText.Layer = 'F020_TILT_TEXT' } | Out-Null
  $tiltText = Set-RotationAndVerify $scratch $tiltText 0.25
  [double[]]$tiltBlockPoint = @(400, 0, 0)
  $tiltBlock = Invoke-ComRetry { $scratch.ModelSpace.InsertBlock($tiltBlockPoint, 'F020_BLOCK', 1.5, 0.5, 1.0, 0.25) }
  Invoke-ComRetry { $tiltBlock.Layer = 'F020_TILT_BLOCK' } | Out-Null
  Invoke-ComRetry { $scratch.Regen(1) } | Out-Null; Wait-AcadIdle $scratch
  $tiltBefore = [ordered]@{
    line = Get-EntityState $tiltLine 'line'
    text = Get-EntityState $tiltText 'text'
    blockRef = Get-EntityState $tiltBlock 'blockRef'
  }
  Invoke-MirrorSelection $scratch @($tiltBefore.line.handle, $tiltBefore.text.handle, $tiltBefore.blockRef.handle) $false '0,0' '100,100'
  $tiltAfter = [ordered]@{}
  foreach ($family in @('line', 'text', 'blockRef')) {
    $layerName = switch ($family) { 'line' { 'F020_TILT_LINE' } 'text' { 'F020_TILT_TEXT' } 'blockRef' { 'F020_TILT_BLOCK' } }
    $candidate = @(Get-LayerEntities $scratch $layerName | Where-Object { [string]$_.Handle -ne $tiltBefore[$family].handle })[0]
    if ($null -ne $candidate) { $tiltAfter[$family] = Get-EntityState $candidate $family }
  }
  $tiltLinePassed = $tiltAfter.line -and (Test-TiltReflectedPoint $tiltBefore.line.details.start $tiltAfter.line.details.start) -and
    (Test-TiltReflectedPoint $tiltBefore.line.details.end $tiltAfter.line.details.end)
  $tiltTextExpectedRotation = Get-NormalizedAngle (([Math]::PI / 2) - $tiltBefore.text.details.rotation)
  $tiltTextPassed = $tiltAfter.text -and $tiltAfter.text.details.text -eq $tiltBefore.text.details.text -and
    (Test-Near $tiltAfter.text.details.rotation $tiltTextExpectedRotation) -and
    $tiltAfter.text.details.alignment -eq $tiltBefore.text.details.alignment -and
    (Test-TiltReflectedBounds $tiltBefore.text.bounds $tiltAfter.text.bounds 3)
  $tiltBlockExpectedRotation = Get-NormalizedAngle (((3 * [Math]::PI) / 2) - $tiltBefore.blockRef.details.rotation)
  $tiltBlockPassed = $tiltAfter.blockRef -and (Test-TiltReflectedPoint $tiltBefore.blockRef.details.position $tiltAfter.blockRef.details.position) -and
    (Test-Near $tiltAfter.blockRef.details.rotation $tiltBlockExpectedRotation) -and
    (Test-Near $tiltAfter.blockRef.details.xScale (-$tiltBefore.blockRef.details.xScale)) -and
    (Test-Near $tiltAfter.blockRef.details.yScale $tiltBefore.blockRef.details.yScale) -and
    (Test-TiltReflectedBounds $tiltBefore.blockRef.bounds $tiltAfter.blockRef.bounds)
  $tiltedPassed = $tiltLinePassed -and $tiltTextPassed -and $tiltBlockPassed
  Invoke-ComRetry { $scratch.SendCommand("_.U`n") } | Out-Null; Wait-AcadIdle $scratch

  $editable = New-Line $scratch 'F020_EDIT' 0 2500 1000 2500
  $locked = New-Line $scratch 'F020_LOCKED' 0 2700 1000 2700
  Invoke-ComRetry { $lockedLayer.Lock = $true } | Out-Null
  $editableBefore = Get-EntityState $editable 'editable'; $lockedBefore = Get-EntityState $locked 'locked'
  Invoke-MirrorSelection $scratch @($editableBefore.handle, $lockedBefore.handle) $false
  $editableStates = @(Get-LayerEntities $scratch 'F020_EDIT' | ForEach-Object { Get-EntityState $_ 'editable' })
  $lockedAfter = Get-EntityState (Invoke-ComRetry { $scratch.HandleToObject($lockedBefore.handle) }) 'locked'
  $mixedPassed = $editableStates.Count -eq 2 -and @(Get-LayerEntities $scratch 'F020_LOCKED').Count -eq 1 -and
    (Test-Point $lockedAfter.bounds.min $lockedBefore.bounds.min) -and (Test-Point $lockedAfter.bounds.max $lockedBefore.bounds.max)

  $bad = New-Line $scratch 'F020_BAD' 0 3000 1000 3000
  $badBefore = Get-EntityState $bad 'coincident'
  $coincident = Invoke-RefusedCoincidentMirror $scratch $badBefore.handle $automationProcessId
  $badAfter = Get-EntityState (Invoke-ComRetry { $scratch.HandleToObject($badBefore.handle) }) 'coincident'
  $coincidentPassed = $coincident.cancelHelperExitCode -eq 0 -and $coincident.idleAfterCancel -and
    (Test-Point $badAfter.bounds.min $badBefore.bounds.min) -and (Test-Point $badAfter.bounds.max $badBefore.bounds.max)

  $defaultFailed = @($defaultChecks | Where-Object { -not $_.found -or -not $_.freshHandle -or -not $_.reflectedGeometry -or -not $_.propertiesPreserved -or -not $_.familySemantics })
  $yesFailed = @($yesChecks | Where-Object { -not $_.stableHandle -or -not $_.reflectedGeometry -or -not $_.propertiesPreserved -or -not $_.familySemantics })
  $undoDefaultPassed = $defaultUndoCount -eq 12
  for ($index = 0; $index -lt $before.Count; $index++) {
    $undoDefaultPassed = $undoDefaultPassed -and (Test-Point $defaultUndoStates[$index].bounds.min $before[$index].bounds.min) -and (Test-Point $defaultUndoStates[$index].bounds.max $before[$index].bounds.max)
  }
  $undoYesPassed = $true
  for ($index = 0; $index -lt $before.Count; $index++) {
    $undoYesPassed = $undoYesPassed -and (Test-Point $yesUndoStates[$index].bounds.min $before[$index].bounds.min) -and (Test-Point $yesUndoStates[$index].bounds.max $before[$index].bounds.max)
  }
  $status = if ($defaultEntities.Count -eq 24 -and $defaultChecks.Count -eq 12 -and $defaultFailed.Count -eq 0 -and $undoDefaultPassed -and
    $yesChecks.Count -eq 12 -and $yesFailed.Count -eq 0 -and $undoYesPassed -and $tiltedPassed -and $mixedPassed -and $coincidentPassed) { 'PASS' } else { 'FAIL' }
  if ($status -ne 'PASS') {
    Write-Host "[F-020] failed default=$(@($defaultFailed | ForEach-Object { `"$($_.family):$($_.reflectedGeometry)/$($_.propertiesPreserved)/$($_.familySemantics)`" }) -join ',') yes=$(@($yesFailed | ForEach-Object { `"$($_.family):$($_.reflectedGeometry)/$($_.propertiesPreserved)/$($_.familySemantics)`" }) -join ',') defaultUndo=$undoDefaultPassed yesUndo=$undoYesPassed tilted=$tiltedPassed mixed=$mixedPassed coincident=$coincidentPassed counts=$($defaultEntities.Count)/$($defaultChecks.Count)/$($yesChecks.Count)"
    foreach ($failedFamily in @($defaultFailed | ForEach-Object { $_.family })) {
      $failedBefore = @($before | Where-Object { $_.family -eq $failedFamily })[0]
      $failedAfter = @($defaultStates | Where-Object { $_.family -eq $failedFamily })[0]
      Write-Host "[F-020] detail $failedFamily before=$($failedBefore | ConvertTo-Json -Compress -Depth 5) after=$($failedAfter | ConvertTo-Json -Compress -Depth 5)"
    }
  }
  $result = [ordered]@{
    schemaVersion = 1; rowId = 'F-020'; benchmark = 'AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation'
    engine = 'Autodesk AutoCAD 2024 desktop COM'; engineVersion = Get-ComRequiredString { $acad.Version } 'Version'
    automationProcessId = $automationProcessId; automationProcessOwned = $owned
    workflow = 'MIRRTEXT=0; 12 native families with semantic fields; vertical axis default No/U and Yes/U; 45-degree line/text/block axis; mixed locked layer; coincident-axis refusal'
    mirrtext = [int](Invoke-ComRetry { $scratch.GetVariable('MIRRTEXT') })
    axisStart = @(1500, -500); axisEnd = @(1500, 1500); before = $before
    defaultNo = [ordered]@{ states = $defaultStates; checks = $defaultChecks; entityCount = $defaultEntities.Count; failed = $defaultFailed; undoCount = $defaultUndoCount; undoPassed = $undoDefaultPassed }
    eraseYes = [ordered]@{ states = $yesStates; checks = $yesChecks; failed = $yesFailed; undoPassed = $undoYesPassed }
    tiltedAxis = [ordered]@{ axisStart = @(0, 0); axisEnd = @(100, 100); before = $tiltBefore; after = $tiltAfter; linePassed = $tiltLinePassed; textPassed = $tiltTextPassed; blockPassed = $tiltBlockPassed; passed = $tiltedPassed }
    mixedLocked = [ordered]@{ editableStates = $editableStates; lockedBefore = $lockedBefore; lockedAfter = $lockedAfter; passed = $mixedPassed }
    coincidentAxis = [ordered]@{ before = $badBefore; after = $badAfter; commandResult = $coincident; passed = $coincidentPassed }
    status = $status
  }
} finally {
  if ($scratch) { try { Invoke-ComRetry { $scratch.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
}

if (-not $result) { throw 'F-020 standard AutoCAD matrix produced no result.' }
$result.userDocument = [ordered]@{ isolatedOwnedProcess = $owned; blankRestored = $owned }
$finalStatus = $result.status
$result | ConvertTo-Json -Depth 12
if ($finalStatus -ne 'PASS') { exit 1 }
