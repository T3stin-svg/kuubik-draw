param(
  [Parameter(Mandatory = $true)][string]$PidPath,
  [Parameter(Mandatory = $true)][string]$OwnershipToken,
  [Parameter(Mandatory = $true)][string]$DxfOutputPath,
  [Parameter(Mandatory = $true)][string]$SplineFixturePath,
  [Parameter(Mandatory = $true)][string]$SplineOutputPath,
  [Parameter(Mandatory = $true)][string]$EscapeHelperPath,
  [Parameter(Mandatory = $true)][int]$ExpectedProcessId
)

$ErrorActionPreference = 'Stop'
$DxfOutputPath = [IO.Path]::GetFullPath($DxfOutputPath)
$SplineFixturePath = [IO.Path]::GetFullPath($SplineFixturePath)
$SplineOutputPath = [IO.Path]::GetFullPath($SplineOutputPath)
$EscapeHelperPath = [IO.Path]::GetFullPath($EscapeHelperPath)
if ([IO.Path]::GetExtension($DxfOutputPath) -ine '.dxf' -or (Test-Path -LiteralPath $DxfOutputPath)) { throw 'F-026 DXF output must be a new .dxf path.' }
if (-not (Test-Path -LiteralPath $SplineFixturePath -PathType Leaf) -or [IO.Path]::GetExtension($SplineFixturePath) -ine '.dxf') { throw 'F-026 rational SPLINE fixture must be an existing DXF.' }
if ([IO.Path]::GetExtension($SplineOutputPath) -ine '.dxf' -or (Test-Path -LiteralPath $SplineOutputPath)) { throw 'F-026 SPLINE output must be a new .dxf path.' }
if (-not (Test-Path -LiteralPath $EscapeHelperPath -PathType Leaf)) { throw 'F-026 Escape helper is missing.' }

