param(
  [Parameter(Mandatory = $true)][string]$PidPath,
  [Parameter(Mandatory = $true)][string]$OwnershipToken,
  [Parameter(Mandatory = $true)][string]$SplineFixturePath,
  [Parameter(Mandatory = $true)][string]$SplineOutputPath
)

$ErrorActionPreference = 'Stop'
$SplineFixturePath = [IO.Path]::GetFullPath($SplineFixturePath)
$SplineOutputPath = [IO.Path]::GetFullPath($SplineOutputPath)
if (-not (Test-Path -LiteralPath $SplineFixturePath -PathType Leaf) -or [IO.Path]::GetExtension($SplineFixturePath) -ine '.dxf') { throw 'F-022 rational SPLINE fixture must be an existing DXF file.' }
if ([IO.Path]::GetExtension($SplineOutputPath) -ine '.dxf' -or (Test-Path -LiteralPath $SplineOutputPath)) { throw 'F-022 rational SPLINE output must be a new DXF path.' }

$interopCommonPath = 'C:\Program Files\Autodesk\AutoCAD 2024\Autodesk.AutoCAD.Interop.Common.dll'
if (-not (Test-Path -LiteralPath $interopCommonPath)) { throw "F-022 requires the AutoCAD 2024 ActiveX interop assembly: $interopCommonPath" }
Add-Type -Path $interopCommonPath

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class F022WindowProcess {
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

  public static IntPtr FindModelViewport(IntPtr root) {
    IntPtr result = IntPtr.Zero;
    long largestArea = 0;
    EnumChildWindows(root, delegate(IntPtr child, IntPtr unused) {
      var className = new System.Text.StringBuilder(256);
      GetClassName(child, className, className.Capacity);
      if (className.ToString() != "ACADDM_CHILD_DXGI_FLIP_MODE_VIEW_CLASS") return true;
      RECT rect;
      if (!GetWindowRect(child, out rect)) return true;
      long area = (long)(rect.Right - rect.Left) * (rect.Bottom - rect.Top);
      if (area > largestArea) { largestArea = area; result = child; }
      return true;
    }, IntPtr.Zero);
    return result;
  }
}
'@

Add-Type -ReferencedAssemblies $interopCommonPath -TypeDefinition @'
using System;
using Autodesk.AutoCAD.Interop.Common;
public static class F022HatchInterop {
  public static void AppendOuterLoop(object hatchObject, object loopObject) {
    var hatch = (IAcadHatch)hatchObject;
    var loop = (IAcadEntity)loopObject;
    hatch.AppendOuterLoop(new IAcadEntity[] { loop });
    hatch.Evaluate();
  }
}
public static class F022SplineInterop {
  private static double[] ToDoubleArray(object value) {
    var source = (Array)value;
    var result = new double[source.Length];
    for (var index = 0; index < source.Length; index++) result[index] = Convert.ToDouble(source.GetValue(index));
    return result;
  }
  public static double[] ControlPoints(object splineObject) {
    return ToDoubleArray(((IAcadSpline)splineObject).ControlPoints);
  }
  public static double[] Knots(object splineObject) {
    return ToDoubleArray(((IAcadSpline)splineObject).Knots);
  }
  public static double[] Weights(object splineObject) {
    var spline = (IAcadSpline)splineObject;
    if (!spline.IsRational) return new double[0];
    return ToDoubleArray(spline.Weights);
  }
  public static bool IsRational(object splineObject) {
    return ((IAcadSpline)splineObject).IsRational;
  }
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
  param([Parameter(Mandatory = $true)]$Document, [int]$TimeoutSeconds = 30)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 100
    try { if ([string]::IsNullOrWhiteSpace([string]$Document.GetVariable('CMDNAMES')) -and [int]$Document.GetVariable('CMDACTIVE') -eq 0) { return } } catch {}
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "AutoCAD did not return idle. CMDNAMES='$($Document.GetVariable('CMDNAMES'))' LASTPROMPT='$($Document.GetVariable('LASTPROMPT'))'"
}

function New-Line {
  param($Document, [string]$Layer, [double]$StartX, [double]$StartY, [double]$EndX, [double]$EndY)
  [double[]]$start = @($StartX, $StartY, 0); [double[]]$end = @($EndX, $EndY, 0)
  $entity = Invoke-ComRetry { $Document.ModelSpace.AddLine($start, $end) }
  Invoke-ComRetry { $entity.Layer = $Layer; $entity.Color = 1; $entity.Lineweight = 50 } | Out-Null
  return $entity
}

function Get-Point2 { param($Value); return @([double]$Value[0], [double]$Value[1]) }
function Test-Near { param([double]$Actual, [double]$Expected, [double]$Tolerance = 0.002); return [Math]::Abs($Actual - $Expected) -le $Tolerance }
function Test-Point { param($Actual, $Expected, [double]$Tolerance = 0.002); return (Test-Near $Actual[0] $Expected[0] $Tolerance) -and (Test-Near $Actual[1] $Expected[1] $Tolerance) }

function Test-NumberList {
  param($Actual, $Expected, [double]$Tolerance = 0.002)
  if ($Actual.Count -ne $Expected.Count) { return $false }
  for ($index = 0; $index -lt $Expected.Count; $index += 1) { if (-not (Test-Near ([double]$Actual[$index]) ([double]$Expected[$index]) $Tolerance)) { return $false } }
  return $true
}

function Test-PointList {
  param($Actual, $Expected, [double]$Tolerance = 0.002)
  if ($Actual.Count -ne $Expected.Count) { return $false }
  for ($index = 0; $index -lt $Expected.Count; $index += 1) { if (-not (Test-Point $Actual[$index] $Expected[$index] $Tolerance)) { return $false } }
  return $true
}

function Get-Bounds {
  param($Entity)
  $minimum = $null; $maximum = $null
  Invoke-ComRetry { $Entity.GetBoundingBox([ref]$minimum, [ref]$maximum) } | Out-Null
  return [ordered]@{ min = Get-Point2 $minimum; max = Get-Point2 $maximum }
}

