$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class F021WindowProcess {
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
  throw "AutoCAD did not return idle. CMDNAMES='$commands' LASTPROMPT='$prompt'"
}

function Set-TestView {
  param($Application)
  [double[]]$lower = @(-1000, -500, 0); [double[]]$upper = @(9000, 7000, 0)
  Invoke-ComRetry { $Application.ZoomWindow($lower, $upper) } | Out-Null
}

function New-Line {
  param($Document, [string]$Layer, [double]$StartX, [double]$StartY, [double]$EndX, [double]$EndY)
  [double[]]$start = @($StartX, $StartY, 0); [double[]]$end = @($EndX, $EndY, 0)
  $entity = Invoke-ComRetry { $Document.ModelSpace.AddLine($start, $end) }
  Invoke-ComRetry { $entity.Layer = $Layer; $entity.Color = 1; $entity.Lineweight = 50 } | Out-Null
  return $entity
}

function Get-Bounds {
  param($Entity)
  $minimum = $null; $maximum = $null
  Invoke-ComRetry { $Entity.GetBoundingBox([ref]$minimum, [ref]$maximum) } | Out-Null
  return [ordered]@{ min = @([double]$minimum[0], [double]$minimum[1]); max = @([double]$maximum[0], [double]$maximum[1]) }
}

function Get-Point2 { param($Value); return @([double]$Value[0], [double]$Value[1]) }

function Convert-FlatPoints {
  param($Values, [int]$Stride)
  $flat = @($Values); $points = @()
  for ($index = 0; $index + 1 -lt $flat.Count; $index += $Stride) { $points += ,@([double]$flat[$index], [double]$flat[$index + 1]) }
  return @($points)
}

function Get-EntityState {
  param($Entity)
  $objectName = [string](Invoke-ComRetry { $Entity.ObjectName })
  $details = [ordered]@{}
  switch ($objectName) {
    'AcDbLine' { $details.start = Get-Point2 (Invoke-ComRetry { $Entity.StartPoint }); $details.end = Get-Point2 (Invoke-ComRetry { $Entity.EndPoint }) }
    'AcDbPolyline' {
      $details.vertices = Convert-FlatPoints (Invoke-ComRetry { $Entity.Coordinates }) 2
      $details.closed = [bool](Invoke-ComRetry { $Entity.Closed })
      $details.bulges = @()
      for ($vertexIndex = 0; $vertexIndex -lt $details.vertices.Count; $vertexIndex += 1) {
        $details.bulges += [double](Invoke-ComRetry { $Entity.GetBulge($vertexIndex) })
      }
    }
    'AcDbCircle' { $details.center = Get-Point2 (Invoke-ComRetry { $Entity.Center }); $details.radius = [double](Invoke-ComRetry { $Entity.Radius }) }
    'AcDbArc' { $details.center = Get-Point2 (Invoke-ComRetry { $Entity.Center }); $details.radius = [double](Invoke-ComRetry { $Entity.Radius }); $details.startAngle = [double](Invoke-ComRetry { $Entity.StartAngle }); $details.endAngle = [double](Invoke-ComRetry { $Entity.EndAngle }) }
    'AcDbEllipse' { $details.center = Get-Point2 (Invoke-ComRetry { $Entity.Center }); $details.majorAxis = Get-Point2 (Invoke-ComRetry { $Entity.MajorAxis }); $details.radiusRatio = [double](Invoke-ComRetry { $Entity.RadiusRatio }) }
    'AcDbSpline' { $details.degree = [int](Invoke-ComRetry { $Entity.Degree }); $details.closed = [bool](Invoke-ComRetry { $Entity.Closed }); $details.controlPoints = Convert-FlatPoints (Invoke-ComRetry { $Entity.ControlPoints }) 3 }
  }
  return [ordered]@{
    objectName = $objectName; handle = [string](Invoke-ComRetry { $Entity.Handle }); layer = [string](Invoke-ComRetry { $Entity.Layer })
    color = [int](Invoke-ComRetry { $Entity.Color }); linetype = [string](Invoke-ComRetry { $Entity.Linetype }); lineweight = [int](Invoke-ComRetry { $Entity.Lineweight })
    bounds = Get-Bounds $Entity; details = $details
  }
}

