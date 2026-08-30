param(
  [Parameter(Mandatory = $true)][string]$PidPath,
  [Parameter(Mandatory = $true)][string]$OwnershipToken,
  [Parameter(Mandatory = $true)][string]$DxfOutputPath,
  [Parameter(Mandatory = $true)][string]$ParametricDxfInputPath,
  [Parameter(Mandatory = $true)][string]$ParametricDxfOutputPath
)

$ErrorActionPreference = 'Stop'
$DxfOutputPath = [IO.Path]::GetFullPath($DxfOutputPath)
if ([IO.Path]::GetExtension($DxfOutputPath) -ine '.dxf' -or (Test-Path -LiteralPath $DxfOutputPath)) { throw 'F-024 DXF output must be a new .dxf path.' }
$ParametricDxfInputPath = [IO.Path]::GetFullPath($ParametricDxfInputPath)
if ([IO.Path]::GetExtension($ParametricDxfInputPath) -ine '.dxf' -or -not (Test-Path -LiteralPath $ParametricDxfInputPath -PathType Leaf)) { throw 'F-024 parametric source must be an existing .dxf path.' }
$ParametricDxfOutputPath = [IO.Path]::GetFullPath($ParametricDxfOutputPath)
if ([IO.Path]::GetExtension($ParametricDxfOutputPath) -ine '.dxf' -or (Test-Path -LiteralPath $ParametricDxfOutputPath)) { throw 'F-024 parametric DXF output must be a new .dxf path.' }

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class F024WindowProcess {
  public delegate bool EnumWindowProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")]
  private static extern bool EnumChildWindows(IntPtr hWnd, EnumWindowProc callback, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder className, int maximumCount);
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  public static IntPtr FindModelViewport(IntPtr root, int expectedWidth, int expectedHeight) {
    IntPtr result = IntPtr.Zero; double bestScore = double.MaxValue; long bestArea = 0;
    EnumChildWindows(root, delegate(IntPtr child, IntPtr unused) {
      var className = new System.Text.StringBuilder(256);
      GetClassName(child, className, className.Capacity);
      if (className.ToString() != "ACADDM_CHILD_DXGI_FLIP_MODE_VIEW_CLASS") return true;
      RECT rect; if (!GetWindowRect(child, out rect)) return true;
      int width = rect.Right - rect.Left; int height = rect.Bottom - rect.Top;
      if (width <= 0 || height <= 0) return true;
      long area = (long)width * height;
      double expectedAspect = expectedHeight > 0 ? (double)expectedWidth / expectedHeight : 0;
      double aspect = (double)width / height;
      double score = Math.Abs(aspect - expectedAspect) + Math.Abs(width - expectedWidth) / (double)Math.Max(1, expectedWidth) + Math.Abs(height - expectedHeight) / (double)Math.Max(1, expectedHeight);
      if (score < bestScore || (Math.Abs(score - bestScore) < 0.000001 && area > bestArea)) { bestScore = score; bestArea = area; result = child; }
      return true;
    }, IntPtr.Zero);
    return result;
  }
}
'@

function Invoke-ComRetry {
  param([Parameter(Mandatory = $true)][scriptblock]$Action, [int]$TimeoutSeconds = 20)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    try { return (& $Action) } catch { if ([DateTime]::UtcNow -ge $deadline) { throw }; Start-Sleep -Milliseconds 150 }
  } while ($true)
}

function Invoke-NonNullCom {
  param([Parameter(Mandatory = $true)][scriptblock]$Action, [string]$Label, [int]$TimeoutSeconds = 20)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    try { $value = & $Action; if ($null -ne $value) { return $value } } catch { if ([DateTime]::UtcNow -ge $deadline) { throw } }
    if ([DateTime]::UtcNow -ge $deadline) { throw "$Label remained null for $TimeoutSeconds seconds." }
    Start-Sleep -Milliseconds 150
  } while ($true)
}

function Wait-AcadIdle {
  param([Parameter(Mandatory = $true)]$Document, [int]$TimeoutSeconds = 45)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 100
    try { if ([string]::IsNullOrWhiteSpace([string]$Document.GetVariable('CMDNAMES')) -and [int]$Document.GetVariable('CMDACTIVE') -eq 0) { return } } catch {}
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "AutoCAD did not return idle. CMDNAMES='$($Document.GetVariable('CMDNAMES'))' LASTPROMPT='$($Document.GetVariable('LASTPROMPT'))'"
}

function Wait-AcadCommandMarker {
  param([Parameter(Mandatory = $true)]$Document, [Parameter(Mandatory = $true)][string]$Marker, [int]$TimeoutSeconds = 45)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 100
    try {
      if ([string]$Document.GetVariable('USERS1') -eq $Marker) { Wait-AcadIdle $Document $TimeoutSeconds; return }
    } catch {}
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "AutoCAD did not complete command marker '$Marker'. CMDNAMES='$($Document.GetVariable('CMDNAMES'))' LASTPROMPT='$($Document.GetVariable('LASTPROMPT'))'"
}

function Write-Stage {
  param([Parameter(Mandatory = $true)][string]$Name)
  Write-Host "[F-024] stage=$Name"
}

function Get-Point2 { param($Value); return @([double]$Value[0], [double]$Value[1]) }
function Convert-FlatPoints { param($Values); $flat = @($Values); $points = @(); for ($index = 0; $index + 1 -lt $flat.Count; $index += 2) { $points += ,@([double]$flat[$index], [double]$flat[$index + 1]) }; return @($points) }
function Convert-FlatPoints3 { param($Values); $flat = @($Values); $points = @(); for ($index = 0; $index + 2 -lt $flat.Count; $index += 3) { $points += ,@([double]$flat[$index], [double]$flat[$index + 1]) }; return @($points) }

function Get-EntityState {
  param($Entity)
  $objectName = [string](Invoke-ComRetry { $Entity.ObjectName })
  $details = [ordered]@{}
  switch ($objectName) {
    'AcDbLine' { $details.start = Get-Point2 (Invoke-NonNullCom { $Entity.StartPoint } 'Line StartPoint'); $details.end = Get-Point2 (Invoke-NonNullCom { $Entity.EndPoint } 'Line EndPoint') }
    'AcDbRay' { $details.basePoint = Get-Point2 (Invoke-NonNullCom { $Entity.BasePoint } 'Ray BasePoint'); $details.secondPoint = Get-Point2 (Invoke-NonNullCom { $Entity.SecondPoint } 'Ray SecondPoint') }
    'AcDbXline' { $details.basePoint = Get-Point2 (Invoke-NonNullCom { $Entity.BasePoint } 'Xline BasePoint'); $details.secondPoint = Get-Point2 (Invoke-NonNullCom { $Entity.SecondPoint } 'Xline SecondPoint') }
    'AcDbArc' { $details.center = Get-Point2 (Invoke-NonNullCom { $Entity.Center } 'Arc Center'); $details.radius = [double](Invoke-ComRetry { $Entity.Radius }); $details.startAngle = [double](Invoke-ComRetry { $Entity.StartAngle }); $details.endAngle = [double](Invoke-ComRetry { $Entity.EndAngle }) }
    'AcDbCircle' { $details.center = Get-Point2 (Invoke-NonNullCom { $Entity.Center } 'Circle Center'); $details.radius = [double](Invoke-ComRetry { $Entity.Radius }) }
    'AcDbEllipse' {
      $details.center = Get-Point2 (Invoke-NonNullCom { $Entity.Center } 'Ellipse Center')
      $details.majorAxis = Get-Point2 (Invoke-NonNullCom { $Entity.MajorAxis } 'Ellipse MajorAxis')
      $details.radiusRatio = [double](Invoke-ComRetry { $Entity.RadiusRatio })
      $details.startParameter = [double](Invoke-ComRetry { $Entity.StartParameter })
      $details.endParameter = [double](Invoke-ComRetry { $Entity.EndParameter })
    }
    'AcDbSpline' {
      $details.degree = [int](Invoke-ComRetry { $Entity.Degree })
      $details.closed = [bool](Invoke-ComRetry { $Entity.Closed })
      $details.controlPoints = Convert-FlatPoints3 (Invoke-NonNullCom { $Entity.ControlPoints } 'Spline ControlPoints')
      $splineFitPoints = Invoke-ComRetry { $Entity.FitPoints }
      $details.fitPoints = if ($null -eq $splineFitPoints) { @() } else { Convert-FlatPoints3 $splineFitPoints }
      $details.knots = @((Invoke-NonNullCom { $Entity.Knots } 'Spline Knots') | ForEach-Object { [double]$_ })
      $splineWeights = Invoke-ComRetry { $Entity.Weights }
      $details.weights = if ($null -eq $splineWeights) { @() } else { @($splineWeights | ForEach-Object { [double]$_ }) }
    }
    'AcDbPolyline' {
      $details.vertices = Convert-FlatPoints (Invoke-NonNullCom { $Entity.Coordinates } 'Polyline Coordinates')
      $details.closed = [bool](Invoke-ComRetry { $Entity.Closed })
      $details.bulges = @(); $details.widths = @()
      for ($index = 0; $index -lt $details.vertices.Count; $index += 1) {
        $details.bulges += [double](Invoke-ComRetry { $Entity.GetBulge($index) })
        [double]$startWidth = 0; [double]$endWidth = 0
        Invoke-ComRetry { $Entity.GetWidth($index, [ref]$startWidth, [ref]$endWidth) } | Out-Null
        $details.widths += ,@($startWidth, $endWidth)
      }
    }
  }
  return [ordered]@{ objectName = $objectName; handle = [string](Invoke-ComRetry { $Entity.Handle }); layer = [string](Invoke-ComRetry { $Entity.Layer }); color = [int](Invoke-ComRetry { $Entity.Color }); lineweight = [int](Invoke-ComRetry { $Entity.Lineweight }); details = $details }
}

function Get-LayerStates {
  param($Document, [string]$Layer)
  $states = @(); $count = [int](Invoke-ComRetry { $Document.ModelSpace.Count })
  for ($index = 0; $index -lt $count; $index += 1) {
    $entity = Invoke-ComRetry { $Document.ModelSpace.Item($index) }
    if ([string](Invoke-ComRetry { $entity.Layer }) -ne $Layer) { continue }
    try { $states += Get-EntityState $entity }
    catch {
      # FILLET can leave an erased COM wrapper in ModelSpace until the next
      # database compaction. It still exposes Layer/ObjectName but its geometry
      # properties are null. Skip only that tombstone shape; fixture count and
      # exact type checks below still fail closed if a live result is missing.
      if ($_.Exception.Message -notmatch 'remained null') { throw }
    }
  }
  return @($states)
}

function Get-LayerStatesAtLeast {
  param($Document, [string]$Layer, [int]$MinimumCount, [int]$TimeoutSeconds = 5)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds); $states = @()
  do {
    $states = @(Get-LayerStates $Document $Layer)
    if ($states.Count -ge $MinimumCount) { return @($states) }
    Invoke-ComRetry { $Document.Regen(1) } | Out-Null; Start-Sleep -Milliseconds 200
  } while ([DateTime]::UtcNow -lt $deadline)
  return @($states)
}