function Get-EntityState {
  param($Entity)
  $name = [string](Invoke-ComRetry { $Entity.ObjectName })
  $bounds = Get-Bounds $Entity
  $details = [ordered]@{}
  if ($name -eq 'AcDbLine') { $details.start = Get-Point2 (Invoke-NonNullCom { $Entity.StartPoint } 'Line start'); $details.end = Get-Point2 (Invoke-NonNullCom { $Entity.EndPoint } 'Line end') }
  elseif ($name -eq 'AcDbPolyline') {
    $flat = @(Invoke-NonNullCom { $Entity.Coordinates } 'Polyline coordinates'); $vertices = @()
    for ($index = 0; $index + 1 -lt $flat.Count; $index += 2) { $vertices += ,@([double]$flat[$index], [double]$flat[$index + 1]) }
    $details.vertices = $vertices; $details.closed = [bool](Invoke-ComRetry { $Entity.Closed }); $details.bulges = @(); $details.widths = @()
    for ($index = 0; $index -lt $vertices.Count; $index += 1) {
      $details.bulges += [double](Invoke-ComRetry { $Entity.GetBulge($index) })
      [double]$startWidth = 0; [double]$endWidth = 0
      Invoke-ComRetry { $Entity.GetWidth($index, [ref]$startWidth, [ref]$endWidth) } | Out-Null
      $details.widths += ,@($startWidth, $endWidth)
    }
  }
  elseif ($name -eq 'AcDbArc') {
    $radius = Invoke-ComRetry { $Entity.Radius }
    $arcLength = Invoke-ComRetry { $Entity.ArcLength }
    $totalAngle = Invoke-ComRetry { $Entity.TotalAngle }
    if ($null -eq $radius -and $null -ne $arcLength -and $null -ne $totalAngle -and [Math]::Abs([double]$totalAngle) -gt 0.000000001) {
      $radius = [double]$arcLength / [double]$totalAngle
    }
    $details.radius = if ($null -eq $radius) { $null } else { [double]$radius }
    $details.arcLength = if ($null -eq $arcLength) { $null } else { [double]$arcLength }
    $details.totalAngle = if ($null -eq $totalAngle) { $null } else { [double]$totalAngle }
    $startAngle = Invoke-ComRetry { $Entity.StartAngle }
    $endAngle = Invoke-ComRetry { $Entity.EndAngle }
    $details.startAngle = if ($null -eq $startAngle) { $null } else { [double]$startAngle }
    $details.endAngle = if ($null -eq $endAngle) { $null } else { [double]$endAngle }
  }
  elseif ($name -eq 'AcDbEllipse') { $details.ratio = [double](Invoke-NonNullCom { $Entity.RadiusRatio } 'Ellipse ratio'); $details.startParameter = [double](Invoke-NonNullCom { $Entity.StartParameter } 'Ellipse start parameter'); $details.endParameter = [double](Invoke-NonNullCom { $Entity.EndParameter } 'Ellipse end parameter') }
  elseif ($name -eq 'AcDbSpline') {
    $degree = Invoke-ComRetry { $Entity.Degree }
    $closed = Invoke-ComRetry { $Entity.Closed }
    $details.degree = if ($null -eq $degree) { $null } else { [int]$degree }
    $details.closed = if ($null -eq $closed) { $null } else { [bool]$closed }
    $controlFlat = @([F022SplineInterop]::ControlPoints($Entity)); $details.controlPoints = @()
    for ($index = 0; $index + 2 -lt $controlFlat.Count; $index += 3) { $details.controlPoints += ,@([double]$controlFlat[$index], [double]$controlFlat[$index + 1]) }
    $details.knots = @([F022SplineInterop]::Knots($Entity) | ForEach-Object { [double]$_ })
    $details.weights = @([F022SplineInterop]::Weights($Entity) | ForEach-Object { [double]$_ })
    $details.rational = [bool][F022SplineInterop]::IsRational($Entity)
    $details.start = @($details.controlPoints[0][0], $details.controlPoints[0][1])
    $details.end = @($details.controlPoints[-1][0], $details.controlPoints[-1][1])
  }
  return [ordered]@{
    objectName = $name; handle = [string](Invoke-ComRetry { $Entity.Handle }); layer = [string](Invoke-ComRetry { $Entity.Layer })
    color = [int](Invoke-ComRetry { $Entity.Color }); linetype = [string](Invoke-ComRetry { $Entity.Linetype }); lineweight = [int](Invoke-ComRetry { $Entity.Lineweight })
    bounds = $bounds; details = $details
  }
}

function Get-LayerStates {
  param($Document, [string]$Layer)
  $states = @()
  $count = [int](Invoke-ComRetry { $Document.ModelSpace.Count })
  for ($index = 0; $index -lt $count; $index += 1) {
    $entity = Invoke-ComRetry { $Document.ModelSpace.Item($index) }
    if ([string](Invoke-ComRetry { $entity.Layer }) -eq $Layer) { $states += Get-EntityState $entity }
  }
  return @($states)
}

function Test-LineState {
  param($State, $First, $Second)
  if ($State.objectName -ne 'AcDbLine') { return $false }
  return ((Test-Point $State.details.start $First) -and (Test-Point $State.details.end $Second)) -or ((Test-Point $State.details.start $Second) -and (Test-Point $State.details.end $First))
}

function Test-LineSet {
  param($States, $Expected)
  if ($States.Count -ne $Expected.Count) { return $false }
  foreach ($line in $Expected) { if (@($States | Where-Object { Test-LineState $_ $line[0] $line[1] }).Count -ne 1) { return $false } }
  return $true
}

function Test-PolylineState {
  param($State, $ExpectedVertices, $ExpectedBulges, $ExpectedWidths)
  if ($State.objectName -ne 'AcDbPolyline' -or $State.details.closed -or $State.details.vertices.Count -ne $ExpectedVertices.Count) { return $false }
  for ($index = 0; $index -lt $ExpectedVertices.Count; $index += 1) {
    if (-not (Test-Point $State.details.vertices[$index] $ExpectedVertices[$index])) { return $false }
    if (-not (Test-Near $State.details.bulges[$index] $ExpectedBulges[$index])) { return $false }
    if (-not (Test-Near $State.details.widths[$index][0] $ExpectedWidths[$index][0]) -or -not (Test-Near $State.details.widths[$index][1] $ExpectedWidths[$index][1])) { return $false }
  }
  return $true
}

$script:trimInvocation = 0
function Invoke-Trim {
  param($Document, [int]$Mode, [string[]]$BoundaryPicks, [string]$Body)
  $script:trimInvocation += 1
  Write-Host "[F-022] trim-start index=$script:trimInvocation mode=$Mode boundaries=$($BoundaryPicks.Count)"
  Invoke-ComRetry { $Document.SendCommand("TRIMEXTENDMODE`n$Mode`n") } | Out-Null
  Wait-AcadIdle $Document
  $script = "_.TRIM`n"
  if ($Mode -eq 0) { foreach ($pick in $BoundaryPicks) { $script += "$pick`n" }; $script += "`n" }
  $script += $Body
  Invoke-ComRetry { $Document.SendCommand($script) } | Out-Null
  Wait-AcadIdle $Document
  Write-Host "[F-022] trim-end index=$script:trimInvocation"
}