$interopCommonPath = 'C:\Program Files\Autodesk\AutoCAD 2024\Autodesk.AutoCAD.Interop.Common.dll'
if (-not (Test-Path -LiteralPath $interopCommonPath)) { throw "F-026 requires $interopCommonPath" }
Add-Type -Path $interopCommonPath
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class F026WindowProcess {
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@
Add-Type -ReferencedAssemblies $interopCommonPath -TypeDefinition @'
using System;
using Autodesk.AutoCAD.Interop.Common;
public static class F026SplineInterop {
  private static double[] Values(object value) {
    var source = (Array)value; var result = new double[source.Length];
    for (var i = 0; i < source.Length; i++) result[i] = Convert.ToDouble(source.GetValue(i));
    return result;
  }
  public static double[] ControlPoints(object value) { return Values(((IAcadSpline)value).ControlPoints); }
  public static double[] Knots(object value) { return Values(((IAcadSpline)value).Knots); }
  public static double[] Weights(object value) { var spline = (IAcadSpline)value; return spline.IsRational ? Values(spline.Weights) : new double[0]; }
  public static bool IsRational(object value) { return ((IAcadSpline)value).IsRational; }
}
'@

function Invoke-ComRetry {
  param([Parameter(Mandatory = $true)][scriptblock]$Action, [int]$TimeoutSeconds = 20)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do { try { return (& $Action) } catch { if ([DateTime]::UtcNow -ge $deadline) { throw }; Start-Sleep -Milliseconds 150 } } while ($true)
}
function Invoke-NonNullCom {
  param([Parameter(Mandatory = $true)][scriptblock]$Action, [string]$Label, [int]$TimeoutSeconds = 20)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    try { $value = & $Action; if ($null -ne $value) { return $value } } catch { if ([DateTime]::UtcNow -ge $deadline) { throw } }
    if ([DateTime]::UtcNow -ge $deadline) { throw "$Label remained null." }; Start-Sleep -Milliseconds 150
  } while ($true)
}
function Wait-AcadIdle {
  param($Document, [int]$TimeoutSeconds = 45)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do { Start-Sleep -Milliseconds 100; try { if ([string]::IsNullOrWhiteSpace([string]$Document.GetVariable('CMDNAMES')) -and [int]$Document.GetVariable('CMDACTIVE') -eq 0) { return } } catch {} } while ([DateTime]::UtcNow -lt $deadline)
  throw "AutoCAD did not return idle. CMDNAMES='$($Document.GetVariable('CMDNAMES'))' LASTPROMPT='$($Document.GetVariable('LASTPROMPT'))'"
}
function Wait-AcadMarker {
  param($Document, [string]$Marker, [int]$TimeoutSeconds = 45)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do { Start-Sleep -Milliseconds 100; try { if ([string]$Document.GetVariable('USERS1') -eq $Marker) { Wait-AcadIdle $Document $TimeoutSeconds; return } } catch {} } while ([DateTime]::UtcNow -lt $deadline)
  throw "F-026 marker $Marker timed out. CMDNAMES='$($Document.GetVariable('CMDNAMES'))' LASTPROMPT='$($Document.GetVariable('LASTPROMPT'))'"
}
function Get-StringSha256 { param([string]$Value); $hash = [Security.Cryptography.SHA256]::Create(); try { return ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value))).Replace('-', '').ToLowerInvariant()) } finally { $hash.Dispose() } }
function Get-FileSha256 { param([string]$Path); $hash = [Security.Cryptography.SHA256]::Create(); $stream = [IO.File]::OpenRead($Path); try { return ([BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()) } finally { $stream.Dispose(); $hash.Dispose() } }
function Get-OwnedAcadIdentity {
  param([int]$ProcessId)
  $process = Get-Process -Id $ProcessId -ErrorAction Stop; $path = [IO.Path]::GetFullPath([string]$process.Path)
  if ([IO.Path]::GetFileName($path) -ine 'acad.exe') { throw "F-026 PID $ProcessId is not acad.exe." }
  $start = $process.StartTime.ToUniversalTime().ToString('o'); $version = (Get-Item -LiteralPath $path).VersionInfo
  return [ordered]@{ processId=$ProcessId; executablePath=$path; executableName='acad.exe'; executableSha256=Get-FileSha256 $path; fileVersion=[string]$version.FileVersion; productVersion=[string]$version.ProductVersion; startTimeUtc=$start; startTimeSha256=Get-StringSha256 $start }
}
function Write-OwnedPidSidecar {
  param([int]$ProcessId)
  $identity = Get-OwnedAcadIdentity $ProcessId
  [ordered]@{ schemaVersion=1; processId=$identity.processId; executablePath=$identity.executablePath; executableName=$identity.executableName; executableSha256=$identity.executableSha256; fileVersion=$identity.fileVersion; productVersion=$identity.productVersion; startTimeUtc=$identity.startTimeUtc; startTimeSha256=$identity.startTimeSha256; owned=$true; token=$OwnershipToken } | ConvertTo-Json -Compress | Set-Content -LiteralPath $PidPath -Encoding ascii
  return $identity
}
function Get-InstalledAutoCadUpdateIdentity {
  $items = @(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue) + @(Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue)
  $match = $items | Where-Object { $_.DisplayName -eq 'Autodesk AutoCAD 2024.1.2 Update' } | Select-Object -First 1
  if ($match) { return [ordered]@{ displayName=[string]$match.DisplayName; displayVersion=[string]$match.DisplayVersion } }; return $null
}
function Format-Number { param([double]$Value); return [string]::Format([Globalization.CultureInfo]::InvariantCulture, '{0:R}', $Value) }
function Format-Point { param([double]$X,[double]$Y); return "(list $(Format-Number $X) $(Format-Number $Y) 0.0)" }
function Get-Point2 { param($Value); return @([double]$Value[0], [double]$Value[1]) }
function Get-EntityState {
  param($Entity)
  $name = [string](Invoke-ComRetry { $Entity.ObjectName }); $details = [ordered]@{}
  if ($name -eq 'AcDbLine') { $details.start=Get-Point2 (Invoke-NonNullCom { $Entity.StartPoint } 'line start'); $details.end=Get-Point2 (Invoke-NonNullCom { $Entity.EndPoint } 'line end') }
  elseif ($name -eq 'AcDbArc') { $details.center=Get-Point2 (Invoke-NonNullCom { $Entity.Center } 'arc center'); $details.radius=[double](Invoke-ComRetry { $Entity.Radius }); $details.startAngle=[double](Invoke-ComRetry { $Entity.StartAngle }); $details.endAngle=[double](Invoke-ComRetry { $Entity.EndAngle }) }
  elseif ($name -eq 'AcDbCircle') { $details.center=Get-Point2 (Invoke-NonNullCom { $Entity.Center } 'circle center'); $details.radius=[double](Invoke-ComRetry { $Entity.Radius }) }
  elseif ($name -eq 'AcDbEllipse') { $details.center=Get-Point2 (Invoke-NonNullCom { $Entity.Center } 'ellipse center'); $details.majorAxis=Get-Point2 (Invoke-NonNullCom { $Entity.MajorAxis } 'ellipse major axis'); $details.ratio=[double](Invoke-ComRetry { $Entity.RadiusRatio }); $details.startParameter=[double](Invoke-ComRetry { $Entity.StartParameter }); $details.endParameter=[double](Invoke-ComRetry { $Entity.EndParameter }) }
  elseif ($name -eq 'AcDbPolyline') {
    $flat=@(Invoke-NonNullCom { $Entity.Coordinates } 'polyline coordinates'); $vertices=@(); for($index=0;$index+1-lt$flat.Count;$index+=2){$vertices+=,@([double]$flat[$index],[double]$flat[$index+1])}
    $details.vertices=$vertices; $details.closed=[bool](Invoke-ComRetry { $Entity.Closed }); $details.bulges=@(); for($index=0;$index-lt$vertices.Count;$index+=1){$details.bulges += [double](Invoke-ComRetry { $Entity.GetBulge($index) })}
  }
  elseif ($name -eq 'AcDbSpline') {
    $flat=@([F026SplineInterop]::ControlPoints($Entity)); $points=@(); for($index=0;$index+2-lt$flat.Count;$index+=3){$points+=,@([double]$flat[$index],[double]$flat[$index+1])}
    $details.degree=[int](Invoke-ComRetry { $Entity.Degree }); $details.closed=[bool](Invoke-ComRetry { $Entity.Closed }); $details.controlPoints=$points; $details.knots=@([F026SplineInterop]::Knots($Entity)); $details.weights=@([F026SplineInterop]::Weights($Entity)); $details.rational=[bool][F026SplineInterop]::IsRational($Entity)
  }
  else { $details.unsupported=$true }
  return [ordered]@{ objectName=$name; handle=[string](Invoke-ComRetry { $Entity.Handle }); layer=[string](Invoke-ComRetry { $Entity.Layer }); color=[int](Invoke-ComRetry { $Entity.Color }); lineweight=[int](Invoke-ComRetry { $Entity.Lineweight }); linetype=[string](Invoke-ComRetry { $Entity.Linetype }); details=$details }
}
function Get-LayerStates {
  param($Document,[string]$Layer)
  $result=@(); $count=[int](Invoke-ComRetry { $Document.ModelSpace.Count }); for($index=0;$index-lt$count;$index+=1){$entity=Invoke-ComRetry { $Document.ModelSpace.Item($index) };if([string](Invoke-ComRetry { $entity.Layer }) -eq $Layer){$result += Get-EntityState $entity}}
  return @($result)
}
function New-Line { param($Document,[string]$Layer,[double]$X1,[double]$Y1,[double]$X2,[double]$Y2); [double[]]$a=@($X1,$Y1,0);[double[]]$b=@($X2,$Y2,0);$entity=Invoke-ComRetry { $Document.ModelSpace.AddLine($a,$b) };Invoke-ComRetry { $entity.Layer=$Layer;$entity.Color=1;$entity.Lineweight=50 }|Out-Null;return $entity }
function New-Polyline { param($Document,[string]$Layer,[double[]]$Coordinates,[bool]$Closed=$false);$entity=Invoke-ComRetry { $Document.ModelSpace.AddLightWeightPolyline($Coordinates) };Invoke-ComRetry { $entity.Layer=$Layer;$entity.Color=1;$entity.Lineweight=50;$entity.Closed=$Closed }|Out-Null;return $entity }
function Invoke-Break {
  param($Document,$Entity,[double]$SelectionX,[double]$SelectionY,[double]$FirstX,[double]$FirstY,[double]$SecondX,[double]$SecondY,[bool]$ExplicitFirst=$true,[bool]$AtPoint=$false)
  $handle=[string](Invoke-ComRetry { $Entity.Handle });$selection="(list (handent `"$handle`") $(Format-Point $SelectionX $SelectionY))";$first=Format-Point $FirstX $FirstY;$second=Format-Point $SecondX $SecondY;$marker=[Guid]::NewGuid().ToString('N')
  if($AtPoint){$body="(command `"_.BREAK`" $selection `"_First`" $first `"@`")"}
  elseif($ExplicitFirst){$body="(command `"_.BREAK`" $selection `"_First`" $first $second)"}
  else{$body="(command `"_.BREAK`" $selection $second)"}
  $lisp="(progn (setvar `"USERS1`" `"`") $body (setvar `"USERS1`" `"$marker`") (princ))`n";Invoke-ComRetry { $Document.SendCommand($lisp) }|Out-Null;Wait-AcadMarker $Document $marker;Invoke-ComRetry { $Document.Regen(1) }|Out-Null;Start-Sleep -Milliseconds 250
}
function Invoke-RejectedBreak {
  param($Acad,$Document,[int]$ProcessId,$Entity,[double]$X,[double]$Y,[bool]$AtPoint=$false)
  $handle=[string](Invoke-ComRetry { $Entity.Handle });$selection="(list (handent `"$handle`") $(Format-Point $X $Y))";$point=Format-Point $X $Y
  $body=if($AtPoint){"(command `"_.BREAK`" $selection `"_First`" $point `"@`")"}else{"(command `"_.BREAK`" $selection $(Format-Point ($X+10) $Y))"}
  $helpers=@();try{foreach($delay in @(1000,3000)){$helpers+=Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$EscapeHelperPath,'-TargetProcessId',([string]$ProcessId),'-DelayMs',([string]$delay)) -WindowStyle Hidden -PassThru};Invoke-ComRetry { $Document.SendCommand("(progn $body (princ))`n") }|Out-Null;foreach($helper in $helpers){if(-not$helper.WaitForExit(15000)){throw 'F-026 Escape watchdog timed out.'}}}finally{foreach($helper in $helpers){if(-not$helper.HasExited){$helper.Kill();$helper.WaitForExit()}}}
  Wait-AcadIdle $Document;Invoke-ComRetry { $Document.Regen(1) }|Out-Null;Start-Sleep -Milliseconds 250
}
function Test-Near { param([double]$A,[double]$B,[double]$Tolerance=0.002);return [Math]::Abs($A-$B)-le$Tolerance }
function Test-Point { param($A,$B);return $A.Count-ge2-and(Test-Near $A[0] $B[0])-and(Test-Near $A[1] $B[1]) }
function Test-Line { param($Entity,$Start,$End);return $Entity.objectName-eq'AcDbLine'-and(Test-Point $Entity.details.start $Start)-and(Test-Point $Entity.details.end $End) }