function Get-LayerEntities {
  param($Document, [string]$Layer)
  $items = @(); foreach ($entity in $Document.ModelSpace) { if ([string]$entity.Layer -eq $Layer) { $items += $entity } }
  return @($items)
}

function Get-LineStates {
  param($Document)
  $states = @(); foreach ($entity in $Document.ModelSpace) {
    if ([string]$entity.ObjectName -ne 'AcDbLine') { continue }
    $state = Get-EntityState $entity
    $states += [ordered]@{ handle = $state.handle; layer = $state.layer; start = $state.details.start; end = $state.details.end }
  }
  return @($states)
}

function Test-Near { param([double]$Actual, [double]$Expected, [double]$Tolerance = 0.001); return [Math]::Abs($Actual - $Expected) -le $Tolerance }
function Test-Point { param($Actual, $Expected, [double]$Tolerance = 0.001); return (Test-Near $Actual[0] $Expected[0] $Tolerance) -and (Test-Near $Actual[1] $Expected[1] $Tolerance) }
function Count-Line {
  param($States, [double]$AX, [double]$AY, [double]$BX, [double]$BY, [string]$Layer = '0')
  return @($States | Where-Object { $_.layer -eq $Layer -and (Test-Point $_.start @($AX, $AY)) -and (Test-Point $_.end @($BX, $BY)) }).Count
}
function Test-Bounds { param($Actual, $Expected, [double]$Tolerance = 0.02); return (Test-Point $Actual.min $Expected.min $Tolerance) -and (Test-Point $Actual.max $Expected.max $Tolerance) }
function Test-Properties { param($Before, $After); return $Before.layer -eq $After.layer -and $Before.color -eq $After.color -and $Before.linetype -eq $After.linetype -and $Before.lineweight -eq $After.lineweight }

function Invoke-Offset {
  param($Document, [string]$Distance, [string]$PickPoint, [string]$SidePoint, [string]$Prefix = '', [string]$AfterSide = '_Exit')
  $script = "_.OFFSET`n$Prefix$Distance`n$PickPoint`n$SidePoint`n$AfterSide`n"
  Invoke-ComRetry { $Document.SendCommand($script) } | Out-Null
  Wait-AcadIdle $Document
}

function Invoke-FamilyOffset {
  param($Document, [string]$Layer, [string]$PickPoint, [string]$SidePoint, [string]$Distance = '20')
  $before = @(Get-LayerEntities $Document $Layer | ForEach-Object { Get-EntityState $_ })
  Invoke-ComRetry { $Document.SendCommand("_.OFFSET`n_Layer`n_Source`n$Distance`n$PickPoint`n$SidePoint`n_Exit`n") } | Out-Null
  Wait-AcadIdle $Document
  $after = @(Get-LayerEntities $Document $Layer | ForEach-Object { Get-EntityState $_ })
  $created = @($after | Where-Object { $before.handle -notcontains $_.handle })
  return [ordered]@{ before = $before; after = $after; created = $created }
}

