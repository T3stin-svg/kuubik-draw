param(
  [Parameter(Mandatory = $true)][string]$PidPath,
  [Parameter(Mandatory = $true)][string]$OwnershipToken,
  [Parameter(Mandatory = $true)][string]$DxfOutputPath,
  [Parameter(Mandatory = $true)][string]$SplineFixturePath,
  [Parameter(Mandatory = $true)][string]$SplineOutputPath,
  [Parameter(Mandatory = $true)][string]$EscapeHelperPath
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
    $details.vertices=$vertices; $details.closed=[bool](Invoke-ComRetry { $Entity.Closed }); $details.bulges=@(); $details.widths=@(); for($index=0;$index-lt$vertices.Count;$index+=1){
      $details.bulges += [double](Invoke-ComRetry { $Entity.GetBulge($index) })
      [double]$startWidth=0;[double]$endWidth=0;Invoke-ComRetry { $Entity.GetWidth($index,[ref]$startWidth,[ref]$endWidth) }|Out-Null;$details.widths+=,@($startWidth,$endWidth)
    }
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
  $result=@(); $count=[int](Invoke-ComRetry { $Document.ModelSpace.Count })
  for($index=0;$index-lt$count;$index+=1){
    $entity=Invoke-ComRetry { $Document.ModelSpace.Item($index) }
    if([string](Invoke-ComRetry { $entity.Layer }) -ne $Layer){continue}
    try{
      # BREAK may replace an object while the collection still hands out the
      # pre-command RCW. Rebind by the stable database handle before reading
      # geometry so a live replacement ARC is not mistaken for a tombstone.
      $handle=[string](Invoke-ComRetry { $entity.Handle })
      $fresh=Invoke-NonNullCom { $Document.HandleToObject($handle) } "entity $handle"
      $result += Get-EntityState $fresh
    }
    catch{
      # BREAK can leave an erased COM wrapper addressable through ModelSpace
      # until database compaction. It exposes Layer/ObjectName, but geometry is
      # null. Skip only that tombstone; exact result counts/types still fail
      # closed below whenever a live output is absent.
      if($_.Exception.Message-notmatch'remained null|erased|key not found|deleted'){throw}
    }
  }
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
function Invoke-BreakAtPoint {
  param($Document,$Entity,[double]$SelectionX,[double]$SelectionY,[double]$PointX,[double]$PointY)
  $handle=[string](Invoke-ComRetry { $Entity.Handle });$selection="(list (handent `"$handle`") $(Format-Point $SelectionX $SelectionY))";$point=Format-Point $PointX $PointY;$marker=[Guid]::NewGuid().ToString('N')
  $lisp="(progn (setvar `"USERS1`" `"`") (command `"_.BREAKATPOINT`" $selection $point) (setvar `"USERS1`" `"$marker`") (princ))`n";Invoke-ComRetry { $Document.SendCommand($lisp) }|Out-Null;Wait-AcadMarker $Document $marker;Invoke-ComRetry { $Document.Regen(1) }|Out-Null;Start-Sleep -Milliseconds 250
}
function Get-NativeLayerArc {
  param($Document,[string]$Layer)
  if($Layer-notmatch'^[A-Z0-9_]+$'){throw "Unsafe F-026 layer name: $Layer"}
  $marker=[Guid]::NewGuid().ToString('N')
  $lisp="(progn (setvar `"USERS1`" `"`") (setq f026s (ssget `"_X`" (list (cons 0 `"ARC`") (cons 8 `"$Layer`")))) (if (and f026s (= (sslength f026s) 1)) (progn (setq f026d (entget (ssname f026s 0))) (setvar `"USERS2`" (strcat (cdr (assoc 5 f026d)) `"|`" (rtos (cadr (assoc 10 f026d)) 2 15) `"|`" (rtos (caddr (assoc 10 f026d)) 2 15) `"|`" (rtos (cdr (assoc 40 f026d)) 2 15) `"|`" (rtos (cdr (assoc 50 f026d)) 2 15) `"|`" (rtos (cdr (assoc 51 f026d)) 2 15) `"|`" (itoa (if (assoc 62 f026d) (cdr (assoc 62 f026d)) 256)) `"|`" (itoa (if (assoc 370 f026d) (cdr (assoc 370 f026d)) -1)) `"|`" (if (assoc 6 f026d) (cdr (assoc 6 f026d)) `"ByLayer`")))) (setvar `"USERS2`" `"INVALID`")) (setvar `"USERS1`" `"$marker`") (princ))`n"
  Invoke-ComRetry { $Document.SendCommand($lisp) }|Out-Null;Wait-AcadMarker $Document $marker
  $raw=[string](Invoke-ComRetry { $Document.GetVariable('USERS2') });$parts=$raw.Split('|')
  if($parts.Count-ne9){throw "F-026 native ARC read-back failed for $Layer`: $raw"}
  $numbers=@($parts[1..5]|ForEach-Object{[double]::Parse($_,[Globalization.CultureInfo]::InvariantCulture)})
  return [ordered]@{objectName='AcDbArc';handle=$parts[0];layer=$Layer;color=[int]$parts[6];lineweight=[int]$parts[7];linetype=$parts[8];details=[ordered]@{center=@($numbers[0],$numbers[1]);radius=$numbers[2];startAngle=$numbers[3];endAngle=$numbers[4]};nativeDatabaseReadback=$true}
}
function Get-NativeSingleEntity {
  param($Document,[string]$DxfType)
  if($DxfType-notmatch'^[A-Z0-9_]+$'){throw "Unsafe F-026 DXF type: $DxfType"}
  $marker=[Guid]::NewGuid().ToString('N')
  $lisp="(progn (setvar `"USERS1`" `"`") (setq f026single (ssget `"_X`" (list (cons 0 `"$DxfType`")))) (if (and f026single (= (sslength f026single) 1)) (setvar `"USERS2`" (cdr (assoc 5 (entget (ssname f026single 0))))) (setvar `"USERS2`" `"INVALID`")) (setvar `"USERS1`" `"$marker`") (princ))`n"
  Invoke-ComRetry { $Document.SendCommand($lisp) }|Out-Null;Wait-AcadMarker $Document $marker
  $handle=[string](Invoke-ComRetry { $Document.GetVariable('USERS2') })
  if($handle-eq'INVALID'-or[string]::IsNullOrWhiteSpace($handle)){throw "F-026 native database requires exactly one $DxfType entity."}
  return Invoke-NonNullCom { $Document.HandleToObject($handle) } "native $DxfType $handle"
}
function Invoke-RejectedBreak {
  param($Acad,$Document,[int]$ProcessId,$Entity,[double]$X,[double]$Y,[bool]$AtPoint=$false)
  $handle=[string](Invoke-ComRetry { $Entity.Handle });$selection="(list (handent `"$handle`") $(Format-Point $X $Y))";$point=Format-Point $X $Y
  $body=if($AtPoint){"(command `"_.BREAKATPOINT`" $selection $point)"}else{"(command `"_.BREAK`" $selection $(Format-Point ($X+10) $Y))"}
  $helpers=@();try{foreach($delay in @(1000,3000)){$helpers+=Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$EscapeHelperPath,'-TargetProcessId',([string]$ProcessId),'-DelayMs',([string]$delay)) -WindowStyle Hidden -PassThru};Invoke-ComRetry { $Document.SendCommand("(progn $body (princ))`n") }|Out-Null;foreach($helper in $helpers){if(-not$helper.WaitForExit(15000)){throw 'F-026 Escape watchdog timed out.'}}}finally{foreach($helper in $helpers){if(-not$helper.HasExited){$helper.Kill();$helper.WaitForExit()}}}
  Wait-AcadIdle $Document;Invoke-ComRetry { $Document.Regen(1) }|Out-Null;Start-Sleep -Milliseconds 250
}
function Test-Near { param([double]$A,[double]$B,[double]$Tolerance=0.002);return [Math]::Abs($A-$B)-le$Tolerance }
function Test-Point { param($A,$B);return $A.Count-ge2-and(Test-Near $A[0] $B[0])-and(Test-Near $A[1] $B[1]) }
function Test-Line { param($Entity,$Start,$End);return $Entity.objectName-eq'AcDbLine'-and(Test-Point $Entity.details.start $Start)-and(Test-Point $Entity.details.end $End) }
function Test-CommonState { param($Entity,[string]$ObjectName,[string]$Layer,[string]$Handle='');return $Entity.objectName-eq$ObjectName-and$Entity.layer-eq$Layer-and$Entity.color-eq1-and$Entity.lineweight-eq50-and$Entity.linetype-eq'ByLayer'-and([string]::IsNullOrEmpty($Handle)-or$Entity.handle-eq$Handle) }
function Test-LineState { param($Entity,[string]$Layer,$Start,$End,[string]$Handle='');return (Test-CommonState $Entity 'AcDbLine' $Layer $Handle)-and(Test-Line $Entity $Start $End) }
function Test-ArcState { param($Entity,[string]$Layer,$Center,[double]$Radius,[double]$Start,[double]$End,[string]$Handle='');return (Test-CommonState $Entity 'AcDbArc' $Layer $Handle)-and(Test-Point $Entity.details.center $Center)-and(Test-Near $Entity.details.radius $Radius)-and(Test-Near $Entity.details.startAngle $Start)-and((Test-Near $Entity.details.endAngle $End)-or($End-eq(2*[Math]::PI)-and(Test-Near $Entity.details.endAngle 0))) }
function Test-EllipseState { param($Entity,[string]$Layer,$Center,$Major,[double]$Ratio,[double]$Start,[double]$End,[string]$Handle='');return (Test-CommonState $Entity 'AcDbEllipse' $Layer $Handle)-and(Test-Point $Entity.details.center $Center)-and(Test-Point $Entity.details.majorAxis $Major)-and(Test-Near $Entity.details.ratio $Ratio)-and(Test-Near $Entity.details.startParameter $Start)-and((Test-Near $Entity.details.endParameter $End)-or($End-eq(2*[Math]::PI)-and(Test-Near $Entity.details.endParameter 0))) }
function Test-PolylineState {
  param($Entity,[string]$Layer,$Vertices,$Widths,[bool]$Closed,[string]$Handle='')
  if(-not(Test-CommonState $Entity 'AcDbPolyline' $Layer $Handle)-or$Entity.details.closed-ne$Closed-or$Entity.details.vertices.Count-ne$Vertices.Count-or$Entity.details.widths.Count-ne$Widths.Count-or@($Entity.details.bulges|Where-Object{-not(Test-Near $_ 0)}).Count-ne0){return $false}
  for($index=0;$index-lt$Vertices.Count;$index+=1){if(-not(Test-Point $Entity.details.vertices[$index] $Vertices[$index])-or-not(Test-Point $Entity.details.widths[$index] $Widths[$index])){return $false}}
  return $true
}
function Test-StateSetExact { param($A,$B);$left=@($A|Sort-Object handle)|ConvertTo-Json -Depth 20 -Compress;$right=@($B|Sort-Object handle)|ConvertTo-Json -Depth 20 -Compress;return $left-eq$right }
function Test-SplineStateExact { param($A,$B);return (Test-StateSetExact @($A) @($B)) }
function Test-SplineExpected {
  param($Entity,[string]$Handle,$ControlPoints,$Knots)
  if($Entity.objectName-ne'AcDbSpline'-or$Entity.handle-ne$Handle-or$Entity.layer-ne'0'-or$Entity.color-ne256-or$Entity.lineweight-ne-1-or$Entity.linetype-ne'ByLayer'-or$Entity.details.degree-ne3-or$Entity.details.closed-or-not$Entity.details.rational-or$Entity.details.controlPoints.Count-ne$ControlPoints.Count-or$Entity.details.knots.Count-ne$Knots.Count-or$Entity.details.weights.Count-ne4){return $false}
  for($index=0;$index-lt$ControlPoints.Count;$index+=1){if(-not(Test-Point $Entity.details.controlPoints[$index] $ControlPoints[$index])){return $false}}
  for($index=0;$index-lt$Knots.Count;$index+=1){if(-not(Test-Near $Entity.details.knots[$index] $Knots[$index])){return $false}}
  return @($Entity.details.weights|Where-Object{-not(Test-Near $_ 2)}).Count-eq0
}

$acad=$null;$scratch=$null;$splineDocument=$null;$result=$null;$automationProcessId=0;$owned=$false;$ownedIdentity=$null
$preExistingProcessIds=@(Get-Process -Name acad -ErrorAction SilentlyContinue|ForEach-Object{[int]$_.Id})
try {
  $acad=New-Object -ComObject AutoCAD.Application.24.3
  [uint32]$resolvedProcessId=0
  [void][F026WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry { $acad.HWND }),[ref]$resolvedProcessId)
  $automationProcessId=[int]$resolvedProcessId
  $owned=$automationProcessId-gt0-and$preExistingProcessIds-notcontains$automationProcessId
  if(-not$owned){throw 'F-026 refuses to use a pre-existing AutoCAD process.'}
  $ownedIdentity=Write-OwnedPidSidecar $automationProcessId
  $installedUpdateIdentity=Get-InstalledAutoCadUpdateIdentity;Invoke-ComRetry { $acad.Visible=$true }|Out-Null
  if([int](Invoke-ComRetry { $acad.Documents.Count })-gt0){$candidate=Invoke-ComRetry { $acad.ActiveDocument };if([string](Invoke-ComRetry { $candidate.FullName })-or[int](Invoke-ComRetry { $candidate.ModelSpace.Count })-ne0){throw 'F-026 refuses a saved or nonblank automation document.'};$scratch=$candidate}else{$scratch=Invoke-ComRetry { $acad.Documents.Add() }}
  Invoke-ComRetry { $scratch.Activate();$scratch.SetVariable('CMDECHO',0);$scratch.SetVariable('FILEDIA',0) }|Out-Null;Wait-AcadIdle $scratch
  $layers=@('F026_DEFAULT','F026_FIRST','F026_AT','F026_AT_ELLIPSE','F026_AT_ELLIPSE_BREAK','F026_CIRCLE_FORWARD','F026_CIRCLE_REVERSE','F026_ARC','F026_ELLIPSE','F026_OPEN_POLY','F026_CLOSED_POLY','F026_GLOBAL','F026_LOCKED','F026_OFF','F026_FROZEN','F026_UNSUPPORTED');foreach($name in $layers){Invoke-ComRetry { $scratch.Layers.Add($name) }|Out-Null}

  $default=New-Line $scratch 'F026_DEFAULT' 0 0 100 0;$defaultHandle=[string](Invoke-ComRetry{$default.Handle});Invoke-Break $scratch $default 25 0 25 0 75 20 $false $false
  $first=New-Line $scratch 'F026_FIRST' 0 100 100 100;$firstHandle=[string](Invoke-ComRetry{$first.Handle});Invoke-Break $scratch $first 10 100 25 120 75 80 $true $false
  $at=New-Line $scratch 'F026_AT' 0 200 100 200;$atHandle=[string](Invoke-ComRetry{$at.Handle});Invoke-Break $scratch $at 50 210 50 210 50 210 $true $true
  [double[]]$aec=@(200,200,0);[double[]]$aemajor=@(50,0,0);$atEllipse=Invoke-ComRetry { $scratch.ModelSpace.AddEllipse($aec,$aemajor,0.5) };Invoke-ComRetry { $atEllipse.Layer='F026_AT_ELLIPSE';$atEllipse.Color=1;$atEllipse.Lineweight=50;$atEllipse.StartParameter=0;$atEllipse.EndParameter=[Math]::PI }|Out-Null;$atEllipseHandle=[string](Invoke-ComRetry{$atEllipse.Handle});Invoke-BreakAtPoint $scratch $atEllipse 200 225 200 240
  [double[]]$aebc=@(350,200,0);$atEllipseBreak=Invoke-ComRetry { $scratch.ModelSpace.AddEllipse($aebc,$aemajor,0.5) };Invoke-ComRetry { $atEllipseBreak.Layer='F026_AT_ELLIPSE_BREAK';$atEllipseBreak.Color=1;$atEllipseBreak.Lineweight=50;$atEllipseBreak.StartParameter=0;$atEllipseBreak.EndParameter=[Math]::PI }|Out-Null;$atEllipseBreakHandle=[string](Invoke-ComRetry{$atEllipseBreak.Handle});Invoke-Break $scratch $atEllipseBreak 350 225 350 225 350 240 $true $true
  [double[]]$c1=@(200,0,0);$circleForward=Invoke-ComRetry { $scratch.ModelSpace.AddCircle($c1,50) };Invoke-ComRetry { $circleForward.Layer='F026_CIRCLE_FORWARD';$circleForward.Color=1;$circleForward.Lineweight=50 }|Out-Null;$circleForwardHandle=[string](Invoke-ComRetry{$circleForward.Handle});Invoke-Break $scratch $circleForward 250 0 250 0 200 50 $true $false
  [double[]]$c2=@(350,0,0);$circleReverse=Invoke-ComRetry { $scratch.ModelSpace.AddCircle($c2,50) };Invoke-ComRetry { $circleReverse.Layer='F026_CIRCLE_REVERSE';$circleReverse.Color=1;$circleReverse.Lineweight=50 }|Out-Null;$circleReverseHandle=[string](Invoke-ComRetry{$circleReverse.Handle});Invoke-Break $scratch $circleReverse 350 50 350 50 400 0 $true $false
  $circleForwardNative=Get-NativeLayerArc $scratch 'F026_CIRCLE_FORWARD';$circleReverseNative=Get-NativeLayerArc $scratch 'F026_CIRCLE_REVERSE'
  [double[]]$ac=@(500,0,0);$arc=Invoke-ComRetry { $scratch.ModelSpace.AddArc($ac,50,0,[Math]::PI) };Invoke-ComRetry { $arc.Layer='F026_ARC';$arc.Color=1;$arc.Lineweight=50 }|Out-Null;$arcHandle=[string](Invoke-ComRetry{$arc.Handle});Invoke-Break $scratch $arc 550 0 535 35 465 35 $true $false
  [double[]]$ec=@(650,0,0);[double[]]$major=@(50,0,0);$ellipse=Invoke-ComRetry { $scratch.ModelSpace.AddEllipse($ec,$major,0.5) };Invoke-ComRetry { $ellipse.Layer='F026_ELLIPSE';$ellipse.Color=1;$ellipse.Lineweight=50 }|Out-Null;$ellipseHandle=[string](Invoke-ComRetry{$ellipse.Handle});Invoke-Break $scratch $ellipse 700 0 700 0 650 25 $true $false
  $open=New-Polyline $scratch 'F026_OPEN_POLY' ([double[]]@(0,300,100,300,200,300)) $false;Invoke-ComRetry { $open.SetWidth(0,2,4);$open.SetWidth(1,4,6) }|Out-Null;$openHandle=[string](Invoke-ComRetry{$open.Handle});Invoke-Break $scratch $open 25 300 25 300 175 320 $true $false
  $closed=New-Polyline $scratch 'F026_CLOSED_POLY' ([double[]]@(300,300,400,300,400,400,300,400)) $true;$closedHandle=[string](Invoke-ComRetry{$closed.Handle});Invoke-Break $scratch $closed 350 300 350 300 400 350 $true $false

  $g1=New-Line $scratch 'F026_GLOBAL' 0 500 100 500;$g2=New-Line $scratch 'F026_GLOBAL' 0 550 100 550;$g1Handle=[string](Invoke-ComRetry{$g1.Handle});$g2Handle=[string](Invoke-ComRetry{$g2.Handle});$globalSource=@((Get-EntityState $g1),(Get-EntityState $g2));Invoke-ComRetry { $scratch.StartUndoMark() }|Out-Null;try{Invoke-Break $scratch $g1 25 500 25 500 75 500 $true $false;Invoke-Break $scratch $g2 25 550 25 550 75 550 $true $false}finally{Invoke-ComRetry { $scratch.EndUndoMark() }|Out-Null};$globalCommitted=@(Get-LayerStates $scratch 'F026_GLOBAL');Invoke-ComRetry { $scratch.SendCommand("_.UNDO`n1`n") }|Out-Null;Wait-AcadIdle $scratch;$globalUndone=@(Get-LayerStates $scratch 'F026_GLOBAL');Invoke-ComRetry { $scratch.SendCommand("_.REDO`n") }|Out-Null;Wait-AcadIdle $scratch;$globalRedone=@(Get-LayerStates $scratch 'F026_GLOBAL')

  $locked=New-Line $scratch 'F026_LOCKED' 0 700 100 700;$lockedHandle=[string](Invoke-ComRetry{$locked.Handle});$lockedLayer=Invoke-ComRetry { $scratch.Layers.Item('F026_LOCKED') };Invoke-ComRetry { $lockedLayer.Lock=$true }|Out-Null;Invoke-RejectedBreak $acad $scratch $automationProcessId $locked 50 700 $false;Invoke-ComRetry { $lockedLayer.Lock=$false }|Out-Null
  $off=New-Line $scratch 'F026_OFF' 0 750 100 750;$offHandle=[string](Invoke-ComRetry{$off.Handle});$offLayer=Invoke-ComRetry { $scratch.Layers.Item('F026_OFF') };Invoke-ComRetry { $offLayer.LayerOn=$false }|Out-Null;Invoke-RejectedBreak $acad $scratch $automationProcessId $off 50 750 $false;Invoke-ComRetry { $offLayer.LayerOn=$true }|Out-Null
  $frozen=New-Line $scratch 'F026_FROZEN' 0 800 100 800;$frozenHandle=[string](Invoke-ComRetry{$frozen.Handle});$frozenLayer=Invoke-ComRetry { $scratch.Layers.Item('F026_FROZEN') };Invoke-ComRetry { $frozenLayer.Freeze=$true }|Out-Null;Invoke-RejectedBreak $acad $scratch $automationProcessId $frozen 50 800 $false;Invoke-ComRetry { $frozenLayer.Freeze=$false }|Out-Null
  [double[]]$textPoint=@(0,850,0);$text=Invoke-ComRetry { $scratch.ModelSpace.AddText('unsupported',$textPoint,10) };Invoke-ComRetry { $text.Layer='F026_UNSUPPORTED' }|Out-Null;Invoke-RejectedBreak $acad $scratch $automationProcessId $text 10 850 $false

  Invoke-ComRetry { $scratch.Regen(1);$scratch.SaveAs($DxfOutputPath,65) } -TimeoutSeconds 90|Out-Null;Wait-AcadIdle $scratch
  $observations=[ordered]@{ default=@(Get-LayerStates $scratch 'F026_DEFAULT');first=@(Get-LayerStates $scratch 'F026_FIRST');atPoint=@(Get-LayerStates $scratch 'F026_AT');atPointOpenEllipse=@(Get-LayerStates $scratch 'F026_AT_ELLIPSE');atPointOpenEllipseBreak=@(Get-LayerStates $scratch 'F026_AT_ELLIPSE_BREAK');circleForward=@($circleForwardNative);circleReverse=@($circleReverseNative);arc=@(Get-LayerStates $scratch 'F026_ARC');ellipse=@(Get-LayerStates $scratch 'F026_ELLIPSE');openPolyline=@(Get-LayerStates $scratch 'F026_OPEN_POLY');closedPolyline=@(Get-LayerStates $scratch 'F026_CLOSED_POLY');globalUndoRedo=[ordered]@{source=$globalSource;committed=$globalCommitted;undone=$globalUndone;redone=$globalRedone};locked=@(Get-LayerStates $scratch 'F026_LOCKED');off=@(Get-LayerStates $scratch 'F026_OFF');frozen=@(Get-LayerStates $scratch 'F026_FROZEN');unsupported=@(Get-LayerStates $scratch 'F026_UNSUPPORTED')}

  $splineDocument=Invoke-NonNullCom { $acad.Documents.Open($SplineFixturePath,$false) } 'F-026 rational SPLINE BREAK-at-point document' -TimeoutSeconds 30;Invoke-ComRetry { $splineDocument.Activate() }|Out-Null;Wait-AcadIdle $splineDocument
  $spline=Get-NativeSingleEntity $splineDocument 'SPLINE';$splineBreakBefore=Get-EntityState $spline;Invoke-Break $splineDocument $spline 50 0 50 0 50 0 $true $true;$splineAfterBreakAtPoint=@(Get-EntityState (Get-NativeSingleEntity $splineDocument 'SPLINE'));Invoke-ComRetry { $splineDocument.Close($false) }|Out-Null;$splineDocument=$null
  $splineDocument=Invoke-NonNullCom { $acad.Documents.Open($SplineFixturePath,$false) } 'F-026 rational SPLINE BREAKATPOINT document' -TimeoutSeconds 30;Invoke-ComRetry { $splineDocument.Activate() }|Out-Null;Wait-AcadIdle $splineDocument
  $spline=Get-NativeSingleEntity $splineDocument 'SPLINE';$splineAtPointBefore=Get-EntityState $spline;Invoke-RejectedBreak $acad $splineDocument $automationProcessId $spline 50 0 $true;$splineAfterAtPoint=@(Get-EntityState (Get-NativeSingleEntity $splineDocument 'SPLINE'));Invoke-ComRetry { $splineDocument.Close($false) }|Out-Null;$splineDocument=$null
  $splineDocument=Invoke-NonNullCom { $acad.Documents.Open($SplineFixturePath,$false) } 'F-026 rational SPLINE two-point document' -TimeoutSeconds 30;Invoke-ComRetry { $splineDocument.Activate() }|Out-Null;Wait-AcadIdle $splineDocument
  $spline=Get-NativeSingleEntity $splineDocument 'SPLINE';$splineBefore=Get-EntityState $spline;Invoke-Break $splineDocument $spline 10 20 25 50 75 -50 $true $false;$splineAfter=@();for($index=0;$index-lt[int](Invoke-ComRetry { $splineDocument.ModelSpace.Count });$index+=1){$candidate=Invoke-ComRetry { $splineDocument.ModelSpace.Item($index) };if([string](Invoke-ComRetry { $candidate.ObjectName })-eq'AcDbSpline'){$splineAfter+=Get-EntityState $candidate}};Invoke-ComRetry { $splineDocument.SaveAs($SplineOutputPath,65) } -TimeoutSeconds 90|Out-Null;Wait-AcadIdle $splineDocument

  $checks=[ordered]@{
    defaultSelectionFirstAndProjection=($observations.default.Count-eq2-and@($observations.default|Where-Object{Test-LineState $_ 'F026_DEFAULT' @(0,0) @(25,0) $defaultHandle}).Count-eq1-and@($observations.default|Where-Object{Test-LineState $_ 'F026_DEFAULT' @(75,0) @(100,0)}).Count-eq1-and@($observations.default|ForEach-Object{[string]$_.handle}|Sort-Object -Unique).Count-eq2)
    explicitFirstAndProjection=($observations.first.Count-eq2-and@($observations.first|Where-Object{Test-LineState $_ 'F026_FIRST' @(0,100) @(25,100) $firstHandle}).Count-eq1-and@($observations.first|Where-Object{Test-LineState $_ 'F026_FIRST' @(75,100) @(100,100)}).Count-eq1-and@($observations.first|ForEach-Object{[string]$_.handle}|Sort-Object -Unique).Count-eq2)
    atPointSplit=($observations.atPoint.Count-eq2-and@($observations.atPoint|Where-Object{Test-LineState $_ 'F026_AT' @(0,200) @(50,200) $atHandle}).Count-eq1-and@($observations.atPoint|Where-Object{Test-LineState $_ 'F026_AT' @(50,200) @(100,200)}).Count-eq1-and@($observations.atPoint|ForEach-Object{[string]$_.handle}|Sort-Object -Unique).Count-eq2)
    breakAtPointOpenEllipse=($observations.atPointOpenEllipse.Count-eq2-and@($observations.atPointOpenEllipse|Where-Object{Test-EllipseState $_ 'F026_AT_ELLIPSE' @(200,200) @(50,0) 0.5 0 ([Math]::PI/2) $atEllipseHandle}).Count-eq1-and@($observations.atPointOpenEllipse|Where-Object{Test-EllipseState $_ 'F026_AT_ELLIPSE' @(200,200) @(50,0) 0.5 ([Math]::PI/2) ([Math]::PI)}).Count-eq1)
    breakAtSignOpenEllipse=($observations.atPointOpenEllipseBreak.Count-eq2-and@($observations.atPointOpenEllipseBreak|Where-Object{Test-EllipseState $_ 'F026_AT_ELLIPSE_BREAK' @(350,200) @(50,0) 0.5 0 ([Math]::PI/2) $atEllipseBreakHandle}).Count-eq1-and@($observations.atPointOpenEllipseBreak|Where-Object{Test-EllipseState $_ 'F026_AT_ELLIPSE_BREAK' @(350,200) @(50,0) 0.5 ([Math]::PI/2) ([Math]::PI)}).Count-eq1)
    circleDirection=($observations.circleForward.Count-eq1-and$observations.circleReverse.Count-eq1-and(Test-ArcState $observations.circleForward[0] 'F026_CIRCLE_FORWARD' @(200,0) 50 ([Math]::PI/2) (2*[Math]::PI) $circleForwardHandle)-and(Test-ArcState $observations.circleReverse[0] 'F026_CIRCLE_REVERSE' @(350,0) 50 0 ([Math]::PI/2) $circleReverseHandle)-and$observations.circleForward[0].nativeDatabaseReadback-and$observations.circleReverse[0].nativeDatabaseReadback)
    arcTwoPoint=($observations.arc.Count-eq2-and@($observations.arc|Where-Object{Test-ArcState $_ 'F026_ARC' @(500,0) 50 0 ([Math]::PI/4) $arcHandle}).Count-eq1-and@($observations.arc|Where-Object{Test-ArcState $_ 'F026_ARC' @(500,0) 50 (3*[Math]::PI/4) ([Math]::PI)}).Count-eq1)
    ellipseTwoPoint=($observations.ellipse.Count-eq1-and(Test-EllipseState $observations.ellipse[0] 'F026_ELLIPSE' @(650,0) @(50,0) 0.5 ([Math]::PI/2) (2*[Math]::PI) $ellipseHandle))
    openPolylineTwoPieces=($observations.openPolyline.Count-eq2-and@($observations.openPolyline|Where-Object{Test-PolylineState $_ 'F026_OPEN_POLY' @(@(0,300),@(25,300)) @(@(2,2.5),@(2,2.5)) $false $openHandle}).Count-eq1-and@($observations.openPolyline|Where-Object{Test-PolylineState $_ 'F026_OPEN_POLY' @(@(175,300),@(200,300)) @(@(5.5,6),@(0,0)) $false}).Count-eq1)
    closedPolylineComplement=($observations.closedPolyline.Count-eq1-and(Test-PolylineState $observations.closedPolyline[0] 'F026_CLOSED_POLY' @(@(400,350),@(400,400),@(300,400),@(300,300),@(350,300)) @(@(0,0),@(0,0),@(0,0),@(0,0),@(0,0)) $false $closedHandle))
    globalAtomicUndoRedo=($observations.globalUndoRedo.committed.Count-eq4-and(Test-StateSetExact $observations.globalUndoRedo.source $observations.globalUndoRedo.undone)-and(Test-StateSetExact $observations.globalUndoRedo.committed $observations.globalUndoRedo.redone)-and@($observations.globalUndoRedo.committed|Where-Object{Test-LineState $_ 'F026_GLOBAL' @(0,500) @(25,500) $g1Handle}).Count-eq1-and@($observations.globalUndoRedo.committed|Where-Object{Test-LineState $_ 'F026_GLOBAL' @(0,550) @(25,550) $g2Handle}).Count-eq1-and@($observations.globalUndoRedo.committed|Where-Object{Test-LineState $_ 'F026_GLOBAL' @(75,500) @(100,500)}).Count-eq1-and@($observations.globalUndoRedo.committed|Where-Object{Test-LineState $_ 'F026_GLOBAL' @(75,550) @(100,550)}).Count-eq1)
    propertiesPreserved=(@($observations.default|Where-Object{$_.color-eq1-and$_.lineweight-eq50-and$_.layer-eq'F026_DEFAULT'}).Count-eq2)
    lockedRefused=($observations.locked.Count-eq1-and(Test-LineState $observations.locked[0] 'F026_LOCKED' @(0,700) @(100,700) $lockedHandle))
    layerBehaviorMeasured=($observations.off.Count-eq2-and@($observations.off|Where-Object{Test-LineState $_ 'F026_OFF' @(0,750) @(50,750) $offHandle}).Count-eq1-and@($observations.off|Where-Object{Test-LineState $_ 'F026_OFF' @(60,750) @(100,750)}).Count-eq1-and@($observations.off|ForEach-Object{[string]$_.handle}|Sort-Object -Unique).Count-eq2-and$observations.frozen.Count-eq2-and@($observations.frozen|Where-Object{Test-LineState $_ 'F026_FROZEN' @(0,800) @(50,800) $frozenHandle}).Count-eq1-and@($observations.frozen|Where-Object{Test-LineState $_ 'F026_FROZEN' @(60,800) @(100,800)}).Count-eq1-and@($observations.frozen|ForEach-Object{[string]$_.handle}|Sort-Object -Unique).Count-eq2)
    unsupportedRefused=($observations.unsupported.Count-eq1-and$observations.unsupported[0].objectName-eq'AcDbText')
    rationalSplineTwoPieces=($splineAfter.Count-eq2-and@($splineAfter|Where-Object{Test-SplineExpected $_ $splineBefore.handle @(@(0,0),@(7.452466686480491,22.357400059441495),@(14.90493337296099,29.71919999634556),@(22.35740005944149,28.79065243213177)) @(0,0,0,0,0.22357400059441496,0.22357400059441496,0.22357400059441496,0.22357400059441496)}).Count-eq1-and@($splineAfter|Where-Object{$_.handle-ne$splineBefore.handle-and(Test-SplineExpected $_ $_.handle @(@(77.64259994055853,-28.79065243213176),@(85.09506662703902,-29.71919999634555),@(92.54753331351951,-22.357400059441492),@(100,0)) @(0.7764259994055851,0.7764259994055851,0.7764259994055851,0.7764259994055851,1,1,1,1))}).Count-eq1-and@($splineAfter|ForEach-Object{[string]$_.handle}|Sort-Object -Unique).Count-eq2)
    breakAtSignOpenSplineRefused=($splineAfterBreakAtPoint.Count-eq1-and(Test-SplineStateExact $splineBreakBefore $splineAfterBreakAtPoint[0]))
    breakAtPointOpenSplineRefused=($splineAfterAtPoint.Count-eq1-and(Test-SplineStateExact $splineAtPointBefore $splineAfterAtPoint[0]))
  }
  $result=[ordered]@{schemaVersion=1;rowId='F-026';benchmark='AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation';engine='Autodesk AutoCAD 2024 desktop COM';engineVersion=[string](Invoke-ComRetry { $acad.Version });automationProcessId=$automationProcessId;automationProcessOwned=$owned;installedUpdateIdentity=$installedUpdateIdentity;automationProcessIdentity=[ordered]@{processId=$ownedIdentity.processId;executableName=$ownedIdentity.executableName;executableSha256=$ownedIdentity.executableSha256;fileVersion=$ownedIdentity.fileVersion;productVersion=$ownedIdentity.productVersion;startTimeSha256=$ownedIdentity.startTimeSha256};observations=$observations;rationalSpline=[ordered]@{breakAtSign=[ordered]@{before=$splineBreakBefore;after=$splineAfterBreakAtPoint};breakAtPoint=[ordered]@{before=$splineAtPointBefore;after=$splineAfterAtPoint};before=$splineBefore;after=$splineAfter;outputSha256=Get-FileSha256 $SplineOutputPath};checks=$checks;dxfOutputSha256=Get-FileSha256 $DxfOutputPath;cmdNamesAfter=[string](Invoke-ComRetry { $splineDocument.GetVariable('CMDNAMES') });userDocument=[ordered]@{isolatedOwnedProcess=$owned;blankRestored=$true};status=if(@($checks.Values|Where-Object{$_-ne$true}).Count-eq0){'PASS'}else{'FAIL'}}
} finally {
  if($acad-and-not$owned){
    try{
      [uint32]$finallyProcessId=0
      [void][F026WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry { $acad.HWND }),[ref]$finallyProcessId)
      if([int]$finallyProcessId-gt0-and$preExistingProcessIds-notcontains[int]$finallyProcessId){$automationProcessId=[int]$finallyProcessId;$ownedIdentity=Write-OwnedPidSidecar $automationProcessId;$owned=$true}
    }catch{}
  }
  if($splineDocument){try{Invoke-ComRetry { $splineDocument.Close($false) } -TimeoutSeconds 10|Out-Null}catch{}}
  if($scratch){try{Invoke-ComRetry { $scratch.Close($false) } -TimeoutSeconds 10|Out-Null}catch{}}
  if($owned-and$acad){try{Invoke-ComRetry { $acad.Quit() } -TimeoutSeconds 10|Out-Null}catch{}}
}
if(-not$result){throw 'F-026 AutoCAD matrix produced no result.'};$result|ConvertTo-Json -Depth 16;if($result.status-ne'PASS'){exit 1}