function Get-ModelScreenPoint {
  param($Document, [IntPtr]$ViewportHandle, [double]$WorldX, [double]$WorldY)
  $rect = New-Object F024WindowProcess+RECT
  if (-not [F024WindowProcess]::GetWindowRect($ViewportHandle, [ref]$rect)) { throw 'F-024 could not read the AutoCAD model viewport rectangle.' }
  $screenSize = @(Invoke-NonNullCom { $Document.GetVariable('SCREENSIZE') } 'SCREENSIZE'); $viewCenter = @(Invoke-NonNullCom { $Document.GetVariable('VIEWCTR') } 'VIEWCTR'); $viewHeight = [double](Invoke-NonNullCom { $Document.GetVariable('VIEWSIZE') } 'VIEWSIZE')
  $viewportWidth = $rect.Right - $rect.Left; $viewportHeight = $rect.Bottom - $rect.Top
  if ($screenSize.Count -lt 2 -or $viewCenter.Count -lt 2 -or $viewportWidth -ne [int][Math]::Round([double]$screenSize[0]) -or $viewportHeight -ne [int][Math]::Round([double]$screenSize[1]) -or -not ($viewHeight -gt 0)) { throw "F-024 viewport/SCREENSIZE mismatch: rect=$viewportWidth x $viewportHeight screen=$($screenSize -join 'x') viewHeight=$viewHeight" }
  $pixelsPerWorldUnit = [double]$screenSize[1] / $viewHeight
  return [ordered]@{ x = [int][Math]::Round($rect.Left + [double]$screenSize[0] / 2 + ($WorldX - [double]$viewCenter[0]) * $pixelsPerWorldUnit); y = [int][Math]::Round($rect.Top + [double]$screenSize[1] / 2 - ($WorldY - [double]$viewCenter[1]) * $pixelsPerWorldUnit); world = @([double]$WorldX, [double]$WorldY); viewport = @($rect.Left, $rect.Top, $rect.Right, $rect.Bottom); screenSize = @([int][Math]::Round([double]$screenSize[0]), [int][Math]::Round([double]$screenSize[1])); viewCenter = @([double]$viewCenter[0], [double]$viewCenter[1]); viewHeight = $viewHeight }
}

function New-Line {
  param($Document, [string]$Layer, [double]$StartX, [double]$StartY, [double]$EndX, [double]$EndY)
  [double[]]$start = @($StartX, $StartY, 0); [double[]]$end = @($EndX, $EndY, 0)
  $entity = Invoke-ComRetry { $Document.ModelSpace.AddLine($start, $end) }; Invoke-ComRetry { $entity.Layer = $Layer; $entity.Color = 1; $entity.Lineweight = 50 } | Out-Null
  return $entity
}

function New-Ray {
  param($Document, [string]$Layer, [double]$BaseX, [double]$BaseY, [double]$SecondX, [double]$SecondY)
  [double[]]$base = @($BaseX, $BaseY, 0); [double[]]$second = @($SecondX, $SecondY, 0)
  $entity = Invoke-ComRetry { $Document.ModelSpace.AddRay($base, $second) }; Invoke-ComRetry { $entity.Layer = $Layer; $entity.Color = 1; $entity.Lineweight = 50 } | Out-Null
  return $entity
}

function New-Xline {
  param($Document, [string]$Layer, [double]$BaseX, [double]$BaseY, [double]$SecondX, [double]$SecondY)
  [double[]]$base = @($BaseX, $BaseY, 0); [double[]]$second = @($SecondX, $SecondY, 0)
  $entity = Invoke-ComRetry { $Document.ModelSpace.AddXline($base, $second) }; Invoke-ComRetry { $entity.Layer = $Layer; $entity.Color = 1; $entity.Lineweight = 50 } | Out-Null
  return $entity
}

function New-Polyline {
  param($Document, [string]$Layer, [double[]]$Coordinates, [bool]$Closed = $false, [hashtable]$Bulges = @{})
  $entity = Invoke-ComRetry { $Document.ModelSpace.AddLightWeightPolyline($Coordinates) }
  Invoke-ComRetry { $entity.Layer = $Layer; $entity.Color = 1; $entity.Lineweight = 50; $entity.Closed = $Closed } | Out-Null
  foreach ($entry in $Bulges.GetEnumerator()) { Invoke-ComRetry { $entity.SetBulge([int]$entry.Key, [double]$entry.Value) } | Out-Null }
  return $entity
}

function New-Circle {
  param($Document, [string]$Layer, [double]$CenterX, [double]$CenterY, [double]$Radius)
  [double[]]$center = @($CenterX, $CenterY, 0)
  $entity = Invoke-ComRetry { $Document.ModelSpace.AddCircle($center, $Radius) }; Invoke-ComRetry { $entity.Layer = $Layer; $entity.Color = 1; $entity.Lineweight = 50 } | Out-Null
  return $entity
}

function New-Arc {
  param($Document, [string]$Layer, [double]$CenterX, [double]$CenterY, [double]$Radius, [double]$StartAngle, [double]$EndAngle)
  [double[]]$center = @($CenterX, $CenterY, 0)
  $entity = Invoke-ComRetry { $Document.ModelSpace.AddArc($center, $Radius, $StartAngle, $EndAngle) }; Invoke-ComRetry { $entity.Layer = $Layer; $entity.Color = 1; $entity.Lineweight = 50 } | Out-Null
  return $entity
}

function New-Ellipse {
  param($Document, [string]$Layer, [double]$CenterX, [double]$CenterY, [double]$MajorX, [double]$MajorY, [double]$Ratio)
  [double[]]$center = @($CenterX, $CenterY, 0); [double[]]$major = @($MajorX, $MajorY, 0)
  $entity = Invoke-ComRetry { $Document.ModelSpace.AddEllipse($center, $major, $Ratio) }; Invoke-ComRetry { $entity.Layer = $Layer; $entity.Color = 1; $entity.Lineweight = 50 } | Out-Null
  return $entity
}

function New-Spline {
  param($Document, [string]$Layer, [double[]]$FitPoints, [double[]]$StartTangent, [double[]]$EndTangent)
  $entity = Invoke-ComRetry { $Document.ModelSpace.AddSpline($FitPoints, $StartTangent, $EndTangent) }; Invoke-ComRetry { $entity.Layer = $Layer; $entity.Color = 1; $entity.Lineweight = 50 } | Out-Null
  return $entity
}

function Invoke-FilletPair {
  param($Document, $First, [double]$FirstX, [double]$FirstY, $Second, [double]$SecondX, [double]$SecondY, [double]$Radius, [bool]$Trim = $true)
  $firstHandle = [string](Invoke-ComRetry { $First.Handle }); $secondHandle = [string](Invoke-ComRetry { $Second.Handle }); $trimMode = if ($Trim) { 1 } else { 0 }
  $firstSelection = if ($firstHandle -eq $secondHandle) { "(list $FirstX $FirstY 0.0)" } else { "(list (handent `"$firstHandle`") (list $FirstX $FirstY 0.0))" }
  $secondSelection = if ($firstHandle -eq $secondHandle) { "(list $SecondX $SecondY 0.0)" } else { "(list (handent `"$secondHandle`") (list $SecondX $SecondY 0.0))" }
  $marker = [Guid]::NewGuid().ToString('N')
  $lisp = "(progn (command `"_.ZOOM`" `"_Extents`") (setvar `"FILLETRAD`" $Radius) (setvar `"TRIMMODE`" $trimMode) (command `"_.FILLET`" $firstSelection $secondSelection) (setvar `"USERS1`" `"$marker`") (princ))`n"
  Invoke-ComRetry { $Document.SendCommand($lisp) } | Out-Null; Wait-AcadCommandMarker $Document $marker; Invoke-ComRetry { $Document.Regen(1) } | Out-Null; Start-Sleep -Milliseconds 500
}

function Invoke-FilletRejectedPair {
  param($Acad, $Document, [int]$ProcessId, [string]$EscapeHelperPath, $First, [double]$FirstX, [double]$FirstY, $Second, [double]$SecondX, [double]$SecondY, [double]$Radius)
  $firstHandle = [string](Invoke-ComRetry { $First.Handle }); $secondHandle = [string](Invoke-ComRetry { $Second.Handle })
  $firstSelection = "(list (handent `"$firstHandle`") (list $FirstX $FirstY 0.0))"
  $secondSelection = "(list (handent `"$secondHandle`") (list $SecondX $SecondY 0.0))"
  $lisp = "(progn (setvar `"FILLETRAD`" $Radius) (setvar `"TRIMMODE`" 1) (command `"_.FILLET`" $firstSelection $secondSelection) (princ))`n"
  $ownedWindowHandle = [string][int64](Invoke-ComRetry { $Acad.HWND }); $escapeHelpers = @()
  try {
    foreach ($delay in @(1000, 3000)) {
      $escapeHelpers += Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$EscapeHelperPath,'-MainWindowHandle',$ownedWindowHandle,'-ExpectedProcessId',([string]$ProcessId),'-Action','Escape','-DelayMilliseconds',([string]$delay)) -WindowStyle Hidden -PassThru
    }
    Invoke-ComRetry { $Document.SendCommand($lisp) } | Out-Null
    $escapeExitCodes = @()
    foreach ($escapeHelper in $escapeHelpers) {
      if (-not $escapeHelper.WaitForExit(15000)) { throw 'F-024 rejected-pair Escape watchdog did not exit.' }
      $escapeExitCodes += $escapeHelper.ExitCode
    }
    if (@($escapeExitCodes | Where-Object { $_ -eq 0 }).Count -eq 0) { throw "F-024 rejected-pair Escape watchdogs both failed: $($escapeExitCodes -join ',')." }
  } finally {
    $escapeCleanupErrors = @()
    foreach ($escapeHelper in $escapeHelpers) { try { Stop-InputHelper $escapeHelper 'F-024 rejected-pair Escape watchdog' } catch { $escapeCleanupErrors += $_.Exception.Message } }
    if ($escapeCleanupErrors.Count -gt 0) { throw "F-024 rejected-pair Escape cleanup failed: $($escapeCleanupErrors -join '; ')." }
  }
  Wait-AcadIdle $Document; Invoke-ComRetry { $Document.Regen(1) } | Out-Null; Start-Sleep -Milliseconds 500
}