$preExistingProcessIds = @(Get-Process -Name 'acad' -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.Id })
$acad = $null; $scratch = $null; $result = $null; $automationProcessId = 0; $owned = $false
try {
  $acad = Invoke-ComRetry { New-Object -ComObject AutoCAD.Application.24.3 } -TimeoutSeconds 30
  Invoke-ComRetry { $acad.Visible = $true } | Out-Null
  [uint32]$resolvedProcessId = 0
  [void][F021WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry { $acad.HWND }), [ref]$resolvedProcessId)
  $automationProcessId = [int]$resolvedProcessId
  $owned = $automationProcessId -gt 0 -and $preExistingProcessIds -notcontains $automationProcessId
  Write-Host "[F-021] automation-process pid=$automationProcessId owned=$owned"
  if (-not $owned) { throw 'F-021 refuses to use a pre-existing AutoCAD process.' }
  $scratch = if ([int](Invoke-ComRetry { $acad.Documents.Count }) -gt 0) { Invoke-ComRetry { $acad.ActiveDocument } } else { Invoke-ComRetry { $acad.Documents.Add() } }
  if ([string](Invoke-ComRetry { $scratch.FullName }) -or [int](Invoke-ComRetry { $scratch.ModelSpace.Count }) -ne 0) { throw 'F-021 refuses a saved or non-blank drawing.' }
  Invoke-ComRetry { $scratch.Activate() } | Out-Null
  foreach ($name in @('F021_SOURCE', 'F021_CURRENT', 'F021_LINE', 'F021_POLYLINE', 'F021_CIRCLE', 'F021_ARC', 'F021_ELLIPSE', 'F021_CLOSED', 'F021_BULGED', 'F021_CONCAVE', 'F021_ELLIPSE_INVALID', 'F021_LOCKED')) { $null = Invoke-ComRetry { $scratch.Layers.Add($name) } }
  Set-TestView $acad; Wait-AcadIdle $scratch

  $null = New-Line $scratch '0' 0 0 1000 0
  Invoke-Offset $scratch '200' '500,0' '500,300'
  $afterDistance = @(Get-LineStates $scratch)

  $null = New-Line $scratch '0' 0 1000 1000 1000
  Invoke-ComRetry { $scratch.SendCommand("_.OFFSET`n_Through`n500,1000`n1500,1375`n_Exit`n") } | Out-Null; Wait-AcadIdle $scratch
  $afterThrough = @(Get-LineStates $scratch)

  $null = New-Line $scratch '0' 0 2000 1000 2000
  Invoke-ComRetry { $scratch.SendCommand("_.OFFSET`n100`n500,2000`n_Multiple`n500,2500`n500,2500`n`n`n") } | Out-Null; Wait-AcadIdle $scratch
  $afterMultiple = @(Get-LineStates $scratch)

  $null = New-Line $scratch '0' 0 3000 1000 3000
  Invoke-ComRetry { $scratch.SendCommand("_.OFFSET`n_Erase`n_Yes`n250`n500,3000`n500,3500`n_Exit`n") } | Out-Null; Wait-AcadIdle $scratch
  $afterErase = @(Get-LineStates $scratch)

  $layerSource = New-Line $scratch 'F021_SOURCE' 0 4000 1000 4000
  Invoke-ComRetry { $scratch.ActiveLayer = $scratch.Layers.Item('F021_CURRENT') } | Out-Null
  Invoke-ComRetry { $scratch.SendCommand("_.OFFSET`n_Erase`n_No`n_Layer`n_Current`n150`n500,4000`n500,4500`n_Exit`n") } | Out-Null; Wait-AcadIdle $scratch
  $afterLayer = @(Get-LineStates $scratch)
  Invoke-ComRetry { $scratch.ActiveLayer = $scratch.Layers.Item('0') } | Out-Null

  $null = New-Line $scratch '0' 0 5000 1000 5000
  Invoke-ComRetry { $scratch.SendCommand("_.OFFSET`n100`n500,5000`n500,5500`n_Undo`n_Exit`n") } | Out-Null; Wait-AcadIdle $scratch
  $afterCommandUndo = @(Get-LineStates $scratch)

  $familySources = [ordered]@{}
  $familySources.line = New-Line $scratch 'F021_LINE' 0 0 1000 0
  [double[]]$polyPoints = @(2000, 0, 2100, 0, 2100, 100)
  $familySources.polyline = Invoke-ComRetry { $scratch.ModelSpace.AddLightWeightPolyline($polyPoints) }; Invoke-ComRetry { $familySources.polyline.Layer = 'F021_POLYLINE'; $familySources.polyline.Color = 1; $familySources.polyline.Lineweight = 50 } | Out-Null
  [double[]]$circleCenter = @(4000, 0, 0); $familySources.circle = Invoke-ComRetry { $scratch.ModelSpace.AddCircle($circleCenter, 100) }; Invoke-ComRetry { $familySources.circle.Layer = 'F021_CIRCLE'; $familySources.circle.Color = 1; $familySources.circle.Lineweight = 50 } | Out-Null
  [double[]]$arcCenter = @(6000, 0, 0); $familySources.arc = Invoke-ComRetry { $scratch.ModelSpace.AddArc($arcCenter, 100, 0, ([Math]::PI / 2)) }; Invoke-ComRetry { $familySources.arc.Layer = 'F021_ARC'; $familySources.arc.Color = 1; $familySources.arc.Lineweight = 50 } | Out-Null
  [double[]]$ellipseCenter = @(8000, 0, 0); [double[]]$ellipseAxis = @(200, 0, 0); $familySources.ellipse = Invoke-ComRetry { $scratch.ModelSpace.AddEllipse($ellipseCenter, $ellipseAxis, 0.5) }; Invoke-ComRetry { $familySources.ellipse.Layer = 'F021_ELLIPSE'; $familySources.ellipse.Color = 1; $familySources.ellipse.Lineweight = 50 } | Out-Null
  Invoke-ComRetry { $scratch.Regen(1) } | Out-Null; Set-TestView $acad

  $families = [ordered]@{}
  $families.line = Invoke-FamilyOffset $scratch 'F021_LINE' '500,0' '500,100'
  $families.polyline = Invoke-FamilyOffset $scratch 'F021_POLYLINE' '2050,0' '2050,50'
  $families.circle = Invoke-FamilyOffset $scratch 'F021_CIRCLE' '4100,0' '4200,0'
  $families.arc = Invoke-FamilyOffset $scratch 'F021_ARC' '6070.710678,70.710678' '6141.421356,141.421356'
  $families.ellipse = Invoke-FamilyOffset $scratch 'F021_ELLIPSE' '8200,0' '8250,0'

  [double[]]$closedPoints = @(3000, 1000, 3200, 1000, 3200, 1200, 3000, 1200)
  $closedSource = Invoke-ComRetry { $scratch.ModelSpace.AddLightWeightPolyline($closedPoints) }
  Invoke-ComRetry { $closedSource.Layer = 'F021_CLOSED'; $closedSource.Closed = $true; $closedSource.Color = 1; $closedSource.Lineweight = 50 } | Out-Null
  $closedProbe = Invoke-FamilyOffset $scratch 'F021_CLOSED' '3100,1000' '3100,1100'

  [double[]]$bulgedPoints = @(4900, 1000, 5100, 1000)
  $bulgedSource = Invoke-ComRetry { $scratch.ModelSpace.AddLightWeightPolyline($bulgedPoints) }
  Invoke-ComRetry { $bulgedSource.Layer = 'F021_BULGED'; $bulgedSource.SetBulge(0, 1.0); $bulgedSource.Color = 1; $bulgedSource.Lineweight = 50 } | Out-Null
  $bulgedProbe = Invoke-FamilyOffset $scratch 'F021_BULGED' '5000,900' '5000,850'

  [double[]]$concavePoints = @(0, 2000, 100, 2000, 100, 2040, 40, 2040, 40, 2100, 0, 2100)
  $concaveSource = Invoke-ComRetry { $scratch.ModelSpace.AddLightWeightPolyline($concavePoints) }
  Invoke-ComRetry { $concaveSource.Layer = 'F021_CONCAVE'; $concaveSource.Closed = $true; $concaveSource.Color = 1; $concaveSource.Lineweight = 50 } | Out-Null
  $concaveProbe = Invoke-FamilyOffset $scratch 'F021_CONCAVE' '10,2000' '10,2010' '60'

  [double[]]$invalidEllipseCenter = @(8000, 1000, 0); [double[]]$invalidEllipseAxis = @(200, 0, 0)
  $invalidEllipseSource = Invoke-ComRetry { $scratch.ModelSpace.AddEllipse($invalidEllipseCenter, $invalidEllipseAxis, 0.5) }
  Invoke-ComRetry { $invalidEllipseSource.Layer = 'F021_ELLIPSE_INVALID'; $invalidEllipseSource.Color = 1; $invalidEllipseSource.Lineweight = 50 } | Out-Null
  $invalidEllipseProbe = Invoke-FamilyOffset $scratch 'F021_ELLIPSE_INVALID' '8200,1000' '8000,1000' '60'

  $lockedLayer = Invoke-ComRetry { $scratch.Layers.Item('F021_LOCKED') }
  $lockedSource = New-Line $scratch 'F021_LOCKED' 0 6000 1000 6000
  Invoke-ComRetry { $lockedLayer.Lock = $true } | Out-Null; Set-TestView $acad
  Invoke-ComRetry { $scratch.SendCommand("_.OFFSET`n_Layer`n_Source`n100`n500,6000`n500,6200`n_Exit`n") } | Out-Null; Wait-AcadIdle $scratch
  $lockedStates = @(Get-LayerEntities $scratch 'F021_LOCKED' | ForEach-Object { Get-EntityState $_ })

  $distancePassed = (Count-Line $afterDistance 0 0 1000 0) -eq 1 -and (Count-Line $afterDistance 0 200 1000 200) -eq 1
  $throughPassed = (Count-Line $afterThrough 0 1000 1000 1000) -eq 1 -and (Count-Line $afterThrough 0 1375 1000 1375) -eq 1
  $multiplePassed = (Count-Line $afterMultiple 0 2000 1000 2000) -eq 1 -and (Count-Line $afterMultiple 0 2100 1000 2100) -eq 1 -and (Count-Line $afterMultiple 0 2200 1000 2200) -eq 1
  $erasePassed = (Count-Line $afterErase 0 3000 1000 3000) -eq 0 -and (Count-Line $afterErase 0 3250 1000 3250) -eq 1
  $layerPassed = (Count-Line $afterLayer 0 4000 1000 4000 'F021_SOURCE') -eq 1 -and (Count-Line $afterLayer 0 4150 1000 4150 'F021_CURRENT') -eq 1
  $commandUndoPassed = (Count-Line $afterCommandUndo 0 5000 1000 5000) -eq 1 -and (Count-Line $afterCommandUndo 0 5100 1000 5100) -eq 0

  $familyExpected = [ordered]@{
    line = [ordered]@{ type = 'AcDbLine'; bounds = [ordered]@{ min = @(0, 20); max = @(1000, 20) } }
    polyline = [ordered]@{ type = 'AcDbPolyline'; bounds = [ordered]@{ min = @(2000, 20); max = @(2080, 100) } }
    circle = [ordered]@{ type = 'AcDbCircle'; bounds = [ordered]@{ min = @(3880, -120); max = @(4120, 120) } }
    arc = [ordered]@{ type = 'AcDbArc'; bounds = [ordered]@{ min = @(6000, 0); max = @(6120, 120) } }
    ellipse = [ordered]@{ type = 'AcDbSpline'; bounds = [ordered]@{ min = @(7780, -120); max = @(8220, 120) } }
  }
  $familyChecks = @()
  foreach ($name in $familyExpected.Keys) {
    $entry = $families[$name]; $created = @($entry.created); $expected = $familyExpected[$name]
    $propertyPassed = if (-not $created.Count) { $false } elseif ($name -eq 'ellipse') {
      $entry.before[0].layer -eq $created[0].layer -and $entry.before[0].color -eq $created[0].color -and
        $entry.before[0].linetype -eq $created[0].linetype -and $created[0].lineweight -eq -1
    } else { Test-Properties $entry.before[0] $created[0] }
    $passed = $created.Count -eq 1 -and $created[0].objectName -eq $expected.type -and (Test-Bounds $created[0].bounds $expected.bounds 0.25) -and $propertyPassed
    $familyChecks += [ordered]@{ family = $name; createdCount = $created.Count; expectedType = $expected.type; actualType = if ($created.Count) { $created[0].objectName } else { $null }; expectedBounds = $expected.bounds; actualBounds = if ($created.Count) { $created[0].bounds } else { $null }; beforeProperties = if ($entry.before.Count) { [ordered]@{ layer = $entry.before[0].layer; color = $entry.before[0].color; linetype = $entry.before[0].linetype; lineweight = $entry.before[0].lineweight } } else { $null }; actualProperties = if ($created.Count) { [ordered]@{ layer = $created[0].layer; color = $created[0].color; linetype = $created[0].linetype; lineweight = $created[0].lineweight } } else { $null }; propertiesPreserved = $propertyPassed; passed = $passed }
  }
  $familiesPassed = @($familyChecks | Where-Object { -not $_.passed }).Count -eq 0
  $closedCreated = @($closedProbe.created)
  $closedPassed = $closedCreated.Count -eq 1 -and $closedCreated[0].objectName -eq 'AcDbPolyline' -and
    $closedCreated[0].details.closed -and (Test-Bounds $closedCreated[0].bounds ([ordered]@{ min = @(3020, 1020); max = @(3180, 1180) }) 0.01) -and
    @($closedCreated[0].details.bulges | Where-Object { -not (Test-Near $_ 0 0.000001) }).Count -eq 0 -and
    (Test-Properties $closedProbe.before[0] $closedCreated[0])
  $bulgedCreated = @($bulgedProbe.created)
  $bulgedPassed = $bulgedCreated.Count -eq 1 -and $bulgedCreated[0].objectName -eq 'AcDbPolyline' -and
    -not $bulgedCreated[0].details.closed -and (Test-Bounds $bulgedCreated[0].bounds ([ordered]@{ min = @(4880, 880); max = @(5120, 1000) }) 0.01) -and
    (Test-Near $bulgedCreated[0].details.bulges[0] 1 0.000001) -and (Test-Properties $bulgedProbe.before[0] $bulgedCreated[0])
  $concavePassed = @($concaveProbe.created).Count -eq 0 -and @($concaveProbe.after).Count -eq 1
  $ellipseCollapseCreated = @($invalidEllipseProbe.created | Sort-Object { $_.bounds.min[1] })
  $ellipseCollapsePassed = $ellipseCollapseCreated.Count -eq 2 -and
    @($ellipseCollapseCreated | Where-Object { $_.objectName -ne 'AcDbSpline' -or $_.details.closed }).Count -eq 0 -and
    (Test-Bounds $ellipseCollapseCreated[0].bounds ([ordered]@{ min = @(7861.435935, 959.887452); max = @(8138.564065, 1000) }) 0.25) -and
    (Test-Bounds $ellipseCollapseCreated[1].bounds ([ordered]@{ min = @(7861.435935, 1000); max = @(8138.564065, 1040.112548) }) 0.25) -and
    @($ellipseCollapseCreated | Where-Object { $_.layer -ne 'F021_ELLIPSE_INVALID' -or $_.color -ne 1 -or $_.linetype -ne 'ByLayer' -or $_.lineweight -ne -1 }).Count -eq 0
  $extendedPassed = $closedPassed -and $bulgedPassed -and $concavePassed -and $ellipseCollapsePassed
  $lockedBehavior = if ($lockedStates.Count -eq 2) { 'allowed-as-source' } elseif ($lockedStates.Count -eq 1) { 'refused' } else { 'unexpected' }
  $lockedPassed = $lockedBehavior -eq 'refused'
  $status = if ($distancePassed -and $throughPassed -and $multiplePassed -and $erasePassed -and $layerPassed -and $commandUndoPassed -and $familiesPassed -and $extendedPassed -and $lockedPassed) { 'PASS' } else { 'FAIL' }
  $result = [ordered]@{
    schemaVersion = 1; rowId = 'F-021'; benchmark = 'AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation'
    engine = 'Autodesk AutoCAD 2024 desktop COM'; engineVersion = [string](Invoke-ComRetry { $acad.Version })
    automationProcessId = $automationProcessId; automationProcessOwned = $owned; offsetLayer = 'Source-explicit'
    options = [ordered]@{ distance = $distancePassed; through = $throughPassed; multiple = $multiplePassed; erase = $erasePassed; layerCurrent = $layerPassed; commandUndo = $commandUndoPassed }
    familyChecks = $familyChecks; lockedLayer = [ordered]@{ behavior = $lockedBehavior; states = $lockedStates; passed = $lockedPassed }
    extendedChecks = [ordered]@{ closedPolyline = $closedPassed; bulgedPolyline = $bulgedPassed; concaveSelfIntersectionRefused = $concavePassed; ellipseInwardSplit = $ellipseCollapsePassed; passed = $extendedPassed }
    extendedProbes = [ordered]@{ closed = $closedProbe; bulged = $bulgedProbe; concave = $concaveProbe; ellipseInwardCollapse = $invalidEllipseProbe }
    status = $status
  }
} finally {
  if ($scratch) { try { Invoke-ComRetry { $scratch.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
}

if (-not $result) { throw 'F-021 standard AutoCAD matrix produced no result.' }
$result.userDocument = [ordered]@{ isolatedOwnedProcess = $owned; blankRestored = $owned }
$finalStatus = $result.status
$result | ConvertTo-Json -Depth 12
if ($finalStatus -ne 'PASS') { exit 1 }
