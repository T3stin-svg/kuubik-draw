param(
  [Parameter(Mandatory = $true)][string]$PidPath,
  [Parameter(Mandatory = $true)][string]$OwnershipToken,
  [Parameter(Mandatory = $true)][string]$SplineFixturePath,
  [Parameter(Mandatory = $true)][string]$SplineOutputPath
)

$ErrorActionPreference = 'Stop'
$SplineFixturePath = [IO.Path]::GetFullPath($SplineFixturePath)
$SplineOutputPath = [IO.Path]::GetFullPath($SplineOutputPath)
if (-not (Test-Path -LiteralPath $SplineFixturePath -PathType Leaf) -or [IO.Path]::GetExtension($SplineFixturePath) -ine '.dxf') { throw 'F-023 rational SPLINE fixture must be an existing DXF file.' }
if ([IO.Path]::GetExtension($SplineOutputPath) -ine '.dxf' -or (Test-Path -LiteralPath $SplineOutputPath)) { throw 'F-023 rational SPLINE output must be a new DXF path.' }

$interopCommonPath = 'C:\Program Files\Autodesk\AutoCAD 2024\Autodesk.AutoCAD.Interop.Common.dll'
if (-not (Test-Path -LiteralPath $interopCommonPath)) { throw "F-023 requires the AutoCAD 2024 ActiveX interop assembly: $interopCommonPath" }
Add-Type -Path $interopCommonPath

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class F023WindowProcess {
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
    IntPtr result = IntPtr.Zero; long largestArea = 0;
    EnumChildWindows(root, delegate(IntPtr child, IntPtr unused) {
      var className = new System.Text.StringBuilder(256);
      GetClassName(child, className, className.Capacity);
      if (className.ToString() != "ACADDM_CHILD_DXGI_FLIP_MODE_VIEW_CLASS") return true;
      RECT rect; if (!GetWindowRect(child, out rect)) return true;
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
public static class F023SplineInterop {
  private static double[] ToDoubleArray(object value) {
    var source = (Array)value; var result = new double[source.Length];
    for (var index = 0; index < source.Length; index++) result[index] = Convert.ToDouble(source.GetValue(index));
    return result;
  }
  public static double[] ControlPoints(object splineObject) { return ToDoubleArray(((IAcadSpline)splineObject).ControlPoints); }
  public static double[] Knots(object splineObject) { return ToDoubleArray(((IAcadSpline)splineObject).Knots); }
  public static double[] Weights(object splineObject) {
    var spline = (IAcadSpline)splineObject; return spline.IsRational ? ToDoubleArray(spline.Weights) : new double[0];
  }
  public static bool IsRational(object splineObject) { return ((IAcadSpline)splineObject).IsRational; }
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

function Invoke-NonEmptyStringCom {
  param([Parameter(Mandatory = $true)][scriptblock]$Action, [string]$Label, [int]$TimeoutSeconds = 20)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    try { $value = [string](& $Action); if (-not [string]::IsNullOrWhiteSpace($value)) { return $value } } catch { if ([DateTime]::UtcNow -ge $deadline) { throw } }
    if ([DateTime]::UtcNow -ge $deadline) { throw "$Label remained empty for $TimeoutSeconds seconds." }
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
  [double[]]$start = @($StartX,$StartY,0); [double[]]$end = @($EndX,$EndY,0)
  $entity = Invoke-ComRetry { $Document.ModelSpace.AddLine($start,$end) }
  Invoke-ComRetry { $entity.Layer=$Layer; $entity.Color=1; $entity.Lineweight=50 } | Out-Null
  return $entity
}

function Get-Point2 { param($Value); return @([double]$Value[0],[double]$Value[1]) }
function Test-Near { param([double]$Actual,[double]$Expected,[double]$Tolerance=0.002); return [Math]::Abs($Actual-$Expected) -le $Tolerance }
function Test-Point { param($Actual,$Expected,[double]$Tolerance=0.002); return (Test-Near $Actual[0] $Expected[0] $Tolerance) -and (Test-Near $Actual[1] $Expected[1] $Tolerance) }
function Test-NumberList {
  param($Actual,$Expected,[double]$Tolerance=0.002)
  if ($Actual.Count -ne $Expected.Count) { return $false }
  for ($index=0;$index -lt $Expected.Count;$index+=1) { if (-not (Test-Near ([double]$Actual[$index]) ([double]$Expected[$index]) $Tolerance)) { return $false } }
  return $true
}
function Test-PointList {
  param($Actual,$Expected,[double]$Tolerance=0.002)
  if ($Actual.Count -ne $Expected.Count) { return $false }
  for ($index=0;$index -lt $Expected.Count;$index+=1) { if (-not (Test-Point $Actual[$index] $Expected[$index] $Tolerance)) { return $false } }
  return $true
}

function Get-EntityState {
  param($Entity)
  $name = Invoke-NonEmptyStringCom { $Entity.ObjectName } 'Entity object name'; $details = [ordered]@{}
  if ($name -eq 'AcDbLine') { $details.start=Get-Point2 (Invoke-NonNullCom { $Entity.StartPoint } 'Line start'); $details.end=Get-Point2 (Invoke-NonNullCom { $Entity.EndPoint } 'Line end') }
  elseif ($name -eq 'AcDbPolyline') {
    $flat=@(Invoke-NonNullCom { $Entity.Coordinates } 'Polyline coordinates'); $details.vertices=@()
    for($index=0;$index+1 -lt $flat.Count;$index+=2){$details.vertices+=,@([double]$flat[$index],[double]$flat[$index+1])}
    $details.closed=[bool](Invoke-ComRetry { $Entity.Closed })
  }
  elseif ($name -eq 'AcDbArc') { $details.start=Get-Point2 (Invoke-NonNullCom { $Entity.StartPoint } 'Arc start'); $details.end=Get-Point2 (Invoke-NonNullCom { $Entity.EndPoint } 'Arc end'); $details.startAngle=[double](Invoke-ComRetry { $Entity.StartAngle }); $details.endAngle=[double](Invoke-ComRetry { $Entity.EndAngle }) }
  elseif ($name -eq 'AcDbEllipse') { $details.start=Get-Point2 (Invoke-NonNullCom { $Entity.StartPoint } 'Ellipse start'); $details.end=Get-Point2 (Invoke-NonNullCom { $Entity.EndPoint } 'Ellipse end'); $details.startParameter=[double](Invoke-ComRetry { $Entity.StartParameter }); $details.endParameter=[double](Invoke-ComRetry { $Entity.EndParameter }) }
  elseif ($name -eq 'AcDbSpline') {
    $controlFlat=@(Invoke-ComRetry { [F023SplineInterop]::ControlPoints($Entity) }); $details.controlPoints=@()
    for($index=0;$index+2 -lt $controlFlat.Count;$index+=3){$details.controlPoints+=,@([double]$controlFlat[$index],[double]$controlFlat[$index+1])}
    $details.degree=[int](Invoke-ComRetry { $Entity.Degree }); $details.knots=@((Invoke-ComRetry { [F023SplineInterop]::Knots($Entity) })|ForEach-Object{[double]$_}); $details.weights=@((Invoke-ComRetry { [F023SplineInterop]::Weights($Entity) })|ForEach-Object{[double]$_}); $details.rational=[bool](Invoke-ComRetry { [F023SplineInterop]::IsRational($Entity) })
  }
  return [ordered]@{ objectName=$name; handle=(Invoke-NonEmptyStringCom { $Entity.Handle } 'Entity handle'); layer=(Invoke-NonEmptyStringCom { $Entity.Layer } 'Entity layer'); color=[int](Invoke-ComRetry { $Entity.Color }); linetype=(Invoke-NonEmptyStringCom { $Entity.Linetype } 'Entity linetype'); lineweight=[int](Invoke-ComRetry { $Entity.Lineweight }); details=$details }
}

function Get-LayerStates {
  param($Document,[string]$Layer)
  $states=@(); $count=[int](Invoke-ComRetry { $Document.ModelSpace.Count })
  for($index=0;$index -lt $count;$index+=1){$entity=Invoke-ComRetry { $Document.ModelSpace.Item($index) };if([string](Invoke-ComRetry { $entity.Layer }) -eq $Layer){$states+=Get-EntityState $entity}}
  return @($states)
}
function Get-StableSplineStates {
  param($Document,[int]$ExpectedControlPointCount,[int]$ExpectedKnotCount)
  $states=@()
  for($attempt=1;$attempt -le 5;$attempt+=1){
    # AutoCAD can briefly expose Degree=0 through COM immediately after DXF open,
    # even though the control points, knots and saved DXF already describe degree 3.
    # Require a coherent native object after completed regens; never accept the
    # transient value or weaken the exact topology check below.
    Invoke-ComRetry { $Document.Regen(1) }|Out-Null;Wait-AcadIdle $Document
    $states=@((Get-LayerStates $Document '0')|Where-Object{$_.objectName -eq 'AcDbSpline'})
    if($states.Count -eq 1 -and $states[0].details.degree -eq 3 -and $states[0].details.controlPoints.Count -eq $ExpectedControlPointCount -and $states[0].details.knots.Count -eq $ExpectedKnotCount){return @($states)}
    Start-Sleep -Milliseconds 250
  }
  return @($states)
}
function Wait-ForExactModelSpaceCount {
  param($Document,[int]$ExpectedCount,[string]$Label)
  $lastCount=-1
  for($attempt=1;$attempt -le 20;$attempt+=1){
    Invoke-ComRetry { $Document.Regen(1) }|Out-Null;Wait-AcadIdle $Document
    $lastCount=[int](Invoke-ComRetry { $Document.ModelSpace.Count })
    if($lastCount -eq $ExpectedCount){return}
    Start-Sleep -Milliseconds 250
  }
  throw "$Label did not stabilize at exactly $ExpectedCount ModelSpace objects; last count was $lastCount."
}
function Find-ModelSpaceEntity {
  param($Document,[string]$ObjectName,[string]$Label)
  return Invoke-NonNullCom {
    $count=[int]$Document.ModelSpace.Count
    for($index=0;$index -lt $count;$index+=1){
      $entity=$Document.ModelSpace.Item($index)
      if([string]$entity.ObjectName -eq $ObjectName){return $entity}
    }
    return $null
  } $Label -TimeoutSeconds 20
}
function Test-LineState {
  param($State,$First,$Second)
  return $State.objectName -eq 'AcDbLine' -and (((Test-Point $State.details.start $First)-and(Test-Point $State.details.end $Second))-or((Test-Point $State.details.start $Second)-and(Test-Point $State.details.end $First)))
}
function Test-LineSet {
  param($States,$Expected)
  if($States.Count -ne $Expected.Count){return $false}
  foreach($line in $Expected){if(@($States|Where-Object{Test-LineState $_ $line[0] $line[1]}).Count -ne 1){return $false}}
  return $true
}

function Invoke-Extend {
  param($Document,[int]$Mode,[string[]]$BoundaryPicks,[string]$Body)
  $keyword=if($Mode -eq 0){'Standard'}else{'Quick'}
  $script="_.EXTEND`n_Mode`n_$keyword`n"
  if($Mode -eq 0){foreach($pick in $BoundaryPicks){$script+="$pick`n"};$script+="`n"}else{$script+="`n"}
  $script+=$Body
  Invoke-ComRetry { $Document.SendCommand($script) } | Out-Null
  Wait-AcadIdle $Document
}

function Invoke-ExtendBoundaryHandle {
  param($Document,[string]$BoundaryHandle,[double]$TargetX,[double]$TargetY)
  Invoke-ComRetry { $Document.SendCommand("TRIMEXTENDMODE`n0`n") }|Out-Null;Wait-AcadIdle $Document
  $target="$TargetX,$TargetY"
  $lisp="(progn (setq f023:ss (ssadd (handent `"$BoundaryHandle`"))) (command `"_.EXTEND`" f023:ss `"`" `"_non`" `"$target`" `"`" ) (princ))`n"
  Invoke-ComRetry { $Document.SendCommand($lisp) }|Out-Null;Wait-AcadIdle $Document
}

function Get-ModelScreenPoint {
  param($Document,[IntPtr]$ViewportHandle,[double]$WorldX,[double]$WorldY)
  $rect=New-Object F023WindowProcess+RECT
  if(-not[F023WindowProcess]::GetWindowRect($ViewportHandle,[ref]$rect)){throw 'F-023 could not read the AutoCAD model viewport rectangle.'}
  $screenSize=@(Invoke-NonNullCom { $Document.GetVariable('SCREENSIZE') } 'SCREENSIZE');$viewCenter=@(Invoke-NonNullCom { $Document.GetVariable('VIEWCTR') } 'VIEWCTR');$viewHeight=[double](Invoke-NonNullCom { $Document.GetVariable('VIEWSIZE') } 'VIEWSIZE')
  $viewportWidth=$rect.Right-$rect.Left;$viewportHeight=$rect.Bottom-$rect.Top
  if($screenSize.Count -lt 2 -or $viewCenter.Count -lt 2 -or $viewportWidth -ne [int][Math]::Round([double]$screenSize[0]) -or $viewportHeight -ne [int][Math]::Round([double]$screenSize[1]) -or -not($viewHeight -gt 0)){throw "F-023 viewport/SCREENSIZE mismatch: rect=$viewportWidth x $viewportHeight screen=$($screenSize -join 'x') viewHeight=$viewHeight"}
  $pixelsPerWorldUnit=[double]$screenSize[1]/$viewHeight
  return [ordered]@{x=[int][Math]::Round($rect.Left+[double]$screenSize[0]/2+($WorldX-[double]$viewCenter[0])*$pixelsPerWorldUnit);y=[int][Math]::Round($rect.Top+[double]$screenSize[1]/2-($WorldY-[double]$viewCenter[1])*$pixelsPerWorldUnit);world=@([double]$WorldX,[double]$WorldY);viewport=@($rect.Left,$rect.Top,$rect.Right,$rect.Bottom);screenSize=@([int][Math]::Round([double]$screenSize[0]),[int][Math]::Round([double]$screenSize[1]));viewCenter=@([double]$viewCenter[0],[double]$viewCenter[1]);viewHeight=$viewHeight}
}

function Get-StringSha256 { param([string]$Value);$algorithm=[Security.Cryptography.SHA256]::Create();try{return([BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value))).Replace('-','').ToLowerInvariant())}finally{$algorithm.Dispose()} }
function Get-FileSha256 { param([string]$Path);$algorithm=[Security.Cryptography.SHA256]::Create();$stream=[IO.File]::OpenRead($Path);try{return([BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','').ToLowerInvariant())}finally{$stream.Dispose();$algorithm.Dispose()} }
function Get-OwnedAcadIdentity {
  param([int]$ProcessId)
  $process=Get-Process -Id $ProcessId -ErrorAction Stop;$path=[IO.Path]::GetFullPath([string]$process.Path)
  if([IO.Path]::GetFileName($path) -ine 'acad.exe'){throw "F-023 PID $ProcessId is not acad.exe."}
  $startTimeUtc=$process.StartTime.ToUniversalTime().ToString('o');$version=(Get-Item -LiteralPath $path -ErrorAction Stop).VersionInfo
  return [ordered]@{processId=$ProcessId;executablePath=$path;executableName=[IO.Path]::GetFileName($path);executableSha256=Get-FileSha256 $path;fileVersion=[string]$version.FileVersion;productVersion=[string]$version.ProductVersion;startTimeUtc=$startTimeUtc;startTimeSha256=Get-StringSha256 $startTimeUtc}
}
function Write-OwnedPidSidecar {
  param([int]$ProcessId)
  $identity=Get-OwnedAcadIdentity $ProcessId
  [ordered]@{schemaVersion=1;processId=$identity.processId;executablePath=$identity.executablePath;executableName=$identity.executableName;executableSha256=$identity.executableSha256;fileVersion=$identity.fileVersion;productVersion=$identity.productVersion;startTimeUtc=$identity.startTimeUtc;startTimeSha256=$identity.startTimeSha256;owned=$true;token=$OwnershipToken}|ConvertTo-Json -Compress|Set-Content -LiteralPath $PidPath -Encoding ascii
  return $identity
}
function Get-InstalledAutoCadUpdateIdentity {
  $roots=@('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')
  $matches=@($roots|Where-Object{Test-Path $_}|ForEach-Object{Get-ChildItem -LiteralPath $_ -ErrorAction Stop|ForEach-Object{$item=Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue;if([string]$item.DisplayName -eq 'Autodesk AutoCAD 2024.1.2 Update'){[ordered]@{displayName=[string]$item.DisplayName;displayVersion=[string]$item.DisplayVersion}}}})
  if($matches.Count -ne 1){throw "F-023 requires exactly one installed AutoCAD 2024.1.2 Update registration; found $($matches.Count)."}
  return $matches[0]
}

$preExistingProcessIds=@(Get-Process -Name 'acad' -ErrorAction SilentlyContinue|ForEach-Object{[int]$_.Id})
$acad=$null;$scratch=$null;$splineDocument=$null;$result=$null;$automationProcessId=0;$owned=$false;$ownedIdentity=$null;$installedUpdateIdentity=$null;$engineVersion=$null
try {
  $acad=New-Object -ComObject AutoCAD.Application.24.3
  [uint32]$resolvedProcessId=0;[void][F023WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry { $acad.HWND }),[ref]$resolvedProcessId)
  $automationProcessId=[int]$resolvedProcessId;$owned=$automationProcessId -gt 0 -and $preExistingProcessIds -notcontains $automationProcessId
  Write-Host "[F-023] automation-process pid=$automationProcessId owned=$owned"
  if(-not$owned){throw 'F-023 refuses to use a pre-existing AutoCAD process.'}
  $ownedIdentity=Write-OwnedPidSidecar $automationProcessId;$installedUpdateIdentity=Get-InstalledAutoCadUpdateIdentity;$engineVersion=[string](Invoke-ComRetry { $acad.Version })
  Invoke-ComRetry { $acad.Visible=$true } | Out-Null
  $scratch=if([int](Invoke-ComRetry { $acad.Documents.Count }) -gt 0){Invoke-ComRetry { $acad.ActiveDocument }}else{Invoke-ComRetry { $acad.Documents.Add() }}
  if([string](Invoke-ComRetry { $scratch.FullName }) -or [int](Invoke-ComRetry { $scratch.ModelSpace.Count }) -ne 0){throw 'F-023 refuses a saved or non-blank drawing.'}
  Invoke-ComRetry { $scratch.Activate() } | Out-Null
  $layerNames=@('F023_BOUNDARY','F023_STANDARD','F023_QUICK','F023_EDGE_EXTEND','F023_EDGE_NO','F023_UNDO','F023_GLOBAL_UNDO_REDO','F023_PROJECT_NONE','F023_PROJECT_UCS','F023_PROJECT_VIEW','F023_FENCE_A','F023_FENCE_B','F023_CROSS_A','F023_CROSS_B','F023_POLYLINE','F023_ARC','F023_ELLIPSE','F023_CIRCLE_BOUNDARY','F023_CLOSED_BOUNDARY','F023_LOCKED','F023_HIDDEN','F023_SHIFT_TRIM')
  foreach($name in $layerNames){$null=Invoke-ComRetry { $scratch.Layers.Add($name) }}
  [double[]]$lower=@(-500,-500,0);[double[]]$upper=@(7000,3300,0);Invoke-ComRetry { $acad.ZoomWindow($lower,$upper) } | Out-Null

  $standardBefore=Get-EntityState (New-Line $scratch 'F023_STANDARD' 0 0 80 0);$null=New-Line $scratch 'F023_BOUNDARY' 100 -50 100 50
  Invoke-Extend $scratch 0 @('100,25') "75,0`n`n";$standard=@(Get-LayerStates $scratch 'F023_STANDARD')
  Write-Host '[F-023] standard-complete'

  $quickBefore=Get-EntityState (New-Line $scratch 'F023_QUICK' 0 200 80 200);$null=New-Line $scratch 'F023_BOUNDARY' 100 150 100 250
  Invoke-Extend $scratch 1 @() "75,200`n`n";$quick=@(Get-LayerStates $scratch 'F023_QUICK')
  Write-Host '[F-023] quick-complete'

  $null=New-Line $scratch 'F023_EDGE_EXTEND' 0 400 80 400;$edgeExtendBoundary=New-Line $scratch 'F023_BOUNDARY' 100 450 100 500
  Invoke-ComRetry { $scratch.SendCommand("EDGEMODE`n1`n") }|Out-Null;Wait-AcadIdle $scratch;Invoke-ExtendBoundaryHandle $scratch ([string](Invoke-ComRetry { $edgeExtendBoundary.Handle })) 75 400;$edgeExtend=@(Get-LayerStates $scratch 'F023_EDGE_EXTEND')
  $null=New-Line $scratch 'F023_EDGE_NO' 0 600 80 600;$null=New-Line $scratch 'F023_BOUNDARY' 100 650 100 700
  Invoke-ComRetry { $scratch.SendCommand("EDGEMODE`n0`n") }|Out-Null;Wait-AcadIdle $scratch;Invoke-Extend $scratch 0 @('100,675') "75,600`n`n";$edgeNo=@(Get-LayerStates $scratch 'F023_EDGE_NO')
  Write-Host '[F-023] edge-complete'

  $projectStates=[ordered]@{};$projectSpecs=@(@('NONE','F023_PROJECT_NONE',800),@('UCS','F023_PROJECT_UCS',1000),@('VIEW','F023_PROJECT_VIEW',1200))
  foreach($spec in $projectSpecs){$keyword=[string]$spec[0];$layer=[string]$spec[1];$y=[double]$spec[2];$null=New-Line $scratch $layer 0 $y 80 $y;$null=New-Line $scratch 'F023_BOUNDARY' 100 ($y-50) 100 ($y+50);Invoke-Extend $scratch 0 @("100,$($y+25)") "_Project`n_$keyword`n75,$y`n`n";$projectStates[$keyword.ToLowerInvariant()]=@(Get-LayerStates $scratch $layer)}
  Write-Host '[F-023] project-complete'

  $null=New-Line $scratch 'F023_GLOBAL_UNDO_REDO' 0 1400 80 1400;$null=New-Line $scratch 'F023_GLOBAL_UNDO_REDO' 0 1420 80 1420;$null=New-Line $scratch 'F023_BOUNDARY' 100 1350 100 1470
  Invoke-Extend $scratch 0 @('100,1450') "75,1400`n75,1420`n`n";$globalCommitted=@(Get-LayerStates $scratch 'F023_GLOBAL_UNDO_REDO')
  Invoke-ComRetry { $scratch.SendCommand("_.UNDO`n1`n") }|Out-Null;Wait-AcadIdle $scratch;$globalUndone=@(Get-LayerStates $scratch 'F023_GLOBAL_UNDO_REDO')
  Invoke-ComRetry { $scratch.SendCommand("_.REDO`n") }|Out-Null;Wait-AcadIdle $scratch;$globalRedone=@(Get-LayerStates $scratch 'F023_GLOBAL_UNDO_REDO')
  Write-Host '[F-023] global-undo-redo-complete'

  $null=New-Line $scratch 'F023_UNDO' 0 1600 80 1600;$null=New-Line $scratch 'F023_BOUNDARY' 100 1550 100 1650
  Invoke-Extend $scratch 0 @('100,1625') "75,1600`n_Undo`n`n";$commandUndo=@(Get-LayerStates $scratch 'F023_UNDO')
  Write-Host '[F-023] command-undo-complete'

  $null=New-Line $scratch 'F023_FENCE_A' 0 1800 80 1800;$null=New-Line $scratch 'F023_FENCE_B' 0 1820 80 1820;$null=New-Line $scratch 'F023_BOUNDARY' 100 1750 100 1870
  Invoke-Extend $scratch 0 @('100,1850') "_Fence`n75,1780`n75,1840`n`n`n";$fence=@();$fence+=@(Get-LayerStates $scratch 'F023_FENCE_A');$fence+=@(Get-LayerStates $scratch 'F023_FENCE_B')
  $null=New-Line $scratch 'F023_CROSS_A' 0 2000 80 2000;$null=New-Line $scratch 'F023_CROSS_B' 0 2100 80 2100;$null=New-Line $scratch 'F023_BOUNDARY' 100 1950 100 2150
  Invoke-Extend $scratch 0 @('100,2125') "_Crossing`n70,1975`n90,2125`n`n";$crossing=@();$crossing+=@(Get-LayerStates $scratch 'F023_CROSS_A');$crossing+=@(Get-LayerStates $scratch 'F023_CROSS_B')
  Write-Host '[F-023] fence-crossing-complete'

  [double[]]$polyPoints=@(0,2200,40,2200,80,2200);$polyline=Invoke-ComRetry { $scratch.ModelSpace.AddLightWeightPolyline($polyPoints) };Invoke-ComRetry { $polyline.Layer='F023_POLYLINE';$polyline.Color=1;$polyline.Lineweight=50 }|Out-Null;$null=New-Line $scratch 'F023_BOUNDARY' 100 2150 100 2250
  Invoke-Extend $scratch 0 @('100,2225') "75,2200`n`n";$polylineState=@(Get-LayerStates $scratch 'F023_POLYLINE')

  [double[]]$arcCenter=@(3000,2200,0);$arc=Invoke-ComRetry { $scratch.ModelSpace.AddArc($arcCenter,100,0,[Math]::PI/2) };Invoke-ComRetry { $arc.Layer='F023_ARC';$arc.Color=1;$arc.Lineweight=50 }|Out-Null;$null=New-Line $scratch 'F023_BOUNDARY' 2900 2100 2900 2300
  Invoke-Extend $scratch 0 @('2900,2250') "3000,2290`n`n";$arcState=@(Get-LayerStates $scratch 'F023_ARC')
  [double[]]$ellipseCenter=@(4000,2200,0);[double[]]$ellipseAxis=@(100,0,0);$ellipse=Invoke-ComRetry { $scratch.ModelSpace.AddEllipse($ellipseCenter,$ellipseAxis,0.5) };Invoke-ComRetry { $ellipse.Layer='F023_ELLIPSE';$ellipse.Color=1;$ellipse.Lineweight=50;$ellipse.StartParameter=0;$ellipse.EndParameter=[Math]::PI/2 }|Out-Null;$null=New-Line $scratch 'F023_BOUNDARY' 3900 2100 3900 2300
  Invoke-Extend $scratch 0 @('3900,2250') "4000,2240`n`n";$ellipseState=@(Get-LayerStates $scratch 'F023_ELLIPSE')

  $null=New-Line $scratch 'F023_CIRCLE_BOUNDARY' 5000 2200 5080 2200;[double[]]$circleCenter=@(5200,2200,0);$circle=Invoke-ComRetry { $scratch.ModelSpace.AddCircle($circleCenter,100) };Invoke-ComRetry { $circle.Layer='F023_BOUNDARY' }|Out-Null
  Invoke-Extend $scratch 0 @('5200,2300') "5075,2200`n`n";$circleBoundary=@(Get-LayerStates $scratch 'F023_CIRCLE_BOUNDARY')
  $null=New-Line $scratch 'F023_CLOSED_BOUNDARY' 6000 2200 6080 2200;[double[]]$closedPoints=@(6100,2150,6200,2150,6200,2250,6100,2250);$closed=Invoke-ComRetry { $scratch.ModelSpace.AddLightWeightPolyline($closedPoints) };Invoke-ComRetry { $closed.Layer='F023_BOUNDARY';$closed.Closed=$true }|Out-Null
  Invoke-Extend $scratch 0 @('6100,2200') "6075,2200`n`n";$closedBoundary=@(Get-LayerStates $scratch 'F023_CLOSED_BOUNDARY')
  Write-Host '[F-023] families-complete'

  $helperPath=Join-Path $PSScriptRoot 'f022-shift-click.ps1'
  $lockedLayer=Invoke-ComRetry { $scratch.Layers.Item('F023_LOCKED') };$null=New-Line $scratch 'F023_LOCKED' 0 2400 80 2400;$null=New-Line $scratch 'F023_BOUNDARY' 100 2350 100 2450;Invoke-ComRetry { $lockedLayer.Lock=$true }|Out-Null
  $lockedEscapeHelper=Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$helperPath,'-MainWindowHandle',([string][int64](Invoke-ComRetry { $acad.HWND })),'-ExpectedProcessId',([string]$automationProcessId),'-Action','Escape','-DelayMilliseconds','1000') -WindowStyle Hidden -PassThru
  $lockedScript="_.EXTEND`n_Mode`n_Standard`n100,2425`n`n75,2400`n";Invoke-ComRetry { $scratch.SendCommand($lockedScript) }|Out-Null
  if(-not$lockedEscapeHelper.WaitForExit(10000)){throw 'F-023 locked-layer ESC helper did not exit.'};if($lockedEscapeHelper.ExitCode -ne 0){throw "F-023 locked-layer ESC helper exited $($lockedEscapeHelper.ExitCode)."};Wait-AcadIdle $scratch;$locked=@(Get-LayerStates $scratch 'F023_LOCKED')
  Write-Host '[F-023] locked-complete'
  $hiddenLayer=Invoke-ComRetry { $scratch.Layers.Item('F023_HIDDEN') };$null=New-Line $scratch 'F023_HIDDEN' 0 2600 80 2600;$null=New-Line $scratch 'F023_BOUNDARY' 100 2550 100 2650;Invoke-ComRetry { $hiddenLayer.LayerOn=$false }|Out-Null
  $escapeHelper=Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$helperPath,'-MainWindowHandle',([string][int64](Invoke-ComRetry { $acad.HWND })),'-ExpectedProcessId',([string]$automationProcessId),'-Action','Escape','-DelayMilliseconds','1000') -WindowStyle Hidden -PassThru
  $hiddenScript="_.EXTEND`n_Mode`n_Standard`n100,2625`n`n75,2600`n";Invoke-ComRetry { $scratch.SendCommand($hiddenScript) }|Out-Null
  if(-not$escapeHelper.WaitForExit(10000)){throw 'F-023 hidden-layer ESC helper did not exit.'};if($escapeHelper.ExitCode -ne 0){throw "F-023 hidden-layer ESC helper exited $($escapeHelper.ExitCode)."};Wait-AcadIdle $scratch;Invoke-ComRetry { $hiddenLayer.LayerOn=$true }|Out-Null;$hidden=@(Get-LayerStates $scratch 'F023_HIDDEN')
  Write-Host '[F-023] hidden-complete'

  $shiftFixture=[ordered]@{target=@(@(0,0),@(1000,0));boundaries=@(@(@(250,-100),@(250,100)),@(@(750,-100),@(750,100)));pick=@(500,0)}
  $null=New-Line $scratch 'F023_SHIFT_TRIM' 0 0 1000 0;$null=New-Line $scratch 'F023_BOUNDARY' 250 -100 250 100;$null=New-Line $scratch 'F023_BOUNDARY' 750 -100 750 100
  [double[]]$shiftLower=@(-100,-200,0);[double[]]$shiftUpper=@(1100,200,0);Invoke-ComRetry { $acad.ZoomWindow($shiftLower,$shiftUpper) }|Out-Null;Start-Sleep -Milliseconds 500
  $viewportHandle=[F023WindowProcess]::FindModelViewport([IntPtr][int64](Invoke-ComRetry { $acad.HWND }));if($viewportHandle -eq [IntPtr]::Zero){throw 'F-023 could not find the AutoCAD DXGI model viewport.'}
  $shiftScreenPoint=Get-ModelScreenPoint $scratch $viewportHandle 500 0
  $shiftHelper=Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$helperPath,'-MainWindowHandle',([string][int64](Invoke-ComRetry { $acad.HWND })),'-ExpectedProcessId',([string]$automationProcessId),'-Action','ShiftClick','-ScreenX',([string]$shiftScreenPoint.x),'-ScreenY',([string]$shiftScreenPoint.y),'-DelayMilliseconds','1000') -WindowStyle Hidden -PassThru
  Invoke-ComRetry { $scratch.SendCommand("_.EXTEND`n_Mode`n_Standard`n250,50`n750,50`n`n") }|Out-Null
  if(-not$shiftHelper.WaitForExit(15000)){throw 'F-023 physical Shift-click helper did not exit.'};if($shiftHelper.ExitCode -ne 0){throw "F-023 physical Shift-click helper exited $($shiftHelper.ExitCode)."};Wait-AcadIdle $scratch;$shiftTrim=@(Get-LayerStates $scratch 'F023_SHIFT_TRIM')
  Write-Host '[F-023] shift-complete'

  $splineDocument=Invoke-NonNullCom { $acad.Documents.Open($SplineFixturePath,$false) } 'F-023 rational SPLINE fixture' -TimeoutSeconds 30;Invoke-ComRetry { $splineDocument.Activate() }|Out-Null;Wait-AcadIdle $splineDocument
  Wait-ForExactModelSpaceCount $splineDocument 2 'F-023 rational SPLINE fixture'
  $rationalBefore=@(Get-StableSplineStates $splineDocument 4 8)
  Invoke-ComRetry { $acad.ZoomExtents() }|Out-Null;Invoke-Extend $splineDocument 0 @('6,5') "3,0`n`n"
  $rationalAfter=@(Get-StableSplineStates $splineDocument 7 11)
  Invoke-ComRetry { $splineDocument.SaveAs($SplineOutputPath,65) } -TimeoutSeconds 60|Out-Null;Wait-AcadIdle $splineDocument;$rationalOutputSha256=Get-FileSha256 $SplineOutputPath
  Invoke-ComRetry { $splineDocument.Close($false) } -TimeoutSeconds 20|Out-Null;$splineDocument=$null;Invoke-ComRetry { $scratch.Activate() }|Out-Null

  # Measure several boundary distances in fresh unsaved copies. This is reference
  # evidence for the extension law; every copy is discarded without touching the
  # source DXF or the user's pre-existing AutoCAD process.
  $rationalProbe=@()
  foreach($boundaryX in @(3.5,4.0,5.0,6.0,8.0,10.0)){
    $probeDocument=Invoke-NonNullCom { $acad.Documents.Open($SplineFixturePath,$false) } "F-023 rational SPLINE probe x=$boundaryX" -TimeoutSeconds 30
    try {
      Invoke-ComRetry { $probeDocument.Activate() }|Out-Null;Wait-AcadIdle $probeDocument
      $probeLine=Find-ModelSpaceEntity $probeDocument 'AcDbLine' "F-023 rational SPLINE probe x=$boundaryX LINE boundary"
      [double[]]$probeStart=@([double]$boundaryX,-10,0);[double[]]$probeEnd=@([double]$boundaryX,10,0)
      Invoke-ComRetry { $probeLine.StartPoint=$probeStart;$probeLine.EndPoint=$probeEnd;$probeLine.Update() }|Out-Null
      Invoke-ComRetry { $acad.ZoomExtents() }|Out-Null
      Invoke-Extend $probeDocument 0 @("$boundaryX,5") "3,0`n`n"
      $probeSpline=@((Get-LayerStates $probeDocument '0')|Where-Object{$_.objectName -eq 'AcDbSpline'})
      if($probeSpline.Count -ne 1){throw "F-023 rational SPLINE probe x=$boundaryX produced $($probeSpline.Count) splines."}
      $rationalProbe+=,[ordered]@{boundaryX=[double]$boundaryX;after=$probeSpline[0]}
    } finally {
      Invoke-ComRetry { $probeDocument.Close($false) } -TimeoutSeconds 20|Out-Null
    }
  }

  $rationalShapeProbe=@()
  $shapeCases=@(
    [ordered]@{name='equal-weights';controlPoints=@(@(0,0),@(1,1),@(2,1),@(3,0));weights=@(1,1,1,1)},
    [ordered]@{name='weight-ramp';controlPoints=@(@(0,0),@(1,1),@(2,1),@(3,0));weights=@(1,2,3,4)},
    [ordered]@{name='changed-curvature';controlPoints=@(@(0,0),@(1,2),@(2,-1),@(3,0));weights=@(1,1,2,2)}
  )
  foreach($shapeCase in $shapeCases){
    $shapeDocument=Invoke-NonNullCom { $acad.Documents.Open($SplineFixturePath,$false) } "F-023 rational SPLINE shape probe $($shapeCase.name)" -TimeoutSeconds 30
    try {
      Invoke-ComRetry { $shapeDocument.Activate() }|Out-Null;Wait-AcadIdle $shapeDocument
      $shapeSpline=Find-ModelSpaceEntity $shapeDocument 'AcDbSpline' "F-023 rational SPLINE shape probe $($shapeCase.name) SPLINE"
      for($controlIndex=0;$controlIndex -lt $shapeCase.controlPoints.Count;$controlIndex+=1){
        [double[]]$shapePoint=@([double]$shapeCase.controlPoints[$controlIndex][0],[double]$shapeCase.controlPoints[$controlIndex][1],0)
        Invoke-ComRetry { $shapeSpline.SetControlPoint($controlIndex,$shapePoint) }|Out-Null
        Invoke-ComRetry { $shapeSpline.SetWeight($controlIndex,[double]$shapeCase.weights[$controlIndex]) }|Out-Null
      }
      Invoke-ComRetry { $shapeSpline.Update();$acad.ZoomExtents() }|Out-Null
      $shapeBefore=Get-EntityState $shapeSpline
      Invoke-Extend $shapeDocument 0 @('6,5') "3,0`n`n"
      $shapeAfter=@((Get-LayerStates $shapeDocument '0')|Where-Object{$_.objectName -eq 'AcDbSpline'})
      if($shapeAfter.Count -ne 1){throw "F-023 rational SPLINE shape probe $($shapeCase.name) produced $($shapeAfter.Count) splines."}
      $rationalShapeProbe+=,[ordered]@{name=[string]$shapeCase.name;before=$shapeBefore;after=$shapeAfter[0]}
    } finally {
      Invoke-ComRetry { $shapeDocument.Close($false) } -TimeoutSeconds 20|Out-Null
    }
  }

  $startDocument=Invoke-NonNullCom { $acad.Documents.Open($SplineFixturePath,$false) } 'F-023 rational SPLINE start-endpoint probe' -TimeoutSeconds 30
  try {
    Invoke-ComRetry { $startDocument.Activate() }|Out-Null;Wait-AcadIdle $startDocument
    $startLine=Find-ModelSpaceEntity $startDocument 'AcDbLine' 'F-023 rational SPLINE start-endpoint probe LINE boundary'
    [double[]]$startProbeLineStart=@(-0.2,-10,0);[double[]]$startProbeLineEnd=@(-0.2,10,0)
    Invoke-ComRetry { $startLine.StartPoint=$startProbeLineStart;$startLine.EndPoint=$startProbeLineEnd;$startLine.Update();$acad.ZoomExtents() }|Out-Null
    Invoke-Extend $startDocument 0 @('-0.2,5') "0,0`n`n"
    $startProbeSpline=@((Get-LayerStates $startDocument '0')|Where-Object{$_.objectName -eq 'AcDbSpline'})
    if($startProbeSpline.Count -ne 1){throw "F-023 rational SPLINE start-endpoint probe produced $($startProbeSpline.Count) splines."}
    $rationalStartProbe=$startProbeSpline[0]
  } finally {
    Invoke-ComRetry { $startDocument.Close($false) } -TimeoutSeconds 20|Out-Null
  }
  Invoke-ComRetry { $scratch.Activate() }|Out-Null
  Write-Host '[F-023] spline-complete'

  $standardPassed=Test-LineSet $standard (,@(@(0,0),@(100,0)));$quickPassed=Test-LineSet $quick (,@(@(0,200),@(100,200)))
  $propertiesPassed=$standard.Count -eq 1 -and $standard[0].layer -eq $standardBefore.layer -and $standard[0].color -eq $standardBefore.color -and $standard[0].linetype -eq $standardBefore.linetype -and $standard[0].lineweight -eq $standardBefore.lineweight -and $quick.Count -eq 1 -and $quick[0].layer -eq $quickBefore.layer
  $edgeExtendPassed=Test-LineSet $edgeExtend (,@(@(0,400),@(100,400)));$edgeNoPassed=Test-LineSet $edgeNo (,@(@(0,600),@(80,600)))
  $projectPassed=[ordered]@{};foreach($name in @('none','ucs','view')){$y=if($name -eq 'none'){800}elseif($name -eq 'ucs'){1000}else{1200};$projectPassed[$name]=Test-LineSet $projectStates[$name] (,@(@(0,$y),@(100,$y)))}
  $commandUndoPassed=Test-LineSet $commandUndo (,@(@(0,1600),@(80,1600)))
  $fencePassed=Test-LineSet $fence @(@(@(0,1800),@(100,1800)),@(@(0,1820),@(100,1820)));$crossingPassed=Test-LineSet $crossing @(@(@(0,2000),@(100,2000)),@(@(0,2100),@(100,2100)))
  $polylinePassed=$polylineState.Count -eq 1 -and $polylineState[0].objectName -eq 'AcDbPolyline' -and (Test-PointList $polylineState[0].details.vertices @(@(0,2200),@(40,2200),@(100,2200)))
  $arcPassed=$arcState.Count -eq 1 -and (Test-Point $arcState[0].details.end @(2900,2200) 0.01);$ellipsePassed=$ellipseState.Count -eq 1 -and (Test-Point $ellipseState[0].details.end @(3900,2200) 0.01)
  $circleBoundaryPassed=Test-LineSet $circleBoundary (,@(@(5000,2200),@(5100,2200)));$closedBoundaryPassed=Test-LineSet $closedBoundary (,@(@(6000,2200),@(6100,2200)))
  $lockedPassed=Test-LineSet $locked (,@(@(0,2400),@(80,2400)));$hiddenPassed=Test-LineSet $hidden (,@(@(0,2600),@(80,2600)));$shiftTrimPassed=Test-LineSet $shiftTrim @(@(@(0,0),@(250,0)),@(@(750,0),@(1000,0)))
  $globalUndoRedoPassed=(Test-LineSet $globalCommitted @(@(@(0,1400),@(100,1400)),@(@(0,1420),@(100,1420)))) -and (Test-LineSet $globalUndone @(@(@(0,1400),@(80,1400)),@(@(0,1420),@(80,1420)))) -and (Test-LineSet $globalRedone @(@(@(0,1400),@(100,1400)),@(@(0,1420),@(100,1420))))
  $rationalPassed=$rationalBefore.Count -eq 1 -and $rationalAfter.Count -eq 1 -and $rationalBefore[0].details.degree -eq 3 -and (Test-PointList $rationalBefore[0].details.controlPoints @(@(0,0),@(1,1),@(2,1),@(3,0))) -and (Test-NumberList $rationalBefore[0].details.knots @(0,0,0,0,1,1,1,1)) -and (Test-NumberList $rationalBefore[0].details.weights @(1,1,2,2)) -and $rationalAfter[0].details.degree -eq 3 -and (Test-PointList $rationalAfter[0].details.controlPoints @(@(0,0),@(1,1),@(2,1),@(3,0),@(3.621334927542687,-0.621334927542687),@(4.628726947269851,-1.821755493362090),@(6,-3.567997608685968))) -and (Test-NumberList $rationalAfter[0].details.knots @(0,0,0,0,1,1,1,1.621334927542687,1.621334927542687,1.621334927542687,1.621334927542687)) -and (Test-NumberList $rationalAfter[0].details.weights @(1,1,2,2,2,2,2)) -and (Test-Path -LiteralPath $SplineOutputPath -PathType Leaf)
  $allPassed=$standardPassed -and $quickPassed -and $propertiesPassed -and $edgeExtendPassed -and $edgeNoPassed -and $commandUndoPassed -and $globalUndoRedoPassed -and $fencePassed -and $crossingPassed -and $polylinePassed -and $arcPassed -and $ellipsePassed -and $circleBoundaryPassed -and $closedBoundaryPassed -and $lockedPassed -and $hiddenPassed -and $shiftTrimPassed -and $rationalPassed -and @($projectPassed.Values|Where-Object{-not$_}).Count -eq 0
  $result=[ordered]@{schemaVersion=1;rowId='F-023';benchmark='AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation';engine='Autodesk AutoCAD 2024 desktop COM';engineVersion=$engineVersion;automationProcessId=$automationProcessId;automationProcessOwned=$owned;installedUpdateIdentity=$installedUpdateIdentity;automationProcessIdentity=[ordered]@{processId=$ownedIdentity.processId;executableName=$ownedIdentity.executableName;executableSha256=$ownedIdentity.executableSha256;fileVersion=$ownedIdentity.fileVersion;productVersion=$ownedIdentity.productVersion;startTimeSha256=$ownedIdentity.startTimeSha256};options=[ordered]@{standard=$standardPassed;quick=$quickPassed;edgeExtend=$edgeExtendPassed;edgeNoExtend=$edgeNoPassed;commandUndo=$commandUndoPassed;globalUndoRedo=$globalUndoRedoPassed;fence=$fencePassed;crossing=$crossingPassed;shiftSelectTrim=$shiftTrimPassed;project=$projectPassed;lockedLayerRefusal=$lockedPassed;hiddenLayerRefusal=$hiddenPassed};familyChecks=[ordered]@{line=$standardPassed;openPolyline=$polylinePassed;arc=$arcPassed;ellipse=$ellipsePassed;circleBoundary=$circleBoundaryPassed;closedPolylineBoundary=$closedBoundaryPassed;rationalSpline=$rationalPassed};propertiesPreserved=$propertiesPassed;observations=[ordered]@{standard=$standard;quick=$quick;edgeExtend=$edgeExtend;edgeNoExtend=$edgeNo;commandUndo=$commandUndo;globalUndoRedo=[ordered]@{committed=$globalCommitted;undone=$globalUndone;redone=$globalRedone};projects=$projectStates;fence=$fence;crossing=$crossing;polyline=$polylineState;arc=$arcState;ellipse=$ellipseState;circleBoundary=$circleBoundary;closedBoundary=$closedBoundary;locked=$locked;hidden=$hidden;shiftTrim=$shiftTrim;shiftFixture=$shiftFixture;shiftPhysicalInput=$shiftScreenPoint;rationalSpline=[ordered]@{before=$rationalBefore;after=$rationalAfter;outputSha256=$rationalOutputSha256;boundaryDistanceProbe=$rationalProbe;shapeProbe=$rationalShapeProbe;startEndpointProbe=$rationalStartProbe}};lockedLayer=[ordered]@{behavior=if($lockedPassed){'refused'}else{'unexpected'};passed=$lockedPassed};hiddenLayer=[ordered]@{behavior=if($hiddenPassed){'refused'}else{'unexpected'};passed=$hiddenPassed};cmdNamesAfter=[string](Invoke-ComRetry { $scratch.GetVariable('CMDNAMES') });status=if($allPassed){'PASS'}else{'FAIL'}}
} catch {
  Write-Error ("F-023 matrix failure: {0}`n{1}" -f $_.Exception.Message,$_.ScriptStackTrace)
  throw
} finally {
  if($acad -and -not$owned){try{[uint32]$finallyProcessId=0;[void][F023WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry { $acad.HWND }),[ref]$finallyProcessId);if([int]$finallyProcessId -gt 0 -and $preExistingProcessIds -notcontains [int]$finallyProcessId){$automationProcessId=[int]$finallyProcessId;$ownedIdentity=Write-OwnedPidSidecar $automationProcessId;$owned=$true}}catch{}}
  if($splineDocument){try{Invoke-ComRetry { $splineDocument.Close($false) } -TimeoutSeconds 10|Out-Null}catch{}}
  if($scratch){try{Invoke-ComRetry { $scratch.Close($false) } -TimeoutSeconds 10|Out-Null}catch{}}
  if($owned -and $acad){try{Invoke-ComRetry { $acad.Quit() } -TimeoutSeconds 10|Out-Null}catch{}}
}

if(-not$result){throw 'F-023 AutoCAD matrix produced no result.'}
$result.userDocument=[ordered]@{isolatedOwnedProcess=$owned;blankRestored=$owned};$status=$result.status;$result|ConvertTo-Json -Depth 14
if($status -ne 'PASS'){exit 1}