function Invoke-FilletPolyline {
  param($Document, $Polyline, [double]$Radius, [bool]$Trim = $true, [int]$FilletPolyArc = 1)
  $handle = [string](Invoke-ComRetry { $Polyline.Handle }); $trimMode = if ($Trim) { 1 } else { 0 }
  $lisp = "(progn (setvar `"FILLETRAD`" $Radius) (setvar `"TRIMMODE`" $trimMode) (setvar `"FILLETPOLYARC`" $FilletPolyArc) (command `"_.FILLET`" `"_Polyline`" (handent `"$handle`")) (princ))`n"
  Invoke-ComRetry { $Document.SendCommand($lisp) } | Out-Null; Wait-AcadIdle $Document
}

function Invoke-FilletMultiple {
  param($Document, [object[]]$Pairs, [double]$Radius, [bool]$Trim = $true, [bool]$UndoLast = $false)
  $trimMode = if ($Trim) { 1 } else { 0 }
  $selections = @()
  foreach ($pair in $Pairs) {
    $firstHandle = [string](Invoke-ComRetry { $pair.first.Handle }); $secondHandle = [string](Invoke-ComRetry { $pair.second.Handle })
    $selections += "(list (handent `"$firstHandle`") (list $($pair.firstX) $($pair.firstY) 0.0))"
    $selections += "(list (handent `"$secondHandle`") (list $($pair.secondX) $($pair.secondY) 0.0))"
  }
  $ending = if ($UndoLast) { ' "_Undo" ""' } else { ' ""' }
  $lisp = "(progn (setvar `"FILLETRAD`" $Radius) (setvar `"TRIMMODE`" $trimMode) (command `"_.FILLET`" `"_Multiple`" $($selections -join ' ')$ending) (princ))`n"
  Invoke-ComRetry { $Document.SendCommand($lisp) } | Out-Null
  Wait-AcadIdle $Document
}

function Test-Near { param([double]$Actual, [double]$Expected, [double]$Tolerance = 0.001); return [Math]::Abs($Actual - $Expected) -le $Tolerance }
function Test-Point { param($Actual, $Expected, [double]$Tolerance = 0.001); return (Test-Near -Actual $Actual[0] -Expected $Expected[0] -Tolerance $Tolerance) -and (Test-Near -Actual $Actual[1] -Expected $Expected[1] -Tolerance $Tolerance) }
function Test-Vertices { param($Actual, $Expected); if ($Actual.Count -ne $Expected.Count) { return $false }; for ($index = 0; $index -lt $Expected.Count; $index += 1) { if (-not (Test-Point -Actual $Actual[$index] -Expected $Expected[$index])) { return $false } }; return $true }
function Test-Numbers { param($Actual, $Expected, [double]$Tolerance = 0.001); if ($Actual.Count -ne $Expected.Count) { return $false }; for ($index = 0; $index -lt $Expected.Count; $index += 1) { if (-not (Test-Near -Actual ([double]$Actual[$index]) -Expected ([double]$Expected[$index]) -Tolerance $Tolerance)) { return $false } }; return $true }
function Test-NormalizedNumbers { param($Actual, $Expected, [double]$Tolerance = 0.000001); if ($Actual.Count -eq 0 -or $Expected.Count -eq 0 -or [Math]::Abs([double]$Actual[0]) -le 0.000000000001 -or [Math]::Abs([double]$Expected[0]) -le 0.000000000001) { return $false }; $actualNormalized = @($Actual | ForEach-Object { [double]$_ / [double]$Actual[0] }); $expectedNormalized = @($Expected | ForEach-Object { [double]$_ / [double]$Expected[0] }); return Test-Numbers -Actual $actualNormalized -Expected $expectedNormalized -Tolerance $Tolerance }
function Test-SplineWeights { param($Actual, $Expected); $actualValues = if ($null -eq $Actual) { @() } else { @($Actual) }; $expectedValues = @($Expected); if ($actualValues.Count -eq 0) { return $expectedValues.Count -gt 0 -and @($expectedValues | Where-Object { -not (Test-Near -Actual ([double]$_) -Expected 1 -Tolerance 0.000001) }).Count -eq 0 }; return Test-NormalizedNumbers -Actual $actualValues -Expected $expectedValues }
function Stop-InputHelper {
  param($Process, [string]$Label)
  if ($null -eq $Process) { return }
  $processId = [int]$Process.Id
  $Process.Refresh()
  if (-not $Process.HasExited) {
    Stop-Process -Id $processId -Force -ErrorAction Stop
    if (-not $Process.WaitForExit(5000)) { throw "$Label PID $processId did not terminate after Stop-Process." }
  }
  if (Get-Process -Id $processId -ErrorAction SilentlyContinue) { throw "$Label PID $processId remains alive after cleanup." }
}
function Test-Angle { param([double]$Actual, [double]$Expected, [double]$Tolerance = 0.000001); $turn = [Math]::PI * 2; $actualNormalized = (($Actual % $turn) + $turn) % $turn; $expectedNormalized = (($Expected % $turn) + $turn) % $turn; return Test-Near -Actual $actualNormalized -Expected $expectedNormalized -Tolerance $Tolerance }
function Test-EntityCommon { param($Entity, [string]$ObjectName, [string]$Layer, [int]$Color, [int]$Lineweight); return $Entity.objectName -eq $ObjectName -and $Entity.layer -eq $Layer -and [regex]::IsMatch([string]$Entity.handle, '^[A-F0-9]+$') -and $Entity.color -eq $Color -and $Entity.lineweight -eq $Lineweight }
function Test-LineState { param($Entity, [string]$Layer, $ExpectedStart, $ExpectedEnd, [int]$Lineweight = 50); return (Test-EntityCommon $Entity 'AcDbLine' $Layer 1 $Lineweight) -and (Test-Point -Actual $Entity.details.start -Expected $ExpectedStart -Tolerance 0.000001) -and (Test-Point -Actual $Entity.details.end -Expected $ExpectedEnd -Tolerance 0.000001) }
function Test-CircleState { param($Entity, [string]$Layer, $ExpectedCenter, [double]$ExpectedRadius, [int]$Lineweight = 50); return (Test-EntityCommon $Entity 'AcDbCircle' $Layer 1 $Lineweight) -and (Test-Point -Actual $Entity.details.center -Expected $ExpectedCenter -Tolerance 0.000001) -and (Test-Near -Actual $Entity.details.radius -Expected $ExpectedRadius -Tolerance 0.000001) }
function Test-ArcState { param($Entity, [string]$Layer, $ExpectedCenter, [double]$ExpectedRadius, [double]$ExpectedStartAngle, [double]$ExpectedEndAngle, [int]$Lineweight = 50); return (Test-EntityCommon $Entity 'AcDbArc' $Layer 1 $Lineweight) -and (Test-Point -Actual $Entity.details.center -Expected $ExpectedCenter -Tolerance 0.000001) -and (Test-Near -Actual $Entity.details.radius -Expected $ExpectedRadius -Tolerance 0.000001) -and (Test-Angle -Actual $Entity.details.startAngle -Expected $ExpectedStartAngle) -and (Test-Angle -Actual $Entity.details.endAngle -Expected $ExpectedEndAngle) }
function Test-EllipseState { param($Entity, [string]$Layer, $ExpectedCenter, $ExpectedMajorAxis, [double]$ExpectedRatio, [double]$ExpectedStart, [double]$ExpectedEnd); return (Test-EntityCommon $Entity 'AcDbEllipse' $Layer 1 50) -and (Test-Point -Actual $Entity.details.center -Expected $ExpectedCenter -Tolerance 0.000001) -and (Test-Point -Actual $Entity.details.majorAxis -Expected $ExpectedMajorAxis -Tolerance 0.000001) -and (Test-Near -Actual $Entity.details.radiusRatio -Expected $ExpectedRatio -Tolerance 0.000001) -and (Test-Near -Actual $Entity.details.startParameter -Expected $ExpectedStart -Tolerance 0.000001) -and (Test-Near -Actual $Entity.details.endParameter -Expected $ExpectedEnd -Tolerance 0.000001) }
function Test-SplineState { param($Entity, [string]$Layer, $ExpectedControls, $ExpectedFitPoints, $ExpectedKnots, $ExpectedWeights); return (Test-EntityCommon $Entity 'AcDbSpline' $Layer 1 50) -and $Entity.details.degree -eq 3 -and -not $Entity.details.closed -and (Test-Vertices -Actual $Entity.details.controlPoints -Expected $ExpectedControls) -and (Test-Vertices -Actual $Entity.details.fitPoints -Expected $ExpectedFitPoints) -and (Test-Numbers -Actual $Entity.details.knots -Expected $ExpectedKnots -Tolerance 0.000001) -and (Test-SplineWeights -Actual $Entity.details.weights -Expected $ExpectedWeights) }
function Get-StringSha256 { param([string]$Value); $algorithm = [Security.Cryptography.SHA256]::Create(); try { return ([BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value))).Replace('-', '').ToLowerInvariant()) } finally { $algorithm.Dispose() } }
function Get-FileSha256 { param([string]$Path); $algorithm = [Security.Cryptography.SHA256]::Create(); $stream = [IO.File]::OpenRead($Path); try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()) } finally { $stream.Dispose(); $algorithm.Dispose() } }
function Get-OwnedAcadIdentity {
  param([int]$ProcessId)
  $process = Get-Process -Id $ProcessId -ErrorAction Stop; $path = [IO.Path]::GetFullPath([string]$process.Path)
  if ([IO.Path]::GetFileName($path) -ine 'acad.exe') { throw "F-024 PID $ProcessId is not acad.exe." }
  $startTimeUtc = $process.StartTime.ToUniversalTime().ToString('o'); $version = (Get-Item -LiteralPath $path -ErrorAction Stop).VersionInfo
  return [ordered]@{ processId = $ProcessId; executablePath = $path; executableName = [IO.Path]::GetFileName($path); executableSha256 = Get-FileSha256 $path; fileVersion = [string]$version.FileVersion; productVersion = [string]$version.ProductVersion; startTimeUtc = $startTimeUtc; startTimeSha256 = Get-StringSha256 $startTimeUtc }
}
function Write-OwnedPidSidecar {
  param([int]$ProcessId)
  $identity = Get-OwnedAcadIdentity $ProcessId
  [ordered]@{ schemaVersion = 1; processId = $identity.processId; executablePath = $identity.executablePath; executableName = $identity.executableName; executableSha256 = $identity.executableSha256; fileVersion = $identity.fileVersion; productVersion = $identity.productVersion; startTimeUtc = $identity.startTimeUtc; startTimeSha256 = $identity.startTimeSha256; owned = $true; token = $OwnershipToken } | ConvertTo-Json -Compress | Set-Content -LiteralPath $PidPath -Encoding ascii
  return $identity
}
function Get-InstalledAutoCadUpdateIdentity {
  $roots = @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')
  $matches = @($roots | Where-Object { Test-Path $_ } | ForEach-Object { Get-ChildItem -LiteralPath $_ -ErrorAction Stop | ForEach-Object { $item = Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue; if ([string]$item.DisplayName -eq 'Autodesk AutoCAD 2024.1.2 Update') { [ordered]@{ displayName = [string]$item.DisplayName; displayVersion = [string]$item.DisplayVersion } } } })
  if ($matches.Count -ne 1) { throw "F-024 requires exactly one installed AutoCAD 2024.1.2 Update registration; found $($matches.Count)." }
  return $matches[0]
}