$acad=$null;$scratch=$null;$splineDocument=$null;$result=$null;$automationProcessId=0;$owned=$false;$ownedIdentity=$null
$preExistingProcessIds=@(Get-Process -Name acad -ErrorAction SilentlyContinue|ForEach-Object{[int]$_.Id}|Where-Object{$_-ne$ExpectedProcessId})
try {
  $automationProcessId=$ExpectedProcessId;$ownedIdentity=Write-OwnedPidSidecar $automationProcessId;$owned=$true
  $attachDeadline=[DateTime]::UtcNow.AddSeconds(45)
  do {
    $candidate=$null
    try{$candidate=[Runtime.InteropServices.Marshal]::GetActiveObject('AutoCAD.Application.24.3');[uint32]$candidatePid=0;[void][F026WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry { $candidate.HWND }),[ref]$candidatePid);if([int]$candidatePid-eq$ExpectedProcessId){$acad=$candidate;break}}catch{}
    if($candidate){try{[void][Runtime.InteropServices.Marshal]::ReleaseComObject($candidate)}catch{}};Start-Sleep -Milliseconds 500
  }while([DateTime]::UtcNow-lt$attachDeadline)
  if(-not$acad){throw "F-026 could not bind COM to its expected AutoCAD PID $ExpectedProcessId without touching a pre-existing process."}
  $installedUpdateIdentity=Get-InstalledAutoCadUpdateIdentity;Invoke-ComRetry { $acad.Visible=$true }|Out-Null
  if([int](Invoke-ComRetry { $acad.Documents.Count })-gt0){$candidate=Invoke-ComRetry { $acad.ActiveDocument };if([string](Invoke-ComRetry { $candidate.FullName })-or[int](Invoke-ComRetry { $candidate.ModelSpace.Count })-ne0){throw 'F-026 refuses a saved or nonblank automation document.'};$scratch=$candidate}else{$scratch=Invoke-ComRetry { $acad.Documents.Add() }}
  Invoke-ComRetry { $scratch.Activate();$scratch.SetVariable('CMDECHO',0);$scratch.SetVariable('FILEDIA',0) }|Out-Null;Wait-AcadIdle $scratch
  $layers=@('F026_DEFAULT','F026_FIRST','F026_AT','F026_CIRCLE_FORWARD','F026_CIRCLE_REVERSE','F026_ARC','F026_ELLIPSE','F026_OPEN_POLY','F026_CLOSED_POLY','F026_GLOBAL','F026_LOCKED','F026_OFF','F026_FROZEN','F026_UNSUPPORTED');foreach($name in $layers){Invoke-ComRetry { $scratch.Layers.Add($name) }|Out-Null}

  $default=New-Line $scratch 'F026_DEFAULT' 0 0 100 0;Invoke-Break $scratch $default 25 0 25 0 75 20 $false $false
  $first=New-Line $scratch 'F026_FIRST' 0 100 100 100;Invoke-Break $scratch $first 10 100 25 120 75 80 $true $false
  $at=New-Line $scratch 'F026_AT' 0 200 100 200;Invoke-Break $scratch $at 50 210 50 210 50 210 $true $true
  [double[]]$c1=@(200,0,0);$circleForward=Invoke-ComRetry { $scratch.ModelSpace.AddCircle($c1,50) };Invoke-ComRetry { $circleForward.Layer='F026_CIRCLE_FORWARD';$circleForward.Color=1;$circleForward.Lineweight=50 }|Out-Null;Invoke-Break $scratch $circleForward 250 0 250 0 200 50 $true $false
  [double[]]$c2=@(350,0,0);$circleReverse=Invoke-ComRetry { $scratch.ModelSpace.AddCircle($c2,50) };Invoke-ComRetry { $circleReverse.Layer='F026_CIRCLE_REVERSE';$circleReverse.Color=1;$circleReverse.Lineweight=50 }|Out-Null;Invoke-Break $scratch $circleReverse 350 50 350 50 400 0 $true $false
  [double[]]$ac=@(500,0,0);$arc=Invoke-ComRetry { $scratch.ModelSpace.AddArc($ac,50,0,[Math]::PI) };Invoke-ComRetry { $arc.Layer='F026_ARC';$arc.Color=1;$arc.Lineweight=50 }|Out-Null;Invoke-Break $scratch $arc 550 0 535 35 465 35 $true $false
  [double[]]$ec=@(650,0,0);[double[]]$major=@(50,0,0);$ellipse=Invoke-ComRetry { $scratch.ModelSpace.AddEllipse($ec,$major,0.5) };Invoke-ComRetry { $ellipse.Layer='F026_ELLIPSE';$ellipse.Color=1;$ellipse.Lineweight=50 }|Out-Null;Invoke-Break $scratch $ellipse 700 0 700 0 650 25 $true $false
  $open=New-Polyline $scratch 'F026_OPEN_POLY' ([double[]]@(0,300,100,300,200,300)) $false;Invoke-ComRetry { $open.SetWidth(0,2,4);$open.SetWidth(1,4,6) }|Out-Null;Invoke-Break $scratch $open 25 300 25 300 175 320 $true $false
  $closed=New-Polyline $scratch 'F026_CLOSED_POLY' ([double[]]@(300,300,400,300,400,400,300,400)) $true;Invoke-Break $scratch $closed 350 300 350 300 400 350 $true $false

  $g1=New-Line $scratch 'F026_GLOBAL' 0 500 100 500;$g2=New-Line $scratch 'F026_GLOBAL' 0 550 100 550;Invoke-ComRetry { $scratch.StartUndoMark() }|Out-Null;try{Invoke-Break $scratch $g1 25 500 25 500 75 500 $true $false;Invoke-Break $scratch $g2 25 550 25 550 75 550 $true $false}finally{Invoke-ComRetry { $scratch.EndUndoMark() }|Out-Null};$globalCommitted=@(Get-LayerStates $scratch 'F026_GLOBAL');Invoke-ComRetry { $scratch.SendCommand("_.UNDO`n1`n") }|Out-Null;Wait-AcadIdle $scratch;$globalUndone=@(Get-LayerStates $scratch 'F026_GLOBAL');Invoke-ComRetry { $scratch.SendCommand("_.REDO`n") }|Out-Null;Wait-AcadIdle $scratch;$globalRedone=@(Get-LayerStates $scratch 'F026_GLOBAL')

  $locked=New-Line $scratch 'F026_LOCKED' 0 700 100 700;$lockedLayer=Invoke-ComRetry { $scratch.Layers.Item('F026_LOCKED') };Invoke-ComRetry { $lockedLayer.Lock=$true }|Out-Null;Invoke-RejectedBreak $acad $scratch $automationProcessId $locked 50 700 $false;Invoke-ComRetry { $lockedLayer.Lock=$false }|Out-Null
  $off=New-Line $scratch 'F026_OFF' 0 750 100 750;$offLayer=Invoke-ComRetry { $scratch.Layers.Item('F026_OFF') };Invoke-ComRetry { $offLayer.LayerOn=$false }|Out-Null;Invoke-RejectedBreak $acad $scratch $automationProcessId $off 50 750 $false;Invoke-ComRetry { $offLayer.LayerOn=$true }|Out-Null
  $frozen=New-Line $scratch 'F026_FROZEN' 0 800 100 800;$frozenLayer=Invoke-ComRetry { $scratch.Layers.Item('F026_FROZEN') };Invoke-ComRetry { $frozenLayer.Freeze=$true }|Out-Null;Invoke-RejectedBreak $acad $scratch $automationProcessId $frozen 50 800 $false;Invoke-ComRetry { $frozenLayer.Freeze=$false }|Out-Null
  [double[]]$textPoint=@(0,850,0);$text=Invoke-ComRetry { $scratch.ModelSpace.AddText('unsupported',$textPoint,10) };Invoke-ComRetry { $text.Layer='F026_UNSUPPORTED' }|Out-Null;Invoke-RejectedBreak $acad $scratch $automationProcessId $text 10 850 $false

  Invoke-ComRetry { $scratch.Regen(1);$scratch.SaveAs($DxfOutputPath,65) } -TimeoutSeconds 90|Out-Null;Wait-AcadIdle $scratch
  $observations=[ordered]@{ default=@(Get-LayerStates $scratch 'F026_DEFAULT');first=@(Get-LayerStates $scratch 'F026_FIRST');atPoint=@(Get-LayerStates $scratch 'F026_AT');circleForward=@(Get-LayerStates $scratch 'F026_CIRCLE_FORWARD');circleReverse=@(Get-LayerStates $scratch 'F026_CIRCLE_REVERSE');arc=@(Get-LayerStates $scratch 'F026_ARC');ellipse=@(Get-LayerStates $scratch 'F026_ELLIPSE');openPolyline=@(Get-LayerStates $scratch 'F026_OPEN_POLY');closedPolyline=@(Get-LayerStates $scratch 'F026_CLOSED_POLY');globalUndoRedo=[ordered]@{committed=$globalCommitted;undone=$globalUndone;redone=$globalRedone};locked=@(Get-LayerStates $scratch 'F026_LOCKED');off=@(Get-LayerStates $scratch 'F026_OFF');frozen=@(Get-LayerStates $scratch 'F026_FROZEN');unsupported=@(Get-LayerStates $scratch 'F026_UNSUPPORTED')}

  $splineDocument=Invoke-NonNullCom { $acad.Documents.Open($SplineFixturePath,$false) } 'F-026 rational SPLINE document' -TimeoutSeconds 30;Invoke-ComRetry { $splineDocument.Activate() }|Out-Null;Wait-AcadIdle $splineDocument
  $spline=$null;for($index=0;$index-lt[int](Invoke-ComRetry { $splineDocument.ModelSpace.Count });$index+=1){$candidate=Invoke-ComRetry { $splineDocument.ModelSpace.Item($index) };if([string](Invoke-ComRetry { $candidate.ObjectName })-eq'AcDbSpline'){$spline=$candidate;break}};if(-not$spline){throw 'F-026 rational SPLINE fixture has no SPLINE.'};$splineBefore=Get-EntityState $spline;Invoke-Break $splineDocument $spline 10 20 25 50 75 -50 $true $false;$splineAfter=@();for($index=0;$index-lt[int](Invoke-ComRetry { $splineDocument.ModelSpace.Count });$index+=1){$candidate=Invoke-ComRetry { $splineDocument.ModelSpace.Item($index) };if([string](Invoke-ComRetry { $candidate.ObjectName })-eq'AcDbSpline'){$splineAfter+=Get-EntityState $candidate}};Invoke-ComRetry { $splineDocument.SaveAs($SplineOutputPath,65) } -TimeoutSeconds 90|Out-Null;Wait-AcadIdle $splineDocument

  $checks=[ordered]@{
    defaultSelectionFirstAndProjection=($observations.default.Count-eq2-and@($observations.default|Where-Object{Test-Line $_ @(0,0) @(25,0)}).Count-eq1-and@($observations.default|Where-Object{Test-Line $_ @(75,0) @(100,0)}).Count-eq1)
    explicitFirstAndProjection=($observations.first.Count-eq2-and@($observations.first|Where-Object{Test-Line $_ @(0,100) @(25,100)}).Count-eq1-and@($observations.first|Where-Object{Test-Line $_ @(75,100) @(100,100)}).Count-eq1)
    atPointSplit=($observations.atPoint.Count-eq2-and@($observations.atPoint|Where-Object{Test-Line $_ @(0,200) @(50,200)}).Count-eq1-and@($observations.atPoint|Where-Object{Test-Line $_ @(50,200) @(100,200)}).Count-eq1)
    circleDirection=($observations.circleForward.Count-eq1-and$observations.circleReverse.Count-eq1-and$observations.circleForward[0].objectName-eq'AcDbArc'-and$observations.circleReverse[0].objectName-eq'AcDbArc'-and(Test-Near $observations.circleForward[0].details.startAngle ([Math]::PI/2))-and((Test-Near $observations.circleForward[0].details.endAngle 0)-or(Test-Near $observations.circleForward[0].details.endAngle (2*[Math]::PI)))-and(Test-Near $observations.circleReverse[0].details.startAngle 0)-and(Test-Near $observations.circleReverse[0].details.endAngle ([Math]::PI/2)))
    arcTwoPoint=($observations.arc.Count-eq2-and@($observations.arc|Where-Object{$_.objectName-eq'AcDbArc'}).Count-eq2)
    ellipseTwoPoint=($observations.ellipse.Count-eq1-and$observations.ellipse[0].objectName-eq'AcDbEllipse'-and(Test-Near $observations.ellipse[0].details.startParameter ([Math]::PI/2))-and((Test-Near $observations.ellipse[0].details.endParameter 0)-or(Test-Near $observations.ellipse[0].details.endParameter (2*[Math]::PI))))
    openPolylineTwoPieces=($observations.openPolyline.Count-eq2-and@($observations.openPolyline|Where-Object{$_.objectName-eq'AcDbPolyline'-and-not$_.details.closed}).Count-eq2)
    closedPolylineComplement=$observations.closedPolyline.Count-eq1-and-not$observations.closedPolyline[0].details.closed
    globalAtomicUndoRedo=($observations.globalUndoRedo.committed.Count-eq4-and$observations.globalUndoRedo.undone.Count-eq2-and$observations.globalUndoRedo.redone.Count-eq4)
    propertiesPreserved=(@($observations.default|Where-Object{$_.color-eq1-and$_.lineweight-eq50-and$_.layer-eq'F026_DEFAULT'}).Count-eq2)
    lockedRefused=($observations.locked.Count-eq1-and(Test-Line $observations.locked[0] @(0,700) @(100,700)))
    layerBehaviorMeasured=($observations.off.Count-eq2-and@($observations.off|Where-Object{Test-Line $_ @(0,750) @(50,750)}).Count-eq1-and@($observations.off|Where-Object{Test-Line $_ @(60,750) @(100,750)}).Count-eq1-and$observations.frozen.Count-eq2-and@($observations.frozen|Where-Object{Test-Line $_ @(0,800) @(50,800)}).Count-eq1-and@($observations.frozen|Where-Object{Test-Line $_ @(60,800) @(100,800)}).Count-eq1)
    unsupportedRefused=($observations.unsupported.Count-eq1-and$observations.unsupported[0].objectName-eq'AcDbText')
    rationalSplineTwoPieces=($splineBefore.details.rational-and$splineBefore.details.weights.Count-eq4-and$splineAfter.Count-eq2-and@($splineAfter|Where-Object{-not$_.details.rational}).Count-eq0)
  }
  $result=[ordered]@{schemaVersion=1;rowId='F-026';benchmark='AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation';engine='Autodesk AutoCAD 2024 desktop COM';engineVersion=[string](Invoke-ComRetry { $acad.Version });automationProcessId=$automationProcessId;automationProcessOwned=$owned;installedUpdateIdentity=$installedUpdateIdentity;automationProcessIdentity=[ordered]@{processId=$ownedIdentity.processId;executableName=$ownedIdentity.executableName;executableSha256=$ownedIdentity.executableSha256;fileVersion=$ownedIdentity.fileVersion;productVersion=$ownedIdentity.productVersion;startTimeSha256=$ownedIdentity.startTimeSha256};observations=$observations;rationalSpline=[ordered]@{before=$splineBefore;after=$splineAfter;outputSha256=Get-FileSha256 $SplineOutputPath};checks=$checks;dxfOutputSha256=Get-FileSha256 $DxfOutputPath;cmdNamesAfter=[string](Invoke-ComRetry { $splineDocument.GetVariable('CMDNAMES') });userDocument=[ordered]@{isolatedOwnedProcess=$owned;blankRestored=$true};status=if(@($checks.Values|Where-Object{$_-ne$true}).Count-eq0){'PASS'}else{'FAIL'}}
} finally {
  if($splineDocument){try{Invoke-ComRetry { $splineDocument.Close($false) } -TimeoutSeconds 10|Out-Null}catch{}}
  if($scratch){try{Invoke-ComRetry { $scratch.Close($false) } -TimeoutSeconds 10|Out-Null}catch{}}
  if($owned-and$acad){try{Invoke-ComRetry { $acad.Quit() } -TimeoutSeconds 10|Out-Null}catch{}}
}
if(-not$result){throw 'F-026 AutoCAD matrix produced no result.'};$result|ConvertTo-Json -Depth 16;if($result.status-ne'PASS'){exit 1}