function Invoke-TrimBoundaryHandle {
  param($Document, [string]$BoundaryHandle, [double]$TargetX, [double]$TargetY)
  $script:trimInvocation += 1
  Write-Host "[F-022] trim-start index=$script:trimInvocation mode=0 boundaryHandle=$BoundaryHandle"
  Invoke-ComRetry { $Document.SendCommand("TRIMEXTENDMODE`n0`n") } | Out-Null
  Wait-AcadIdle $Document
  $target = "$TargetX,$TargetY"
  $lisp = "(progn (setq f022:ss (ssadd (handent `"$BoundaryHandle`"))) (command `"_.TRIM`" f022:ss `"`" `"_non`" `"$target`" `"`") (princ))`n"
  Invoke-ComRetry { $Document.SendCommand($lisp) } | Out-Null
  Wait-AcadIdle $Document
  Write-Host "[F-022] trim-end index=$script:trimInvocation"
}

function Add-CuttingLine { param($Document, [double]$X, [double]$Y1, [double]$Y2); return New-Line $Document 'F022_BOUNDARY' $X $Y1 $X $Y2 }

function Get-ModelScreenPoint {
  param($Document, [IntPtr]$ViewportHandle, [double]$WorldX, [double]$WorldY)
  $rect = New-Object F022WindowProcess+RECT
  if (-not [F022WindowProcess]::GetWindowRect($ViewportHandle, [ref]$rect)) { throw 'F-022 could not read the AutoCAD model viewport rectangle.' }
  $screenSize = @(Invoke-NonNullCom { $Document.GetVariable('SCREENSIZE') } 'SCREENSIZE')
  $viewCenter = @(Invoke-NonNullCom { $Document.GetVariable('VIEWCTR') } 'VIEWCTR')
  $viewHeight = [double](Invoke-NonNullCom { $Document.GetVariable('VIEWSIZE') } 'VIEWSIZE')
  $viewportWidth = $rect.Right - $rect.Left; $viewportHeight = $rect.Bottom - $rect.Top
  if ($screenSize.Count -lt 2 -or $viewCenter.Count -lt 2 -or $viewportWidth -ne [int][Math]::Round([double]$screenSize[0]) -or $viewportHeight -ne [int][Math]::Round([double]$screenSize[1]) -or -not ($viewHeight -gt 0)) {
    throw "F-022 viewport/SCREENSIZE mismatch: rect=$viewportWidth x $viewportHeight screen=$($screenSize -join 'x') viewHeight=$viewHeight"
  }
  $pixelsPerWorldUnit = [double]$screenSize[1] / $viewHeight
  return [ordered]@{
    x = [int][Math]::Round($rect.Left + [double]$screenSize[0] / 2 + ($WorldX - [double]$viewCenter[0]) * $pixelsPerWorldUnit)
    y = [int][Math]::Round($rect.Top + [double]$screenSize[1] / 2 - ($WorldY - [double]$viewCenter[1]) * $pixelsPerWorldUnit)
    viewport = @($rect.Left, $rect.Top, $rect.Right, $rect.Bottom)
    screenSize = @([int][Math]::Round([double]$screenSize[0]), [int][Math]::Round([double]$screenSize[1]))
    viewCenter = @([double]$viewCenter[0], [double]$viewCenter[1])
    viewHeight = $viewHeight
  }
}

function Get-F022StringSha256 {
  param([string]$Value)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value))).Replace('-', '').ToLowerInvariant()) }
  finally { $algorithm.Dispose() }
}

function Get-F022FileSha256 {
  param([string]$Path)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  $stream = [IO.File]::OpenRead($Path)
  try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()) }
  finally { $stream.Dispose(); $algorithm.Dispose() }
}

function Get-OwnedAcadIdentity {
  param([int]$ProcessId)
  $process = Get-Process -Id $ProcessId -ErrorAction Stop
  $path = [IO.Path]::GetFullPath([string]$process.Path)
  if ([IO.Path]::GetFileName($path) -ine 'acad.exe') { throw "F-022 PID $ProcessId is not acad.exe." }
  $startTimeUtc = $process.StartTime.ToUniversalTime().ToString('o')
  $version = (Get-Item -LiteralPath $path -ErrorAction Stop).VersionInfo
  return [ordered]@{
    processId = $ProcessId
    executablePath = $path
    executableName = [IO.Path]::GetFileName($path)
    executableSha256 = Get-F022FileSha256 $path
    fileVersion = [string]$version.FileVersion
    productVersion = [string]$version.ProductVersion
    startTimeUtc = $startTimeUtc
    startTimeSha256 = Get-F022StringSha256 $startTimeUtc
  }
}

function Write-OwnedPidSidecar {
  param([int]$ProcessId)
  $identity = Get-OwnedAcadIdentity $ProcessId
  [ordered]@{
    schemaVersion = 1
    processId = $identity.processId
    executablePath = $identity.executablePath
    executableName = $identity.executableName
    executableSha256 = $identity.executableSha256
    fileVersion = $identity.fileVersion
    productVersion = $identity.productVersion
    startTimeUtc = $identity.startTimeUtc
    startTimeSha256 = $identity.startTimeSha256
    owned = $true
    token = $OwnershipToken
  } | ConvertTo-Json -Compress | Set-Content -LiteralPath $PidPath -Encoding ascii
  return $identity
}

function Get-InstalledAutoCadUpdateIdentity {
  $roots = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
  )
  $matches = @($roots | Where-Object { Test-Path $_ } | ForEach-Object {
    Get-ChildItem -LiteralPath $_ -ErrorAction Stop | ForEach-Object {
      $item = Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue
      if ([string]$item.DisplayName -eq 'Autodesk AutoCAD 2024.1.2 Update') {
        [ordered]@{ displayName = [string]$item.DisplayName; displayVersion = [string]$item.DisplayVersion }
      }
    }
  })
  if ($matches.Count -ne 1) { throw "F-022 requires exactly one installed AutoCAD 2024.1.2 Update registration; found $($matches.Count)." }
  return $matches[0]
}