$preExistingProcessIds = @(Get-Process -Name 'acad' -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.Id })
$acad = $null; $scratch = $null; $parametricDocument = $null; $shiftHelper = $null; $shiftEscape = $null; $result = $null; $automationProcessId = 0; $owned = $false; $ownedIdentity = $null
try {
  Write-Stage 'startup'
  $acad = New-Object -ComObject AutoCAD.Application.24.3
  [uint32]$resolvedProcessId = 0; [void][F024WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry { $acad.HWND }), [ref]$resolvedProcessId)
  $automationProcessId = [int]$resolvedProcessId; $owned = $automationProcessId -gt 0 -and $preExistingProcessIds -notcontains $automationProcessId
  Write-Host "[F-024] automation-process pid=$automationProcessId owned=$owned"
  if (-not $owned) { throw 'F-024 refuses to use a pre-existing AutoCAD process.' }
  $ownedIdentity = Write-OwnedPidSidecar $automationProcessId; $installedUpdateIdentity = Get-InstalledAutoCadUpdateIdentity; $engineVersion = [string](Invoke-ComRetry { $acad.Version })
  Invoke-ComRetry { $acad.Visible = $true } | Out-Null
  $scratch = if ([int](Invoke-ComRetry { $acad.Documents.Count }) -gt 0) { Invoke-ComRetry { $acad.ActiveDocument } } else { Invoke-ComRetry { $acad.Documents.Add() } }
  if ([string](Invoke-ComRetry { $scratch.FullName }) -or [int](Invoke-ComRetry { $scratch.ModelSpace.Count }) -ne 0) { throw 'F-024 refuses a saved or non-blank drawing.' }
  Invoke-ComRetry { $scratch.Activate(); $scratch.SetVariable('CMDECHO', 0); $scratch.SetVariable('FILEDIA', 0) } | Out-Null
  $layers = @('F024_PAIR', 'F024_NO_TRIM', 'F024_MIXED', 'F024_ADJACENT', 'F024_ARC_ZERO', 'F024_OPEN_CLOSE', 'F024_FPA0', 'F024_FPA1', 'F024_FPA0_NO_TRIM', 'F024_POLY_NO_TRIM', 'F024_MULTIPLE', 'F024_COMMAND_UNDO', 'F024_GLOBAL_UNDO_REDO', 'F024_CURRENT_SRC', 'F024_CURRENT_ARC', 'F024_CROSS_A', 'F024_CROSS_B', 'F024_CROSS_ARC', 'F024_SHIFT', 'F024_LINE_CIRCLE', 'F024_LINE_ARC', 'F024_LINE_CIRCLE_TRIM', 'F024_LINE_ELLIPSE', 'F024_LINE_SPLINE', 'F024_RAY_LINE', 'F024_XLINE_LINE', 'F024_RAY_LINE_NO_TRIM', 'F024_XLINE_LINE_NO_TRIM', 'F024_RAY_XLINE', 'F024_LOCKED', 'F024_OFF', 'F024_FROZEN')
  foreach ($name in $layers) { $null = Invoke-ComRetry { $scratch.Layers.Add($name) } }

  Write-Stage 'line-pairs'
  $pairFirst = New-Line $scratch 'F024_PAIR' 0 0 100 0; $pairSecond = New-Line $scratch 'F024_PAIR' 100 0 100 100
  Invoke-FilletPair $scratch $pairFirst 80 0 $pairSecond 100 20 10 $true; $pair = @(Get-LayerStates $scratch 'F024_PAIR')

  $noTrimFirst = New-Line $scratch 'F024_NO_TRIM' 0 200 100 200; $noTrimSecond = New-Line $scratch 'F024_NO_TRIM' 100 200 100 300
  Invoke-FilletPair $scratch $noTrimFirst 80 200 $noTrimSecond 100 220 10 $false; $noTrim = @(Get-LayerStatesAtLeast $scratch 'F024_NO_TRIM' 3)

  Write-Stage 'polylines'
  $mixedPolyline = New-Polyline $scratch 'F024_MIXED' ([double[]]@(0, 400, 100, 400)); $mixedLine = New-Line $scratch 'F024_MIXED' 100 400 100 500
  Invoke-ComRetry { $mixedPolyline.SetWidth(0, 2, 4) } | Out-Null
  Invoke-FilletPair $scratch $mixedPolyline 80 400 $mixedLine 100 420 10 $true; $mixed = @(Get-LayerStates $scratch 'F024_MIXED')

  $adjacent = New-Polyline $scratch 'F024_ADJACENT' ([double[]]@(0, 600, 100, 600, 100, 700, 0, 700)) $true
  Invoke-FilletPair $scratch $adjacent 80 600 $adjacent 100 620 10 $true; $adjacentState = @(Get-LayerStates $scratch 'F024_ADJACENT')

  $arcZero = New-Polyline $scratch 'F024_ARC_ZERO' ([double[]]@(0, 800, 100, 800, 150, 850, 150, 950, 0, 950)) $true @{ 1 = [Math]::Tan([Math]::PI / 8) }
  Invoke-FilletPair $scratch $arcZero 80 800 $arcZero 150 870 0 $true; $arcZeroState = @(Get-LayerStates $scratch 'F024_ARC_ZERO')

  $openClose = New-Polyline $scratch 'F024_OPEN_CLOSE' ([double[]]@(0, 1200, 0, 1100, 100, 1100, 20, 1200)) $false
  Invoke-FilletPair $scratch $openClose 0 1190 $openClose 28 1190 10 $true; $openCloseState = @(Get-LayerStates $scratch 'F024_OPEN_CLOSE')

  $fpa0 = New-Polyline $scratch 'F024_FPA0' ([double[]]@(0, 1400, 100, 1400, 160, 1460, 160, 1540)) $false @{ 1 = 0.2 }
  Invoke-FilletPolyline $scratch $fpa0 10 $true 0; $fpa0State = @(Get-LayerStates $scratch 'F024_FPA0')
  $fpa1 = New-Polyline $scratch 'F024_FPA1' ([double[]]@(300, 1400, 400, 1400, 460, 1460, 460, 1540)) $false @{ 1 = 0.2 }
  Invoke-FilletPolyline $scratch $fpa1 10 $true 1; $fpa1State = @(Get-LayerStates $scratch 'F024_FPA1')
  $fpa0NoTrim = New-Polyline $scratch 'F024_FPA0_NO_TRIM' ([double[]]@(600, 1400, 700, 1400, 760, 1460, 760, 1540, 660, 1540)) $false @{ 1 = [Math]::Tan([Math]::PI / 8) }
  Invoke-FilletPolyline $scratch $fpa0NoTrim 10 $false 0; $fpa0NoTrimState = @(Get-LayerStates $scratch 'F024_FPA0_NO_TRIM')

  $polyNoTrim = New-Polyline $scratch 'F024_POLY_NO_TRIM' ([double[]]@(300, 600, 400, 600, 400, 700, 300, 700)) $true
  Invoke-FilletPolyline $scratch $polyNoTrim 10 $false 1; $polyNoTrimState = @(Get-LayerStates $scratch 'F024_POLY_NO_TRIM')

  Write-Stage 'multiple-undo-redo'
  $multiplePairs = @(
    [ordered]@{ first = (New-Line $scratch 'F024_MULTIPLE' 0 1800 100 1800); firstX = 80; firstY = 1800; second = (New-Line $scratch 'F024_MULTIPLE' 100 1800 100 1900); secondX = 100; secondY = 1820 },
    [ordered]@{ first = (New-Line $scratch 'F024_MULTIPLE' 200 1800 300 1800); firstX = 280; firstY = 1800; second = (New-Line $scratch 'F024_MULTIPLE' 300 1800 300 1900); secondX = 300; secondY = 1820 }
  )
  Invoke-FilletMultiple $scratch $multiplePairs 10 $true $false; $multipleState = @(Get-LayerStates $scratch 'F024_MULTIPLE')

  $commandUndoPairs = @(
    [ordered]@{ first = (New-Line $scratch 'F024_COMMAND_UNDO' 0 2000 100 2000); firstX = 80; firstY = 2000; second = (New-Line $scratch 'F024_COMMAND_UNDO' 100 2000 100 2100); secondX = 100; secondY = 2020 },
    [ordered]@{ first = (New-Line $scratch 'F024_COMMAND_UNDO' 200 2000 300 2000); firstX = 280; firstY = 2000; second = (New-Line $scratch 'F024_COMMAND_UNDO' 300 2000 300 2100); secondX = 300; secondY = 2020 }
  )
  Invoke-FilletMultiple $scratch $commandUndoPairs 10 $true $true; $commandUndoState = @(Get-LayerStates $scratch 'F024_COMMAND_UNDO')

  $globalPairs = @(
    [ordered]@{ first = (New-Line $scratch 'F024_GLOBAL_UNDO_REDO' 0 2200 100 2200); firstX = 80; firstY = 2200; second = (New-Line $scratch 'F024_GLOBAL_UNDO_REDO' 100 2200 100 2300); secondX = 100; secondY = 2220 },
    [ordered]@{ first = (New-Line $scratch 'F024_GLOBAL_UNDO_REDO' 200 2200 300 2200); firstX = 280; firstY = 2200; second = (New-Line $scratch 'F024_GLOBAL_UNDO_REDO' 300 2200 300 2300); secondX = 300; secondY = 2220 }
  )
  Invoke-FilletMultiple $scratch $globalPairs 10 $true $false; $globalCommitted = @(Get-LayerStates $scratch 'F024_GLOBAL_UNDO_REDO')
  Invoke-ComRetry { $scratch.SendCommand("_.UNDO`n1`n") } | Out-Null; Wait-AcadIdle $scratch; $globalUndone = @(Get-LayerStates $scratch 'F024_GLOBAL_UNDO_REDO')
  Invoke-ComRetry { $scratch.SendCommand("_.REDO`n") } | Out-Null; Wait-AcadIdle $scratch; $globalRedone = @(Get-LayerStates $scratch 'F024_GLOBAL_UNDO_REDO')

  $currentFirst = New-Line $scratch 'F024_CURRENT_SRC' 0 2400 100 2400; $currentSecond = New-Line $scratch 'F024_CURRENT_SRC' 100 2400 100 2500
  Invoke-ComRetry { $scratch.SetVariable('CLAYER', 'F024_CURRENT_ARC') } | Out-Null
  Invoke-FilletPair $scratch $currentFirst 80 2400 $currentSecond 100 2420 10 $false
  Invoke-ComRetry { $scratch.SetVariable('CLAYER', '0') } | Out-Null
  $currentSourceState = @(Get-LayerStates $scratch 'F024_CURRENT_SRC'); $currentArcState = @(Get-LayerStates $scratch 'F024_CURRENT_ARC')

  $crossFirst = New-Line $scratch 'F024_CROSS_A' 0 2600 100 2600; $crossSecond = New-Line $scratch 'F024_CROSS_B' 100 2600 100 2700
  Invoke-ComRetry { $scratch.SetVariable('CLAYER', 'F024_CROSS_ARC') } | Out-Null
  Invoke-FilletPair $scratch $crossFirst 80 2600 $crossSecond 100 2620 10 $false
  Invoke-ComRetry { $scratch.SetVariable('CLAYER', '0') } | Out-Null
  $crossAState = @(Get-LayerStates $scratch 'F024_CROSS_A'); $crossBState = @(Get-LayerStates $scratch 'F024_CROSS_B'); $crossArcState = @(Get-LayerStates $scratch 'F024_CROSS_ARC')

  Write-Stage 'physical-shift'
  $null = New-Line $scratch 'F024_SHIFT' 0 3000 80 3000; $null = New-Line $scratch 'F024_SHIFT' 100 3020 100 3100
  [double[]]$shiftLower = @(-100, 2900, 0); [double[]]$shiftUpper = @(200, 3200, 0); Invoke-ComRetry { $acad.ZoomWindow($shiftLower, $shiftUpper) } | Out-Null; Start-Sleep -Milliseconds 500
  $expectedScreenSize = @((Invoke-NonNullCom { $scratch.GetVariable('SCREENSIZE') } 'SCREENSIZE') | ForEach-Object { [int][Math]::Round([double]$_) })
  $viewportHandle = [F024WindowProcess]::FindModelViewport([IntPtr][int64](Invoke-ComRetry { $acad.HWND }), $expectedScreenSize[0], $expectedScreenSize[1]); if ($viewportHandle -eq [IntPtr]::Zero) { throw 'F-024 could not find the AutoCAD DXGI model viewport.' }
  $shiftScreenPoint = Get-ModelScreenPoint $scratch $viewportHandle 100 3040
  Write-Stage 'physical-shift-screen-resolved'
  $shiftHelperPath = Join-Path $PSScriptRoot 'f022-shift-click.ps1'
  $shiftHelper = Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$shiftHelperPath,'-MainWindowHandle',([string][int64](Invoke-ComRetry { $acad.HWND })),'-ExpectedProcessId',([string]$automationProcessId),'-Action','ShiftClick','-ScreenX',([string]$shiftScreenPoint.x),'-ScreenY',([string]$shiftScreenPoint.y),'-DelayMilliseconds','1000') -WindowStyle Hidden -PassThru
  Write-Stage 'physical-shift-helper-started'
  Invoke-ComRetry { $scratch.SetVariable('FILLETRAD', 10); $scratch.SendCommand("_.FILLET`n75,3000`n") } | Out-Null
  Write-Stage 'physical-shift-command-sent'
  if (-not $shiftHelper.WaitForExit(15000)) { Stop-InputHelper $shiftHelper 'F-024 physical Shift-click helper'; $shiftHelper = $null; throw 'F-024 physical Shift-click helper did not exit.' }
  $shiftHelperExitCode = $shiftHelper.ExitCode; $shiftHelper = $null
  if ($shiftHelperExitCode -ne 0) { throw "F-024 physical Shift-click helper exited $shiftHelperExitCode." }
  Write-Stage 'physical-shift-helper-passed'
  Write-Stage 'physical-shift-cleanup-started'
  $shiftEscapeExitCodes = @()
  for ($attempt = 1; $attempt -le 2; $attempt += 1) {
    $shiftEscape = Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$shiftHelperPath,'-MainWindowHandle',([string][int64](Invoke-ComRetry { $acad.HWND })),'-ExpectedProcessId',([string]$automationProcessId),'-Action','Escape','-DelayMilliseconds','1000') -WindowStyle Hidden -PassThru
    if (-not $shiftEscape.WaitForExit(15000)) { Stop-InputHelper $shiftEscape 'F-024 physical Shift cleanup helper'; $shiftEscape = $null; throw 'F-024 physical Shift cleanup helper did not exit.' }
    $shiftEscapeExitCode = $shiftEscape.ExitCode; $shiftEscape = $null
    $shiftEscapeExitCodes += $shiftEscapeExitCode
    if ($shiftEscapeExitCode -eq 0) { break }
    Start-Sleep -Milliseconds 250
  }
  if ($shiftEscapeExitCodes[-1] -ne 0) { throw "F-024 physical Shift cleanup helper failed twice: $($shiftEscapeExitCodes -join ',')." }
  Write-Stage 'physical-shift-cleanup-passed'
  Wait-AcadIdle $scratch; $shiftState = @(Get-LayerStates $scratch 'F024_SHIFT'); $filletRadiusAfterShift = [double](Invoke-ComRetry { $scratch.GetVariable('FILLETRAD') })
  Write-Stage 'physical-shift-complete'

  Write-Stage 'curved-entities'
  $circleLine = New-Line $scratch 'F024_LINE_CIRCLE' -100 3400 100 3400; $circle = New-Circle $scratch 'F024_LINE_CIRCLE' 0 3430 10
  Invoke-FilletPair $scratch $circleLine -30 3400 $circle -10 3430 10 $false; $lineCircleState = @(Get-LayerStates $scratch 'F024_LINE_CIRCLE')
  $arcLine = New-Line $scratch 'F024_LINE_ARC' 200 3600 400 3600; $sourceArc = New-Arc $scratch 'F024_LINE_ARC' 300 3630 10 ([Math]::PI) ([Math]::PI * 2)
  Invoke-FilletPair $scratch $arcLine 270 3600 $sourceArc 290 3630 10 $false; $lineArcState = @(Get-LayerStates $scratch 'F024_LINE_ARC')

  $trimCircleLine = New-Line $scratch 'F024_LINE_CIRCLE_TRIM' -200 3800 0 3800; $trimCircle = New-Circle $scratch 'F024_LINE_CIRCLE_TRIM' 100 3800 100
  Invoke-FilletPair $scratch $trimCircleLine -20 3800 $trimCircle 2 3810 10 $true; $lineCircleTrimState = @(Get-LayerStates $scratch 'F024_LINE_CIRCLE_TRIM')

  $ellipseLine = New-Line $scratch 'F024_LINE_ELLIPSE' -200 4000 0 4000; $ellipse = New-Ellipse $scratch 'F024_LINE_ELLIPSE' 100 4000 100 0 0.5
  Invoke-FilletPair $scratch $ellipseLine -20 4000 $ellipse 2 4010 10 $true; $lineEllipseState = @(Get-LayerStates $scratch 'F024_LINE_ELLIPSE')

  [double[]]$fitPoints = @(300, 4200, 0, 340, 4240, 0, 400, 4300, 0); [double[]]$startTangent = @(0, 1, 0); [double[]]$endTangent = @(1, 1, 0)
  $splineLine = New-Line $scratch 'F024_LINE_SPLINE' 100 4200 300 4200; $spline = New-Spline $scratch 'F024_LINE_SPLINE' $fitPoints $startTangent $endTangent
  Invoke-FilletPair $scratch $splineLine 280 4200 $spline 302 4210 10 $true; $lineSplineState = @(Get-LayerStates $scratch 'F024_LINE_SPLINE')

  Write-Stage 'construction-lines'
  $ray = New-Ray $scratch 'F024_RAY_LINE' 0 4600 100 4600; $rayLine = New-Line $scratch 'F024_RAY_LINE' 100 4600 100 4700
  Invoke-FilletPair $scratch $ray 80 4600 $rayLine 100 4620 10 $true; $rayLineState = @(Get-LayerStates $scratch 'F024_RAY_LINE')

  $xline = New-Xline $scratch 'F024_XLINE_LINE' 0 4800 100 4800; $xlineLine = New-Line $scratch 'F024_XLINE_LINE' 100 4800 100 4900
  Invoke-FilletPair $scratch $xline 80 4800 $xlineLine 100 4820 10 $true; $xlineLineState = @(Get-LayerStates $scratch 'F024_XLINE_LINE')

  $rayNoTrim = New-Ray $scratch 'F024_RAY_LINE_NO_TRIM' 0 5000 100 5000; $rayNoTrimLine = New-Line $scratch 'F024_RAY_LINE_NO_TRIM' 100 5000 100 5100
  Invoke-FilletPair $scratch $rayNoTrim 80 5000 $rayNoTrimLine 100 5020 10 $false; $rayLineNoTrimState = @(Get-LayerStates $scratch 'F024_RAY_LINE_NO_TRIM')

  $xlineNoTrim = New-Xline $scratch 'F024_XLINE_LINE_NO_TRIM' 0 5200 100 5200; $xlineNoTrimLine = New-Line $scratch 'F024_XLINE_LINE_NO_TRIM' 100 5200 100 5300
  Invoke-FilletPair $scratch $xlineNoTrim 80 5200 $xlineNoTrimLine 100 5220 10 $false; $xlineLineNoTrimState = @(Get-LayerStates $scratch 'F024_XLINE_LINE_NO_TRIM')

  $pairRay = New-Ray $scratch 'F024_RAY_XLINE' 0 5400 100 5400; $pairXline = New-Xline $scratch 'F024_RAY_XLINE' 100 5400 100 5500
  Invoke-FilletPair $scratch $pairRay 80 5400 $pairXline 100 5420 10 $true; $rayXlineState = @(Get-LayerStates $scratch 'F024_RAY_XLINE')

  Write-Stage 'layer-states'
  Write-Stage 'layer-states-locked-start'
  $lockedFirst = New-Line $scratch 'F024_LOCKED' 0 4400 100 4400; $lockedSecond = New-Line $scratch 'F024_LOCKED' 100 4400 100 4500
  $lockedLayer = Invoke-ComRetry { $scratch.Layers.Item('F024_LOCKED') }; Invoke-ComRetry { $lockedLayer.Lock = $true } | Out-Null
  Invoke-FilletRejectedPair $acad $scratch $automationProcessId $shiftHelperPath $lockedFirst 80 4400 $lockedSecond 100 4420 10
  Invoke-ComRetry { $lockedLayer.Lock = $false } | Out-Null; $lockedState = @(Get-LayerStates $scratch 'F024_LOCKED')
  Write-Stage 'layer-states-locked-complete'

  Write-Stage 'layer-states-off-start'
  $offFirst = New-Line $scratch 'F024_OFF' 200 4400 300 4400; $offSecond = New-Line $scratch 'F024_OFF' 300 4400 300 4500
  $offLayer = Invoke-ComRetry { $scratch.Layers.Item('F024_OFF') }; Invoke-ComRetry { $offLayer.LayerOn = $false } | Out-Null
  Invoke-FilletRejectedPair $acad $scratch $automationProcessId $shiftHelperPath $offFirst 280 4400 $offSecond 300 4420 10
  Invoke-ComRetry { $offLayer.LayerOn = $true } | Out-Null; $offState = @(Get-LayerStates $scratch 'F024_OFF')
  Write-Stage 'layer-states-off-complete'

  Write-Stage 'layer-states-frozen-start'
  $frozenFirst = New-Line $scratch 'F024_FROZEN' 400 4400 500 4400; $frozenSecond = New-Line $scratch 'F024_FROZEN' 500 4400 500 4500
  $frozenLayer = Invoke-ComRetry { $scratch.Layers.Item('F024_FROZEN') }; Invoke-ComRetry { $frozenLayer.Freeze = $true } | Out-Null
  Invoke-FilletRejectedPair $acad $scratch $automationProcessId $shiftHelperPath $frozenFirst 480 4400 $frozenSecond 500 4420 10
  Invoke-ComRetry { $frozenLayer.Freeze = $false } | Out-Null; $frozenState = @(Get-LayerStates $scratch 'F024_FROZEN')
  Write-Stage 'layer-states-frozen-complete'

  Write-Stage 'same-source-parametric'
  $parametricDocument = Invoke-ComRetry { $acad.Documents.Open($ParametricDxfInputPath, $false) } -TimeoutSeconds 90
  Invoke-ComRetry { $parametricDocument.Activate(); $parametricDocument.SetVariable('CMDECHO', 0); $parametricDocument.SetVariable('FILEDIA', 0) } | Out-Null
  $parametricLineEllipse = Invoke-ComRetry { $parametricDocument.HandleToObject('10') }; $parametricEllipse = Invoke-ComRetry { $parametricDocument.HandleToObject('20') }
  Invoke-FilletPair $parametricDocument $parametricLineEllipse -20 0 $parametricEllipse 2 10 10 $true
  $parametricLineSpline = Invoke-ComRetry { $parametricDocument.HandleToObject('30') }; $parametricSpline = Invoke-ComRetry { $parametricDocument.HandleToObject('40') }
  Invoke-FilletPair $parametricDocument $parametricLineSpline 280 200 $parametricSpline 302 210 10 $true
  Invoke-ComRetry { $parametricDocument.Regen(1); $parametricDocument.SaveAs($ParametricDxfOutputPath, 65) } -TimeoutSeconds 90 | Out-Null
  Invoke-ComRetry { $parametricDocument.Close($false) } -TimeoutSeconds 30 | Out-Null; $parametricDocument = $null
  $parametricDocument = Invoke-ComRetry { $acad.Documents.Open($ParametricDxfOutputPath, $true) } -TimeoutSeconds 90
  Invoke-ComRetry { $parametricDocument.Activate() } | Out-Null
  $parametricState = @(Get-LayerStatesAtLeast $parametricDocument '0' 6 10)
  Invoke-ComRetry { $parametricDocument.Close($false); $scratch.Activate() } -TimeoutSeconds 30 | Out-Null; $parametricDocument = $null

  Write-Stage 'validate-and-save'
  if ($pair.Count -lt 2) { $pair = @(Get-LayerStatesAtLeast $scratch 'F024_PAIR' 2) }
  $pairLines = @($pair | Where-Object { $_.objectName -eq 'AcDbLine' }); $pairArcs = @($pair | Where-Object { $_.objectName -eq 'AcDbArc' })
  # FILLET can leave the first trimmed source as an erased COM wrapper until
  # database compaction. Accept that documented 2-state projection here; the
  # runner still requires both exact live LINE records in the saved DXF.
  $pairPassed = ($pair.Count -eq 2 -or $pair.Count -eq 3) -and @($pairLines | Where-Object { (Test-Point -Actual $_.details.start -Expected @(100, 10)) -and (Test-Point -Actual $_.details.end -Expected @(100, 100)) -and $_.color -eq 1 -and $_.lineweight -eq 50 }).Count -eq 1 -and ($pair.Count -eq 2 -or @($pairLines | Where-Object { (Test-Point -Actual $_.details.start -Expected @(0, 0)) -and (Test-Point -Actual $_.details.end -Expected @(90, 0)) -and $_.color -eq 1 -and $_.lineweight -eq 50 }).Count -eq 1) -and $pairArcs.Count -eq 1 -and (Test-Point -Actual $pairArcs[0].details.center -Expected @(90, 10)) -and (Test-Near -Actual $pairArcs[0].details.radius -Expected 10) -and $pairArcs[0].color -eq 1 -and $pairArcs[0].lineweight -eq 50
  $noTrimLines = @($noTrim | Where-Object { $_.objectName -eq 'AcDbLine' }); $noTrimArcs = @($noTrim | Where-Object { $_.objectName -eq 'AcDbArc' })
  $noTrimPassed = $noTrim.Count -eq 3 -and $noTrimLines.Count -eq 2 -and $noTrimArcs.Count -eq 1 -and @($noTrimLines | Where-Object { (Test-Point -Actual $_.details.start -Expected @(0, 200)) -and (Test-Point -Actual $_.details.end -Expected @(100, 200)) }).Count -eq 1
  $mixedPolylineState = @($mixed | Where-Object { $_.objectName -eq 'AcDbPolyline' }); $mixedArc = @($mixed | Where-Object { $_.objectName -eq 'AcDbArc' })
  $mixedWidths = if ($mixedPolylineState.Count -eq 1) { @($mixedPolylineState[0].details.widths) } else { @() }
  $mixedPassed = $mixed.Count -eq 1 -and $mixedPolylineState.Count -eq 1 -and (Test-Vertices -Actual $mixedPolylineState[0].details.vertices -Expected @(@(0, 400), @(90, 400), @(100, 410), @(100, 500))) -and @($mixedPolylineState[0].details.bulges | Where-Object { Test-Near -Actual $_ -Expected ([Math]::Tan([Math]::PI / 8)) }).Count -eq 1 -and $mixedArc.Count -eq 0 -and $mixedWidths.Count -eq 4 -and (Test-Point -Actual $mixedWidths[0] -Expected @(2, 3.8)) -and @($mixedWidths | Select-Object -Skip 1 | Where-Object { Test-Point -Actual $_ -Expected @(3.8, 3.8) }).Count -eq 3
  $adjacentPolyline = @($adjacentState | Where-Object { $_.objectName -eq 'AcDbPolyline' })
  $adjacentPassed = $adjacentState.Count -eq 1 -and $adjacentPolyline.Count -eq 1 -and $adjacentPolyline[0].details.closed -and (Test-Vertices -Actual $adjacentPolyline[0].details.vertices -Expected @(@(0, 600), @(90, 600), @(100, 610), @(100, 700), @(0, 700))) -and (Test-Numbers -Actual $adjacentPolyline[0].details.bulges -Expected @(0, ([Math]::Tan([Math]::PI / 8)), 0, 0, 0) -Tolerance 0.000001)
  $arcZeroPolyline = @($arcZeroState | Where-Object { $_.objectName -eq 'AcDbPolyline' })
  $arcZeroPassed = $arcZeroState.Count -eq 1 -and $arcZeroPolyline.Count -eq 1 -and (Test-Vertices -Actual $arcZeroPolyline[0].details.vertices -Expected @(@(0, 800), @(150, 800), @(150, 950), @(0, 950))) -and @($arcZeroPolyline[0].details.bulges | Where-Object { [Math]::Abs($_) -gt 0.0001 }).Count -eq 0
  $openPolyline = @($openCloseState | Where-Object { $_.objectName -eq 'AcDbPolyline' })
  $openClosePassed = $openCloseState.Count -eq 1 -and $openPolyline.Count -eq 1 -and $openPolyline[0].details.closed -and (Test-Vertices -Actual $openPolyline[0].details.vertices -Expected @(@(0, 1196.4921894064), @(0, 1100), @(100, 1100), @(17.8086880944, 1202.739139882))) -and @($openPolyline[0].details.bulges | Where-Object { Test-Near -Actual $_ -Expected 0.708958225374 }).Count -eq 1
  $fpa0Polyline = @($fpa0State | Where-Object { $_.objectName -eq 'AcDbPolyline' }); $fpa1Polyline = @($fpa1State | Where-Object { $_.objectName -eq 'AcDbPolyline' })
  $fpa0Passed = $fpa0State.Count -eq 1 -and $fpa0Polyline.Count -eq 1 -and -not $fpa0Polyline[0].details.closed -and (Test-Vertices -Actual $fpa0Polyline[0].details.vertices -Expected @(@(0, 1400), @(150, 1400), @(160, 1410), @(160, 1540))) -and (Test-Numbers -Actual $fpa0Polyline[0].details.bulges -Expected @(0, ([Math]::Tan([Math]::PI / 8)), 0, 0) -Tolerance 0.000001)
  $fpa1Passed = $fpa1State.Count -eq 1 -and $fpa1Polyline.Count -eq 1 -and -not $fpa1Polyline[0].details.closed -and (Test-Vertices -Actual $fpa1Polyline[0].details.vertices -Expected @(@(300, 1400), @(397.972826303728, 1400), @(401.957808971661, 1400.828309145213), @(459.171690854788, 1458.04219102834), @(460, 1462.02717369627), @(460, 1540))) -and (Test-Numbers -Actual $fpa1Polyline[0].details.bulges -Expected @(0, 0.102829884701, 0.189997598761, 0.1028298847, 0, 0) -Tolerance 0.000001)
  $fpa0NoTrimPolyline = @($fpa0NoTrimState | Where-Object { $_.objectName -eq 'AcDbPolyline' }); $fpa0NoTrimArcs = @($fpa0NoTrimState | Where-Object { $_.objectName -eq 'AcDbArc' })
  $fpa0NoTrimPassed = $fpa0NoTrimState.Count -eq 3 -and $fpa0NoTrimPolyline.Count -eq 1 -and -not $fpa0NoTrimPolyline[0].details.closed -and (Test-Vertices -Actual $fpa0NoTrimPolyline[0].details.vertices -Expected @(@(600, 1400), @(700, 1400), @(760, 1460), @(760, 1540), @(660, 1540))) -and (Test-Numbers -Actual $fpa0NoTrimPolyline[0].details.bulges -Expected @(0, ([Math]::Tan([Math]::PI / 8)), 0, 0, 0) -Tolerance 0.000001) -and $fpa0NoTrimArcs.Count -eq 2 -and @($fpa0NoTrimArcs | Where-Object { (Test-Point -Actual $_.details.center -Expected @(750, 1530)) -or (Test-Point -Actual $_.details.center -Expected @(750, 1410)) }).Count -eq 2 -and @($fpa0NoTrimArcs | Where-Object { Test-Near -Actual $_.details.radius -Expected 10 }).Count -eq 2
  $polyNoTrimPolyline = @($polyNoTrimState | Where-Object { $_.objectName -eq 'AcDbPolyline' }); $polyNoTrimArcs = @($polyNoTrimState | Where-Object { $_.objectName -eq 'AcDbArc' })
  $polyNoTrimPassed = $polyNoTrimState.Count -eq 5 -and $polyNoTrimPolyline.Count -eq 1 -and $polyNoTrimPolyline[0].details.closed -and (Test-Vertices -Actual $polyNoTrimPolyline[0].details.vertices -Expected @(@(300, 600), @(400, 600), @(400, 700), @(300, 700))) -and (Test-Numbers -Actual $polyNoTrimPolyline[0].details.bulges -Expected @(0, 0, 0, 0)) -and $polyNoTrimArcs.Count -eq 4 -and @($polyNoTrimArcs | Where-Object { (Test-Point -Actual $_.details.center -Expected @(310, 610)) -or (Test-Point -Actual $_.details.center -Expected @(310, 690)) -or (Test-Point -Actual $_.details.center -Expected @(390, 690)) -or (Test-Point -Actual $_.details.center -Expected @(390, 610)) }).Count -eq 4 -and @($polyNoTrimArcs | Where-Object { Test-Near -Actual $_.details.radius -Expected 10 }).Count -eq 4
  $multiplePassed = $multipleState.Count -eq 6 -and @($multipleState | Where-Object { $_.objectName -eq 'AcDbArc' }).Count -eq 2
  $commandUndoPassed = $commandUndoState.Count -eq 5 -and @($commandUndoState | Where-Object { $_.objectName -eq 'AcDbArc' }).Count -eq 1
  $globalUndoRedoPassed = $globalCommitted.Count -eq 6 -and @($globalCommitted | Where-Object { $_.objectName -eq 'AcDbArc' }).Count -eq 2 -and $globalUndone.Count -eq 4 -and @($globalUndone | Where-Object { $_.objectName -eq 'AcDbArc' }).Count -eq 0 -and $globalRedone.Count -eq 6 -and @($globalRedone | Where-Object { $_.objectName -eq 'AcDbArc' }).Count -eq 2
  $sameSourceLayerPassed = $currentSourceState.Count -eq 3 -and @($currentSourceState | Where-Object { $_.objectName -eq 'AcDbLine' -and $_.color -eq 1 -and $_.lineweight -eq 50 }).Count -eq 2 -and @($currentSourceState | Where-Object { $_.objectName -eq 'AcDbArc' }).Count -eq 1 -and $currentArcState.Count -eq 0
  $crossLayerCurrentPassed = $crossAState.Count -eq 1 -and $crossAState[0].objectName -eq 'AcDbLine' -and $crossBState.Count -eq 1 -and $crossBState[0].objectName -eq 'AcDbLine' -and $crossArcState.Count -eq 1 -and $crossArcState[0].objectName -eq 'AcDbArc' -and $crossArcState[0].color -eq 256
  $shiftPassed = $shiftState.Count -eq 2 -and @($shiftState | Where-Object { $_.objectName -eq 'AcDbLine' }).Count -eq 2 -and @($shiftState | Where-Object { (Test-Point -Actual $_.details.end -Expected @(100, 3000)) -or (Test-Point -Actual $_.details.start -Expected @(100, 3000)) }).Count -eq 2 -and (Test-Near -Actual $filletRadiusAfterShift -Expected 10)
  $lineCirclePassed = $lineCircleState.Count -eq 3 -and @($lineCircleState | Where-Object { Test-LineState $_ 'F024_LINE_CIRCLE' @(-100, 3400) @(100, 3400) }).Count -eq 1 -and @($lineCircleState | Where-Object { Test-CircleState $_ 'F024_LINE_CIRCLE' @(0, 3430) 10 }).Count -eq 1 -and @($lineCircleState | Where-Object { Test-ArcState $_ 'F024_LINE_CIRCLE' @(0, 3410) 10 ([Math]::PI / 2) ([Math]::PI * 1.5) }).Count -eq 1
  $lineArcPassed = $lineArcState.Count -eq 3 -and @($lineArcState | Where-Object { Test-LineState $_ 'F024_LINE_ARC' @(200, 3600) @(400, 3600) }).Count -eq 1 -and @($lineArcState | Where-Object { Test-ArcState $_ 'F024_LINE_ARC' @(300, 3630) 10 ([Math]::PI) 0 }).Count -eq 1 -and @($lineArcState | Where-Object { Test-ArcState $_ 'F024_LINE_ARC' @(300, 3610) 10 ([Math]::PI * 1.5) ([Math]::PI / 2) }).Count -eq 1
  $lineCircleTrimPassed = $lineCircleTrimState.Count -eq 3 -and @($lineCircleTrimState | Where-Object { Test-LineState $_ 'F024_LINE_CIRCLE_TRIM' @(-200, 3800) @(-9.544511501033227, 3800) }).Count -eq 1 -and @($lineCircleTrimState | Where-Object { Test-CircleState $_ 'F024_LINE_CIRCLE_TRIM' @(100, 3800) 100 }).Count -eq 1 -and @($lineCircleTrimState | Where-Object { Test-ArcState $_ 'F024_LINE_CIRCLE_TRIM' @(-9.544511501033227, 3810) 10 ([Math]::PI * 1.5) 6.192150529142163 }).Count -eq 1
  $lineEllipsePassed = $lineEllipseState.Count -eq 3 -and @($lineEllipseState | Where-Object { Test-LineState $_ 'F024_LINE_ELLIPSE' @(-200, 4000) @(-8.557770070554682, 4000) }).Count -eq 1 -and @($lineEllipseState | Where-Object { Test-EllipseState $_ 'F024_LINE_ELLIPSE' @(100, 4000) @(100, 0) 0.5 0 ([Math]::PI * 2) }).Count -eq 1 -and @($lineEllipseState | Where-Object { Test-ArcState $_ 'F024_LINE_ELLIPSE' @(-8.557770070552301, 4009.999999999998) 10 4.712388980384446 5.999818834820287 -1 }).Count -eq 1
  $lineSplinePassed = $lineSplineState.Count -eq 3 -and @($lineSplineState | Where-Object { Test-LineState $_ 'F024_LINE_SPLINE' @(100, 4200) @(291.57921680073053, 4200) }).Count -eq 1 -and @($lineSplineState | Where-Object { Test-SplineState $_ 'F024_LINE_SPLINE' @(@(301.0864722797955, 4206.89966239648), @(305.7999242205857, 4221.353569525349), @(357.8793043007138, 4244.472138071974), @(380, 4280), @(400, 4300)) @(@(301.0864722797955, 4206.89966239648), @(340.00000000000006, 4240), @(400.00000000000006, 4300.000000000001)) @(7.349693949914977, 7.349693949914977, 7.349693949914977, 7.349693949914977, 56.568542494923804, 141.4213562373095, 141.4213562373095, 141.4213562373095, 141.4213562373095) @(1, 1, 1, 1, 1) }).Count -eq 1 -and @($lineSplineState | Where-Object { Test-ArcState $_ 'F024_LINE_SPLINE' @(291.57921680073025, 4210.000000000001) 10 4.71238898038473 5.967956764852173 -1 }).Count -eq 1
  $lockedLayerRejected = $lockedState.Count -eq 2 -and @($lockedState | Where-Object { $_.objectName -eq 'AcDbLine' }).Count -eq 2 -and @($lockedState | Where-Object { $_.objectName -eq 'AcDbArc' }).Count -eq 0
  $offLayerExplicitHandleEdited = $offState.Count -eq 3 -and @($offState | Where-Object { $_.objectName -eq 'AcDbLine' }).Count -eq 2 -and @($offState | Where-Object { $_.objectName -eq 'AcDbArc' -and (Test-Point -Actual $_.details.center -Expected @(290, 4410)) -and (Test-Near -Actual $_.details.radius -Expected 10) }).Count -eq 1
  $frozenLayerExplicitHandleEdited = $frozenState.Count -eq 3 -and @($frozenState | Where-Object { $_.objectName -eq 'AcDbLine' }).Count -eq 2 -and @($frozenState | Where-Object { $_.objectName -eq 'AcDbArc' -and (Test-Point -Actual $_.details.center -Expected @(490, 4410)) -and (Test-Near -Actual $_.details.radius -Expected 10) }).Count -eq 1
  $parametricLines = @($parametricState | Where-Object { $_.objectName -eq 'AcDbLine' }); $parametricEllipses = @($parametricState | Where-Object { $_.objectName -eq 'AcDbEllipse' }); $parametricSplines = @($parametricState | Where-Object { $_.objectName -eq 'AcDbSpline' }); $parametricArcs = @($parametricState | Where-Object { $_.objectName -eq 'AcDbArc' })
  $sameParametricSourcePassed = $parametricState.Count -eq 6 -and $parametricLines.Count -eq 2 -and $parametricEllipses.Count -eq 1 -and $parametricSplines.Count -eq 1 -and $parametricArcs.Count -eq 2 -and @($parametricLines | Where-Object { $_.color -eq 1 -and $_.lineweight -eq 50 }).Count -eq 2 -and $parametricEllipses[0].color -eq 1 -and $parametricEllipses[0].lineweight -eq 50 -and $parametricSplines[0].color -eq 1 -and $parametricSplines[0].lineweight -eq 50 -and @($parametricArcs | Where-Object { $_.color -eq 1 -and $_.lineweight -eq -1 }).Count -eq 2 -and @($parametricLines | Where-Object { (Test-Point -Actual $_.details.end -Expected @(-8.557770070555, 0) -Tolerance 0.000001) }).Count -eq 1 -and @($parametricLines | Where-Object { (Test-Point -Actual $_.details.end -Expected @(290.843943859683, 200) -Tolerance 0.000001) }).Count -eq 1 -and (Test-Point -Actual $parametricEllipses[0].details.center -Expected @(100, 0) -Tolerance 0.000001) -and (Test-Point -Actual $parametricEllipses[0].details.majorAxis -Expected @(100, 0) -Tolerance 0.000001) -and $parametricSplines[0].details.controlPoints.Count -eq 4 -and (Test-Vertices -Actual $parametricSplines[0].details.controlPoints -Expected @(@(300.695133809593, 208.281263088522), @(306.627520424038, 242.283597454257), @(362.00443483552, 262.00443483552), @(400, 300))) -and (Test-Numbers -Actual $parametricSplines[0].details.knots -Expected @(0.038059957570955, 0.038059957570955, 0.038059957570955, 0.038059957570955, 1, 1, 1, 1) -Tolerance 0.000001) -and (Test-NormalizedNumbers -Actual $parametricSplines[0].details.weights -Expected @(1.114179872713, 2.076119915142, 3.038059957571, 4)) -and @($parametricSplines[0].details.weights | Select-Object -Unique).Count -gt 1 -and @($parametricArcs | Where-Object { Test-Near -Actual $_.details.radius -Expected 10 -Tolerance 0.000001 }).Count -eq 2 -and @($parametricArcs | Where-Object { Test-Point -Actual $_.details.center -Expected @(-8.557770070476, 10.000000000267) -Tolerance 0.000001 }).Count -eq 1 -and @($parametricArcs | Where-Object { Test-Point -Actual $_.details.center -Expected @(290.843943859646, 209.999999999777) -Tolerance 0.000001 }).Count -eq 1
  $rayLinePassed = $rayLineState.Count -eq 2 -and @($rayLineState | Where-Object { $_.objectName -eq 'AcDbLine' -and (Test-Point -Actual $_.details.start -Expected @(100, 4610)) -and (Test-Point -Actual $_.details.end -Expected @(100, 4700)) -and $_.color -eq 1 -and $_.lineweight -eq 50 }).Count -eq 1 -and @($rayLineState | Where-Object { $_.objectName -eq 'AcDbArc' -and (Test-Point -Actual $_.details.center -Expected @(90, 4610)) -and (Test-Near -Actual $_.details.radius -Expected 10) -and $_.color -eq 1 -and $_.lineweight -eq -1 }).Count -eq 1
  $xlineLinePassed = $xlineLineState.Count -eq 2 -and @($xlineLineState | Where-Object { $_.objectName -eq 'AcDbLine' -and (Test-Point -Actual $_.details.start -Expected @(100, 4810)) -and (Test-Point -Actual $_.details.end -Expected @(100, 4900)) -and $_.color -eq 1 -and $_.lineweight -eq 50 }).Count -eq 1 -and @($xlineLineState | Where-Object { $_.objectName -eq 'AcDbArc' -and (Test-Point -Actual $_.details.center -Expected @(90, 4810)) -and (Test-Near -Actual $_.details.radius -Expected 10) -and $_.color -eq 1 -and $_.lineweight -eq -1 }).Count -eq 1
  $rayLineNoTrimPassed = $rayLineNoTrimState.Count -eq 3 -and @($rayLineNoTrimState | Where-Object { $_.objectName -eq 'AcDbRay' -and (Test-Point -Actual $_.details.basePoint -Expected @(0, 5000)) -and (Test-Point -Actual $_.details.secondPoint -Expected @(1, 5000)) -and $_.color -eq 1 -and $_.lineweight -eq 50 }).Count -eq 1 -and @($rayLineNoTrimState | Where-Object { $_.objectName -eq 'AcDbLine' -and (Test-Point -Actual $_.details.start -Expected @(100, 5000)) -and (Test-Point -Actual $_.details.end -Expected @(100, 5100)) -and $_.color -eq 1 -and $_.lineweight -eq 50 }).Count -eq 1 -and @($rayLineNoTrimState | Where-Object { $_.objectName -eq 'AcDbArc' -and (Test-Point -Actual $_.details.center -Expected @(90, 5010)) -and (Test-Near -Actual $_.details.radius -Expected 10) -and $_.color -eq 1 -and $_.lineweight -eq -1 }).Count -eq 1
  $xlineLineNoTrimPassed = $xlineLineNoTrimState.Count -eq 3 -and @($xlineLineNoTrimState | Where-Object { $_.objectName -eq 'AcDbXline' -and (Test-Point -Actual $_.details.basePoint -Expected @(0, 5200)) -and (Test-Point -Actual $_.details.secondPoint -Expected @(1, 5200)) -and $_.color -eq 1 -and $_.lineweight -eq 50 }).Count -eq 1 -and @($xlineLineNoTrimState | Where-Object { $_.objectName -eq 'AcDbLine' -and (Test-Point -Actual $_.details.start -Expected @(100, 5200)) -and (Test-Point -Actual $_.details.end -Expected @(100, 5300)) -and $_.color -eq 1 -and $_.lineweight -eq 50 }).Count -eq 1 -and @($xlineLineNoTrimState | Where-Object { $_.objectName -eq 'AcDbArc' -and (Test-Point -Actual $_.details.center -Expected @(90, 5210)) -and (Test-Near -Actual $_.details.radius -Expected 10) -and $_.color -eq 1 -and $_.lineweight -eq -1 }).Count -eq 1
  $rayXlinePassed = $rayXlineState.Count -eq 1 -and @($rayXlineState | Where-Object { $_.objectName -eq 'AcDbArc' -and (Test-Point -Actual $_.details.center -Expected @(90, 5410)) -and (Test-Near -Actual $_.details.radius -Expected 10) -and $_.color -eq 1 -and $_.lineweight -eq -1 }).Count -eq 1
  $allPassed = $pairPassed -and $noTrimPassed -and $mixedPassed -and $adjacentPassed -and $arcZeroPassed -and $openClosePassed -and $fpa0Passed -and $fpa1Passed -and $fpa0NoTrimPassed -and $polyNoTrimPassed -and $multiplePassed -and $commandUndoPassed -and $globalUndoRedoPassed -and $sameSourceLayerPassed -and $crossLayerCurrentPassed -and $shiftPassed -and $lineCirclePassed -and $lineArcPassed -and $lineCircleTrimPassed -and $lineEllipsePassed -and $lineSplinePassed -and $rayLinePassed -and $xlineLinePassed -and $rayLineNoTrimPassed -and $xlineLineNoTrimPassed -and $rayXlinePassed -and $lockedLayerRejected -and $offLayerExplicitHandleEdited -and $frozenLayerExplicitHandleEdited -and $sameParametricSourcePassed

  Invoke-ComRetry { $scratch.Regen(1); $scratch.SaveAs($DxfOutputPath, 65) } -TimeoutSeconds 90 | Out-Null; Wait-AcadIdle $scratch
  Write-Stage 'complete'
  $result = [ordered]@{
    schemaVersion = 1; rowId = 'F-024'; benchmark = 'AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation'; engine = 'Autodesk AutoCAD 2024 desktop COM'; engineVersion = $engineVersion
    automationProcessId = $automationProcessId; automationProcessOwned = $owned; installedUpdateIdentity = $installedUpdateIdentity
    automationProcessIdentity = [ordered]@{ processId = $ownedIdentity.processId; executableName = $ownedIdentity.executableName; executableSha256 = $ownedIdentity.executableSha256; fileVersion = $ownedIdentity.fileVersion; productVersion = $ownedIdentity.productVersion; startTimeSha256 = $ownedIdentity.startTimeSha256 }
    checks = [ordered]@{ pairTrim = $pairPassed; pairNoTrim = $noTrimPassed; mixedPolylineLine = $mixedPassed; adjacentPolylineSegments = $adjacentPassed; separatedArcRadiusZero = $arcZeroPassed; openPolylineClose = $openClosePassed; filletPolyArc0 = $fpa0Passed; filletPolyArc1 = $fpa1Passed; filletPolyArc0NoTrim = $fpa0NoTrimPassed; polylineNoTrim = $polyNoTrimPassed; multiple = $multiplePassed; commandUndo = $commandUndoPassed; globalUndoRedo = $globalUndoRedoPassed; sameSourceLayerOutput = $sameSourceLayerPassed; crossLayerCurrentOutput = $crossLayerCurrentPassed; physicalShiftRadiusZero = $shiftPassed; lineCircle = $lineCirclePassed; lineArc = $lineArcPassed; lineCircleTrim = $lineCircleTrimPassed; lineEllipse = $lineEllipsePassed; lineSpline = $lineSplinePassed; rayLineTrim = $rayLinePassed; xlineLineTrim = $xlineLinePassed; rayLineNoTrim = $rayLineNoTrimPassed; xlineLineNoTrim = $xlineLineNoTrimPassed; rayXlineTrim = $rayXlinePassed; lockedLayerRejected = $lockedLayerRejected; offLayerExplicitHandleEdited = $offLayerExplicitHandleEdited; frozenLayerExplicitHandleEdited = $frozenLayerExplicitHandleEdited; sameParametricSource = $sameParametricSourcePassed }
    observations = [ordered]@{ pair = $pair; noTrim = $noTrim; mixed = $mixed; adjacent = $adjacentState; arcZero = $arcZeroState; openClose = $openCloseState; filletPolyArc0 = $fpa0State; filletPolyArc1 = $fpa1State; filletPolyArc0NoTrim = $fpa0NoTrimState; polylineNoTrim = $polyNoTrimState; multiple = $multipleState; commandUndo = $commandUndoState; globalUndoRedo = [ordered]@{ committed = $globalCommitted; undone = $globalUndone; redone = $globalRedone }; sameSourceLayer = [ordered]@{ source = $currentSourceState; current = $currentArcState }; crossLayer = [ordered]@{ first = $crossAState; second = $crossBState; current = $crossArcState }; physicalShift = [ordered]@{ entities = $shiftState; input = $shiftScreenPoint; filletRadiusAfter = $filletRadiusAfterShift }; lineCircle = $lineCircleState; lineArc = $lineArcState; lineCircleTrim = $lineCircleTrimState; lineEllipse = $lineEllipseState; lineSpline = $lineSplineState; rayLine = $rayLineState; xlineLine = $xlineLineState; rayLineNoTrim = $rayLineNoTrimState; xlineLineNoTrim = $xlineLineNoTrimState; rayXline = $rayXlineState; lockedLayer = $lockedState; offLayer = $offState; frozenLayer = $frozenState; sameParametricSource = $parametricState }
    dxfOutputSha256 = Get-FileSha256 $DxfOutputPath; parametricDxfOutputSha256 = Get-FileSha256 $ParametricDxfOutputPath; cmdNamesAfter = [string](Invoke-ComRetry { $scratch.GetVariable('CMDNAMES') }); status = if ($allPassed) { 'PASS' } else { 'FAIL' }
  }
} catch {
  Write-Error ("F-024 matrix failure: {0}`n{1}" -f $_.Exception.Message, $_.ScriptStackTrace); throw
} finally {
  $helperCleanupErrors = @()
  foreach ($helper in @($shiftEscape, $shiftHelper)) { if ($null -ne $helper) { try { Stop-InputHelper $helper 'F-024 input helper' } catch { $helperCleanupErrors += $_.Exception.Message } } }
  if ($acad -and -not $owned) { try { [uint32]$finallyProcessId = 0; [void][F024WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry { $acad.HWND }), [ref]$finallyProcessId); if ([int]$finallyProcessId -gt 0 -and $preExistingProcessIds -notcontains [int]$finallyProcessId) { $automationProcessId = [int]$finallyProcessId; $ownedIdentity = Write-OwnedPidSidecar $automationProcessId; $owned = $true } } catch {} }
  if ($parametricDocument) { try { Invoke-ComRetry { $parametricDocument.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
  if ($scratch) { try { Invoke-ComRetry { $scratch.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
  if ($owned -and $acad) { try { Invoke-ComRetry { $acad.Quit() } -TimeoutSeconds 10 | Out-Null } catch {} }
  if ($helperCleanupErrors.Count -gt 0) { throw "F-024 input helper cleanup failed: $($helperCleanupErrors -join '; ')." }
}

if (-not $result) { throw 'F-024 AutoCAD matrix produced no result.' }
$result.userDocument = [ordered]@{ isolatedOwnedProcess = $owned; blankRestored = $owned }; $status = $result.status; $result | ConvertTo-Json -Depth 12
if ($status -ne 'PASS') { exit 1 }