$preExistingProcessIds = @(Get-Process -Name 'acad' -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.Id })
$acad = $null; $scratch = $null; $splineDocument = $null; $result = $null; $automationProcessId = 0; $owned = $false; $ownedIdentity = $null; $installedUpdateIdentity = $null
try {
  $acad = New-Object -ComObject AutoCAD.Application.24.3
  [uint32]$resolvedProcessId = 0
  [void][F022WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry { $acad.HWND }), [ref]$resolvedProcessId)
  $automationProcessId = [int]$resolvedProcessId
  $owned = $automationProcessId -gt 0 -and $preExistingProcessIds -notcontains $automationProcessId
  Write-Host "[F-022] automation-process pid=$automationProcessId owned=$owned"
  if (-not $owned) { throw 'F-022 refuses to use a pre-existing AutoCAD process.' }
  $ownedIdentity = Write-OwnedPidSidecar $automationProcessId
  $installedUpdateIdentity = Get-InstalledAutoCadUpdateIdentity
  Invoke-ComRetry { $acad.Visible = $true } | Out-Null
  $scratch = if ([int](Invoke-ComRetry { $acad.Documents.Count }) -gt 0) { Invoke-ComRetry { $acad.ActiveDocument } } else { Invoke-ComRetry { $acad.Documents.Add() } }
  if ([string](Invoke-ComRetry { $scratch.FullName }) -or [int](Invoke-ComRetry { $scratch.ModelSpace.Count }) -ne 0) { throw 'F-022 refuses a saved or non-blank drawing.' }
  Invoke-ComRetry { $scratch.Activate() } | Out-Null
  $layerNames = @('F022_BOUNDARY','F022_STANDARD','F022_QUICK','F022_QUICK_TRIM','F022_EDGE_EXTEND','F022_EDGE_NO','F022_ERASE','F022_UNDO','F022_PROJECT_NONE','F022_PROJECT_UCS','F022_PROJECT_VIEW','F022_LINE','F022_POLYLINE','F022_CIRCLE','F022_ARC','F022_ELLIPSE','F022_SPLINE','F022_HATCH_TARGET','F022_HATCH_BOUNDARY','F022_BLOCK_TARGET','F022_BLOCK_INHERITED_TARGET','F022_BLOCK_HIDDEN_TARGET','F022_BLOCK_FROZEN_TARGET','F022_BLOCK_CHILD_HIDDEN','F022_BLOCK_CHILD_FROZEN','F022_FENCE','F022_CROSSING','F022_SHIFT_EXTEND','F022_LOCKED','F022_HIDDEN')
  foreach ($name in $layerNames) { $null = Invoke-ComRetry { $scratch.Layers.Add($name) } }
  [double[]]$lower = @(-1000, -1000, 0); [double[]]$upper = @(10000, 8000, 0); Invoke-ComRetry { $acad.ZoomWindow($lower, $upper) } | Out-Null

  $standardBefore = Get-EntityState (New-Line $scratch 'F022_STANDARD' 0 0 1000 0)
  $null = Add-CuttingLine $scratch 250 -100 100; $null = Add-CuttingLine $scratch 750 -100 100
  Invoke-Trim $scratch 0 @('250,50','750,50') "500,0`n`n"
  $standard = @(Get-LayerStates $scratch 'F022_STANDARD')

  $null = New-Line $scratch 'F022_QUICK' 0 1000 1000 1000
  Invoke-Trim $scratch 1 @() "500,1000`n`n"
  $quick = @(Get-LayerStates $scratch 'F022_QUICK')

  $null = New-Line $scratch 'F022_QUICK_TRIM' 0 1300 1000 1300
  $null = Add-CuttingLine $scratch 250 1200 1400; $null = Add-CuttingLine $scratch 750 1200 1400
  Invoke-Trim $scratch 1 @() "500,1300`n`n"
  $quickTrim = @(Get-LayerStates $scratch 'F022_QUICK_TRIM')

  $null = New-Line $scratch 'F022_EDGE_EXTEND' 0 2000 1000 2000; $null = Add-CuttingLine $scratch 500 2100 2200
  Invoke-Trim $scratch 0 @('500,2150') "_Edge`n_Extend`n100,2000`n`n"
  $edgeExtend = @(Get-LayerStates $scratch 'F022_EDGE_EXTEND')

  $null = New-Line $scratch 'F022_EDGE_NO' 0 2500 1000 2500; $null = Add-CuttingLine $scratch 500 2600 2700
  Invoke-Trim $scratch 0 @('500,2650') "_Edge`n_No`n100,2500`n`n"
  $edgeNo = @(Get-LayerStates $scratch 'F022_EDGE_NO')

  $null = New-Line $scratch 'F022_ERASE' 0 3000 1000 3000; $null = Add-CuttingLine $scratch 500 2900 3100
  Invoke-Trim $scratch 0 @('500,3050') "_Erase`n100,3000`n`n`n"
  $erase = @(Get-LayerStates $scratch 'F022_ERASE')

  $null = New-Line $scratch 'F022_UNDO' 0 3500 1000 3500; $null = Add-CuttingLine $scratch 500 3400 3600
  Invoke-Trim $scratch 0 @('500,3550') "100,3500`n_Undo`n`n"
  $undo = @(Get-LayerStates $scratch 'F022_UNDO')

  $projectStates = [ordered]@{}
  $projectSpecs = @(@('NONE','F022_PROJECT_NONE',4000), @('UCS','F022_PROJECT_UCS',4300), @('VIEW','F022_PROJECT_VIEW',4600))
  foreach ($spec in $projectSpecs) {
    $keyword = [string]$spec[0]; $layer = [string]$spec[1]; $y = [double]$spec[2]
    $null = New-Line $scratch $layer 0 $y 1000 $y; $null = Add-CuttingLine $scratch 500 ($y - 100) ($y + 100)
    Invoke-Trim $scratch 0 @("500,$($y + 50)") "_Project`n_$keyword`n100,$y`n`n"
    $projectStates[$keyword.ToLowerInvariant()] = @(Get-LayerStates $scratch $layer)
  }

  $familyBefore = [ordered]@{}
  $familyBefore.line = Get-EntityState (New-Line $scratch 'F022_LINE' 0 5200 1000 5200); $null = Add-CuttingLine $scratch 500 5100 5300
  Invoke-Trim $scratch 0 @('500,5250') "100,5200`n`n"

  [double[]]$polyPoints = @(2000,5200,2100,5200,2100,5300,2000,5300)
  $polyline = Invoke-ComRetry { $scratch.ModelSpace.AddLightWeightPolyline($polyPoints) }; Invoke-ComRetry { $polyline.Layer = 'F022_POLYLINE'; $polyline.Color = 1; $polyline.Lineweight = 50 } | Out-Null
  Invoke-ComRetry { $polyline.Closed = $true; $polyline.SetWidth(0,2,6); $polyline.SetWidth(1,3,5); $polyline.SetBulge(1,1) } | Out-Null
  $familyBefore.polyline = Get-EntityState $polyline; $null = Add-CuttingLine $scratch 2025 5100 5350; $null = Add-CuttingLine $scratch 2075 5100 5350
  Invoke-Trim $scratch 0 @('2025,5325','2075,5325') "2050,5200`n`n"

  [double[]]$circleCenter = @(4000,5200,0); $circle = Invoke-ComRetry { $scratch.ModelSpace.AddCircle($circleCenter,100) }; Invoke-ComRetry { $circle.Layer='F022_CIRCLE'; $circle.Color=1; $circle.Lineweight=50 } | Out-Null
  $familyBefore.circle = Get-EntityState $circle; $null = Add-CuttingLine $scratch 4050 5050 5350
  Invoke-Trim $scratch 0 @('4050,5300') "4100,5200`n`n"

  [double[]]$arcCenter = @(6000,5200,0); $arc = Invoke-ComRetry { $scratch.ModelSpace.AddArc($arcCenter,100,0,[Math]::PI) }; Invoke-ComRetry { $arc.Layer='F022_ARC'; $arc.Color=1; $arc.Lineweight=50 } | Out-Null
  $familyBefore.arc = Get-EntityState $arc; $null = Add-CuttingLine $scratch 6050 5150 5350
  Invoke-Trim $scratch 0 @('6050,5320') "6080,5260`n`n"

  [double[]]$ellipseCenter = @(8000,5200,0); [double[]]$ellipseAxis = @(200,0,0); $ellipse = Invoke-ComRetry { $scratch.ModelSpace.AddEllipse($ellipseCenter,$ellipseAxis,0.5) }; Invoke-ComRetry { $ellipse.Layer='F022_ELLIPSE'; $ellipse.Color=1; $ellipse.Lineweight=50 } | Out-Null
  $familyBefore.ellipse = Get-EntityState $ellipse; $null = Add-CuttingLine $scratch 8100 5050 5350
  Invoke-Trim $scratch 0 @('8100,5300') "8200,5200`n`n"

  [double[]]$hatchLoopPoints = @(3000,5500,3300,5500,3300,5700,3000,5700)
  $hatchLoop = Invoke-ComRetry { $scratch.ModelSpace.AddLightWeightPolyline($hatchLoopPoints) }
  Invoke-ComRetry { $hatchLoop.Layer='F022_HATCH_BOUNDARY'; $hatchLoop.Closed=$true } | Out-Null
  $hatch = Invoke-ComRetry { $scratch.ModelSpace.AddHatch(0,'SOLID',$false) }
  Invoke-ComRetry { $hatch.Layer='F022_HATCH_BOUNDARY'; [F022HatchInterop]::AppendOuterLoop($hatch,$hatchLoop) } | Out-Null
  $null = New-Line $scratch 'F022_HATCH_TARGET' 2900 5600 3400 5600
  Invoke-Trim $scratch 0 @('3150,5650') "3150,5600`n`n"
  $hatchTarget = @(Get-LayerStates $scratch 'F022_HATCH_TARGET')

  $blockLisp = "(progn (vl-load-com) (setq f022:doc (vla-get-ActiveDocument (vlax-get-acad-object))) (setq f022:inner (vla-Add (vla-get-Blocks f022:doc) (vlax-3d-point '(0.0 0.0 0.0)) `"F022_TRIM_INNER`")) (vla-AddLine f022:inner (vlax-3d-point '(50.0 -100.0 0.0)) (vlax-3d-point '(50.0 100.0 0.0))) (setq f022:outer (vla-Add (vla-get-Blocks f022:doc) (vlax-3d-point '(0.0 0.0 0.0)) `"F022_TRIM_OUTER`")) (vla-InsertBlock f022:outer (vlax-3d-point '(0.0 0.0 0.0)) `"F022_TRIM_INNER`" 1.0 1.0 1.0 0.0) (setq f022:insert (vla-InsertBlock (vla-get-ModelSpace f022:doc) (vlax-3d-point '(4000.0 5600.0 0.0)) `"F022_TRIM_OUTER`" 2.0 1.0 1.0 0.0)) (vla-put-Layer f022:insert `"F022_BOUNDARY`") (setvar `"USERS2`" (vla-get-Handle f022:insert)) (princ))`n"
  Invoke-ComRetry { $scratch.SendCommand($blockLisp) } | Out-Null; Wait-AcadIdle $scratch
  $blockReference = Invoke-NonNullCom { $scratch.HandleToObject([string](Invoke-ComRetry { $scratch.GetVariable('USERS2') })) } 'F022 nested block reference'
  $null = New-Line $scratch 'F022_BLOCK_TARGET' 3900 5600 4300 5600
  Invoke-Trim $scratch 0 @('4100,5650') "4000,5600`n`n"
  $blockTarget = @(Get-LayerStates $scratch 'F022_BLOCK_TARGET')

  $layeredBlockLisp = "(progn (vl-load-com) (setq f022:doc (vla-get-ActiveDocument (vlax-get-acad-object))) (setq f022:layered (vla-Add (vla-get-Blocks f022:doc) (vlax-3d-point '(0.0 0.0 0.0)) `"F022_LAYERED_CUT`")) (setq f022:visible (vla-AddLine f022:layered (vlax-3d-point '(25.0 -50.0 0.0)) (vlax-3d-point '(25.0 50.0 0.0)))) (setq f022:hidden (vla-AddLine f022:layered (vlax-3d-point '(50.0 50.0 0.0)) (vlax-3d-point '(50.0 150.0 0.0)))) (vla-put-Layer f022:hidden `"F022_BLOCK_CHILD_HIDDEN`") (setq f022:frozen (vla-AddLine f022:layered (vlax-3d-point '(75.0 150.0 0.0)) (vlax-3d-point '(75.0 250.0 0.0)))) (vla-put-Layer f022:frozen `"F022_BLOCK_CHILD_FROZEN`") (setq f022:layeredInsert (vla-InsertBlock (vla-get-ModelSpace f022:doc) (vlax-3d-point '(4000.0 5900.0 0.0)) `"F022_LAYERED_CUT`" 1.0 1.0 1.0 0.0)) (vla-put-Layer f022:layeredInsert `"F022_BOUNDARY`") (setvar `"USERS3`" (vla-get-Handle f022:layeredInsert)) (princ))`n"
  Invoke-ComRetry { $scratch.SendCommand($layeredBlockLisp) } | Out-Null; Wait-AcadIdle $scratch
  $hiddenChildLayer = Invoke-ComRetry { $scratch.Layers.Item('F022_BLOCK_CHILD_HIDDEN') }
  $frozenChildLayer = Invoke-ComRetry { $scratch.Layers.Item('F022_BLOCK_CHILD_FROZEN') }
  Invoke-ComRetry { $hiddenChildLayer.LayerOn = $false; $frozenChildLayer.Freeze = $true } | Out-Null
  $null = New-Line $scratch 'F022_BLOCK_INHERITED_TARGET' 3900 5900 4300 5900
  $null = New-Line $scratch 'F022_BLOCK_HIDDEN_TARGET' 3900 6000 4300 6000
  $null = New-Line $scratch 'F022_BLOCK_FROZEN_TARGET' 3900 6100 4300 6100
  Invoke-ComRetry { $scratch.SendCommand("_.REGENALL`n") } | Out-Null; Wait-AcadIdle $scratch
  $layeredBlockHandle = [string](Invoke-ComRetry { $scratch.GetVariable('USERS3') })
  Invoke-TrimBoundaryHandle $scratch $layeredBlockHandle 4000 5900
  Invoke-TrimBoundaryHandle $scratch $layeredBlockHandle 4000 6000
  Invoke-TrimBoundaryHandle $scratch $layeredBlockHandle 4000 6100
  $layeredBlockTargets = [ordered]@{
    inherited = @(Get-LayerStates $scratch 'F022_BLOCK_INHERITED_TARGET')
    hidden = @(Get-LayerStates $scratch 'F022_BLOCK_HIDDEN_TARGET')
    frozen = @(Get-LayerStates $scratch 'F022_BLOCK_FROZEN_TARGET')
  }
  Invoke-ComRetry { $hiddenChildLayer.LayerOn = $true; $frozenChildLayer.Freeze = $false } | Out-Null

  [double[]]$splineFitPoints = @(0,6500,0,250,6600,0,500,6500,0,750,6400,0,1000,6500,0)
  [double[]]$splineStartTangent = @(1,0,0); [double[]]$splineEndTangent = @(1,0,0)
  $spline = Invoke-ComRetry { $scratch.ModelSpace.AddSpline($splineFitPoints,$splineStartTangent,$splineEndTangent) }; Invoke-ComRetry { $spline.Layer='F022_SPLINE'; $spline.Color=1; $spline.Lineweight=50 } | Out-Null
  $familyBefore.spline = Get-EntityState $spline; $null = Add-CuttingLine $scratch 250 6250 6750
  Invoke-Trim $scratch 0 @('250,6550') "100,6500`n`n"

  $null = New-Line $scratch 'F022_FENCE' 0 7000 1000 7000; $null = Add-CuttingLine $scratch 250 6900 7100; $null = Add-CuttingLine $scratch 750 6900 7100
  Invoke-Trim $scratch 0 @('250,7050','750,7050') "_Fence`n500,6900`n500,7100`n`n`n"
  $fence = @(Get-LayerStates $scratch 'F022_FENCE')

  $null = New-Line $scratch 'F022_CROSSING' 0 7300 1000 7300; $null = Add-CuttingLine $scratch 250 7200 7400; $null = Add-CuttingLine $scratch 750 7200 7400
  Invoke-Trim $scratch 0 @('250,7350','750,7350') "_Crossing`n400,7250`n600,7350`n`n"
  $crossing = @(Get-LayerStates $scratch 'F022_CROSSING')

  $null = New-Line $scratch 'F022_SHIFT_EXTEND' 0 7700 400 7700; $null = Add-CuttingLine $scratch 500 7600 7800
  [double[]]$shiftZoomLower = @(-100,7400,0); [double[]]$shiftZoomUpper = @(700,8000,0); Invoke-ComRetry { $acad.ZoomWindow($shiftZoomLower,$shiftZoomUpper) } | Out-Null
  Start-Sleep -Milliseconds 500
  $viewportHandle = [F022WindowProcess]::FindModelViewport([IntPtr][int64](Invoke-ComRetry { $acad.HWND }))
  if ($viewportHandle -eq [IntPtr]::Zero) { throw 'F-022 could not find the AutoCAD DXGI model viewport.' }
  $shiftScreenPoint = Get-ModelScreenPoint $scratch $viewportHandle 390 7700
  Invoke-ComRetry { $scratch.SendCommand("TRIMEXTENDMODE`n0`n") } | Out-Null; Wait-AcadIdle $scratch
  $shiftHelperPath = Join-Path $PSScriptRoot 'f022-shift-click.ps1'
  $shiftHelper = Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$shiftHelperPath,'-MainWindowHandle',([string][int64](Invoke-ComRetry { $acad.HWND })),'-ExpectedProcessId',([string]$automationProcessId),'-Action','ShiftClick','-ScreenX',([string]$shiftScreenPoint.x),'-ScreenY',([string]$shiftScreenPoint.y),'-DelayMilliseconds','1000') -WindowStyle Hidden -PassThru
  Invoke-ComRetry { $scratch.SendCommand("_.TRIM`n500,7750`n`n") } -TimeoutSeconds 20 | Out-Null
  if (-not $shiftHelper.WaitForExit(15000)) { throw 'F-022 physical Shift-click helper did not exit.' }
  if ($shiftHelper.ExitCode -ne 0) { throw "F-022 physical Shift-click helper exited $($shiftHelper.ExitCode)." }
  Wait-AcadIdle $scratch
  $shiftExtend = @(Get-LayerStates $scratch 'F022_SHIFT_EXTEND')

  $familyAfter = [ordered]@{}
  foreach ($name in @('line','polyline','circle','arc','ellipse','spline')) { $familyAfter[$name] = @(Get-LayerStates $scratch "F022_$($name.ToUpperInvariant())") }

  $lockedLayer = Invoke-ComRetry { $scratch.Layers.Item('F022_LOCKED') }; $null = New-Line $scratch 'F022_LOCKED' 0 6000 1000 6000; $null = Add-CuttingLine $scratch 500 5900 6100
  Invoke-ComRetry { $lockedLayer.Lock = $true } | Out-Null
  Write-Host '[F-022] locked-trim-start'
  Invoke-ComRetry { $scratch.SendCommand("TRIMEXTENDMODE`n0`n") } | Out-Null; Wait-AcadIdle $scratch
  $cleanupProcess = Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$shiftHelperPath,'-MainWindowHandle',([string][int64](Invoke-ComRetry { $acad.HWND })),'-ExpectedProcessId',([string]$automationProcessId),'-Action','Escape','-DelayMilliseconds','1000') -WindowStyle Hidden -PassThru
  Invoke-ComRetry { $scratch.SendCommand("_.TRIM`n500,6050`n`n100,6000`n") } | Out-Null
  if (-not $cleanupProcess.WaitForExit(10000)) { throw 'F-022 locked-layer ESC helper did not exit.' }
  Wait-AcadIdle $scratch
  Write-Host '[F-022] locked-trim-end'
  $locked = @(Get-LayerStates $scratch 'F022_LOCKED')

  $hiddenLayer = Invoke-ComRetry { $scratch.Layers.Item('F022_HIDDEN') }; $null = New-Line $scratch 'F022_HIDDEN' 0 6200 1000 6200; $null = Add-CuttingLine $scratch 500 6100 6300
  Invoke-ComRetry { $hiddenLayer.LayerOn = $false } | Out-Null
  Write-Host '[F-022] hidden-trim-start'
  Invoke-ComRetry { $scratch.SendCommand("TRIMEXTENDMODE`n0`n") } | Out-Null; Wait-AcadIdle $scratch
  $hiddenCleanupProcess = Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$shiftHelperPath,'-MainWindowHandle',([string][int64](Invoke-ComRetry { $acad.HWND })),'-ExpectedProcessId',([string]$automationProcessId),'-Action','Escape','-DelayMilliseconds','1000') -WindowStyle Hidden -PassThru
  Invoke-ComRetry { $scratch.SendCommand("_.TRIM`n500,6250`n`n100,6200`n") } | Out-Null
  if (-not $hiddenCleanupProcess.WaitForExit(10000)) { throw 'F-022 hidden-layer ESC helper did not exit.' }
  Wait-AcadIdle $scratch
  Invoke-ComRetry { $hiddenLayer.LayerOn = $true } | Out-Null
  Write-Host '[F-022] hidden-trim-end'
  $hidden = @(Get-LayerStates $scratch 'F022_HIDDEN')

  Write-Host '[F-022] rational-spline-fixture-start'
  $splineDocument = Invoke-NonNullCom { $acad.Documents.Open($SplineFixturePath, $false) } 'Rational SPLINE fixture document' -TimeoutSeconds 30
  Invoke-ComRetry { $splineDocument.Activate() } | Out-Null; Wait-AcadIdle $splineDocument
  if ([int](Invoke-ComRetry { $splineDocument.ModelSpace.Count }) -ne 3) { throw 'F-022 rational SPLINE fixture must contain exactly one SPLINE and two LINE boundaries.' }
  $rationalSplineBefore = @((Get-LayerStates $splineDocument '0') | Where-Object { $_.objectName -eq 'AcDbSpline' })
  Invoke-Trim $splineDocument 0 @('25,50','75,50') "50,0`n`n"
  $rationalSplineAfter = @((Get-LayerStates $splineDocument '0') | Where-Object { $_.objectName -eq 'AcDbSpline' } | Sort-Object { $_.details.start[0] })
  Invoke-ComRetry { $splineDocument.SaveAs($SplineOutputPath, 65) } -TimeoutSeconds 60 | Out-Null
  Wait-AcadIdle $splineDocument
  $rationalSplineOutputSha256 = Get-F022FileSha256 $SplineOutputPath
  Invoke-ComRetry { $splineDocument.Close($false) } -TimeoutSeconds 20 | Out-Null
  $splineDocument = $null
  Invoke-ComRetry { $scratch.Activate() } | Out-Null
  Write-Host '[F-022] rational-spline-fixture-end'

  $standardPassed = (Test-LineSet $standard @(@(@(0,0),@(250,0)),@(@(750,0),@(1000,0)))) -and @($standard | Where-Object { $_.layer -ne $standardBefore.layer -or $_.color -ne $standardBefore.color -or $_.linetype -ne $standardBefore.linetype -or $_.lineweight -ne $standardBefore.lineweight }).Count -eq 0
  $quickPassed = $quick.Count -eq 0
  $quickTrimPassed = Test-LineSet $quickTrim @(@(@(0,1300),@(250,1300)),@(@(750,1300),@(1000,1300)))
  $edgeExtendPassed = Test-LineSet $edgeExtend (,@(@(500,2000),@(1000,2000)))
  $edgeNoPassed = Test-LineSet $edgeNo (,@(@(0,2500),@(1000,2500)))
  $erasePassed = $erase.Count -eq 0
  $undoPassed = Test-LineSet $undo (,@(@(0,3500),@(1000,3500)))
  $projectPassed = [ordered]@{}
  foreach ($name in @('none','ucs','view')) { $y = if ($name -eq 'none') { 4000 } elseif ($name -eq 'ucs') { 4300 } else { 4600 }; $projectPassed[$name] = Test-LineSet $projectStates[$name] (,@(@(500,$y),@(1000,$y))) }
  $familyPassed = [ordered]@{
    line = Test-LineSet $familyAfter.line (,@(@(500,5200),@(1000,5200)))
    polyline = $familyAfter.polyline.Count -eq 1 -and (Test-PolylineState $familyAfter.polyline[0] @(@(2075,5200),@(2100,5200),@(2100,5300),@(2000,5300),@(2000,5200),@(2025,5200)) @(0,1,0,0,0,0) @(@(5,6),@(3,5),@(0,0),@(0,0),@(2,3),@(2,3)))
    circle = $familyAfter.circle.Count -eq 1 -and $familyAfter.circle[0].objectName -eq 'AcDbArc' -and (Test-Point $familyAfter.circle[0].bounds.min @(3900,5100)) -and (Test-Point $familyAfter.circle[0].bounds.max @(4050,5300))
    arc = $familyAfter.arc.Count -eq 1 -and $familyAfter.arc[0].objectName -eq 'AcDbArc' -and (Test-Point $familyAfter.arc[0].bounds.min @(5900,5200)) -and (Test-Point $familyAfter.arc[0].bounds.max @(6050,5300)) -and (Test-Near $familyAfter.arc[0].details.radius 100)
    ellipse = $familyAfter.ellipse.Count -eq 1 -and $familyAfter.ellipse[0].objectName -eq 'AcDbEllipse' -and (Test-Point $familyAfter.ellipse[0].bounds.min @(7800,5100)) -and (Test-Point $familyAfter.ellipse[0].bounds.max @(8100,5300))
    spline = $familyAfter.spline.Count -eq 1 -and $familyAfter.spline[0].objectName -eq 'AcDbSpline' -and $familyAfter.spline[0].bounds.min[0] -ge 249.9 -and $familyAfter.spline[0].bounds.max[0] -le 1000.1
  }
  $lockedPassed = $locked.Count -eq 1 -and (Test-LineState $locked[0] @(0,6000) @(1000,6000))
  $hiddenPassed = $hidden.Count -eq 1 -and (Test-LineState $hidden[0] @(0,6200) @(1000,6200))
  $hatchPassed = Test-LineSet $hatchTarget (,@(@(2900,5600),@(3400,5600)))
  $nestedBlockPassed = Test-LineSet $blockTarget (,@(@(4100,5600),@(4300,5600)))
  $nestedBlockChildLayerPassed = (Test-LineSet $layeredBlockTargets.inherited (,@(@(4025,5900),@(4300,5900)))) -and (Test-LineSet $layeredBlockTargets.hidden (,@(@(3900,6000),@(4300,6000)))) -and (Test-LineSet $layeredBlockTargets.frozen (,@(@(3900,6100),@(4300,6100))))
  $rationalSplinePassed = $rationalSplineBefore.Count -eq 1 -and $rationalSplineAfter.Count -eq 2 -and
    $rationalSplineBefore[0].details.degree -eq 3 -and (Test-NumberList $rationalSplineBefore[0].details.knots @(0,0,0,0,1,1,1,1)) -and (Test-NumberList $rationalSplineBefore[0].details.weights @(2,2,2,2)) -and
    $rationalSplineAfter[0].details.degree -eq 3 -and (Test-PointList $rationalSplineAfter[0].details.controlPoints @(@(0,0),@(8.333333333333,25),@(16.666666666667,31.25),@(25,28.125))) -and (Test-NumberList $rationalSplineAfter[0].details.knots @(0,0,0,0,0.25,0.25,0.25,0.25)) -and (Test-NumberList $rationalSplineAfter[0].details.weights @(2,2,2,2)) -and
    $rationalSplineAfter[1].details.degree -eq 3 -and (Test-PointList $rationalSplineAfter[1].details.controlPoints @(@(75,-28.125),@(83.333333333334,-31.25),@(91.666666666667,-25),@(100,0))) -and (Test-NumberList $rationalSplineAfter[1].details.knots @(0.75,0.75,0.75,0.75,1,1,1,1)) -and (Test-NumberList $rationalSplineAfter[1].details.weights @(2,2,2,2)) -and
    (Test-Point $rationalSplineAfter[0].details.start @(0,0)) -and (Test-Point $rationalSplineAfter[0].details.end @(25,28.125)) -and (Test-Point $rationalSplineAfter[1].details.start @(75,-28.125)) -and (Test-Point $rationalSplineAfter[1].details.end @(100,0)) -and (Test-Path -LiteralPath $SplineOutputPath -PathType Leaf)
  $fencePassed = Test-LineSet $fence @(@(@(0,7000),@(250,7000)),@(@(750,7000),@(1000,7000)))
  $crossingPassed = Test-LineSet $crossing @(@(@(0,7300),@(250,7300)),@(@(750,7300),@(1000,7300)))
  $shiftSelectExtendPassed = Test-LineSet $shiftExtend (,@(@(0,7700),@(500,7700)))
  $allPassed = $standardPassed -and $quickPassed -and $quickTrimPassed -and $edgeExtendPassed -and $edgeNoPassed -and $erasePassed -and $undoPassed -and $fencePassed -and $crossingPassed -and $shiftSelectExtendPassed -and $lockedPassed -and $hiddenPassed -and $hatchPassed -and $nestedBlockPassed -and $nestedBlockChildLayerPassed -and $rationalSplinePassed -and @($projectPassed.Values | Where-Object { -not $_ }).Count -eq 0 -and @($familyPassed.Values | Where-Object { -not $_ }).Count -eq 0
  $result = [ordered]@{
    schemaVersion=1; rowId='F-022'; benchmark='AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation'; engine='Autodesk AutoCAD 2024 desktop COM'; engineVersion=[string](Invoke-ComRetry { $acad.Version })
    automationProcessId=$automationProcessId; automationProcessOwned=$owned; installedUpdateIdentity=$installedUpdateIdentity; automationProcessIdentity=[ordered]@{
      processId=$ownedIdentity.processId; executableName=$ownedIdentity.executableName; executableSha256=$ownedIdentity.executableSha256
      fileVersion=$ownedIdentity.fileVersion; productVersion=$ownedIdentity.productVersion; startTimeSha256=$ownedIdentity.startTimeSha256
    }
    options=[ordered]@{ standard=$standardPassed; quickNoIntersectionErase=$quickPassed; quickAllObjectBoundary=$quickTrimPassed; edgeExtend=$edgeExtendPassed; edgeNoExtend=$edgeNoPassed; erase=$erasePassed; commandUndo=$undoPassed; fence=$fencePassed; crossing=$crossingPassed; shiftSelectExtend=$shiftSelectExtendPassed; closedBulgeWidthPolyline=$familyPassed.polyline; hatchBoundaryIgnored=$hatchPassed; nestedBlockBoundary=$nestedBlockPassed; nestedBlockChildLayerVisibility=$nestedBlockChildLayerPassed; rationalSplineSameFixture=$rationalSplinePassed; hiddenLayerRefusal=$hiddenPassed; project=$projectPassed }
    familyChecks=$familyPassed; observations=[ordered]@{ standard=$standard; quick=$quick; quickTrim=$quickTrim; edgeExtend=$edgeExtend; edgeNoExtend=$edgeNo; erase=$erase; undo=$undo; projects=$projectStates; familyBefore=$familyBefore; familyAfter=$familyAfter; hatchTarget=$hatchTarget; nestedBlockTarget=$blockTarget; nestedBlockChildLayerTargets=$layeredBlockTargets; rationalSpline=[ordered]@{ before=$rationalSplineBefore; after=$rationalSplineAfter; outputSha256=$rationalSplineOutputSha256 }; fence=$fence; crossing=$crossing; shiftExtend=$shiftExtend; shiftPhysicalInput=$shiftScreenPoint; locked=$locked; hidden=$hidden }
    lockedLayer=[ordered]@{ behavior=if($lockedPassed){'refused'}else{'unexpected'}; passed=$lockedPassed }
    hiddenLayer=[ordered]@{ behavior=if($hiddenPassed){'refused'}else{'unexpected'}; passed=$hiddenPassed }
    status=if($allPassed){'PASS'}else{'FAIL'}
  }
} finally {
  if ($acad -and -not $owned) {
    try {
      [uint32]$finallyProcessId = 0
      [void][F022WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry { $acad.HWND }), [ref]$finallyProcessId)
      if ([int]$finallyProcessId -gt 0 -and $preExistingProcessIds -notcontains [int]$finallyProcessId) {
        $automationProcessId = [int]$finallyProcessId
        $ownedIdentity = Write-OwnedPidSidecar $automationProcessId
        $owned = $true
      }
    } catch {}
  }
  if ($splineDocument) { try { Invoke-ComRetry { $splineDocument.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
  if ($scratch) { try { Invoke-ComRetry { $scratch.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
  if ($owned -and $acad) { try { Invoke-ComRetry { $acad.Quit() } -TimeoutSeconds 10 | Out-Null } catch {} }
}

if (-not $result) { throw 'F-022 AutoCAD matrix produced no result.' }
$result.userDocument = [ordered]@{ isolatedOwnedProcess=$owned; blankRestored=$owned }
$status = $result.status
$result | ConvertTo-Json -Depth 14
if ($status -ne 'PASS') { exit 1 }
