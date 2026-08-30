param(
  [Parameter(Mandatory = $true)][string]$PidPath,
  [Parameter(Mandatory = $true)][string]$OwnershipToken,
  [Parameter(Mandatory = $true)][string]$DxfOutputPath,
  [Parameter(Mandatory = $true)][string]$SourceDxfPath
)

$ErrorActionPreference = 'Stop'
$DxfOutputPath = [IO.Path]::GetFullPath($DxfOutputPath)
if ([IO.Path]::GetExtension($DxfOutputPath) -ine '.dxf' -or (Test-Path -LiteralPath $DxfOutputPath)) { throw 'F-028 DXF output must be a new .dxf path.' }
$SourceDxfPath = [IO.Path]::GetFullPath($SourceDxfPath)
if ([IO.Path]::GetExtension($SourceDxfPath) -ine '.dxf' -or -not (Test-Path -LiteralPath $SourceDxfPath) -or $SourceDxfPath -eq $DxfOutputPath) { throw 'F-028 source DXF must be an existing, distinct .dxf path.' }
$interopCommonPath = 'C:\Program Files\Autodesk\AutoCAD 2024\Autodesk.AutoCAD.Interop.Common.dll'
if (-not (Test-Path -LiteralPath $interopCommonPath)) { throw "F-028 requires $interopCommonPath" }
Add-Type -Path $interopCommonPath
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class F028WindowProcess {
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
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
    if ([DateTime]::UtcNow -ge $deadline) { throw "$Label remained null." }
    Start-Sleep -Milliseconds 150
  } while ($true)
}
function Wait-AcadIdle {
  param($Document, [int]$TimeoutSeconds = 45)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 100
    try { if ([string]::IsNullOrWhiteSpace([string]$Document.GetVariable('CMDNAMES')) -and [int]$Document.GetVariable('CMDACTIVE') -eq 0) { return } } catch {}
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "F-028 AutoCAD did not return idle. CMDNAMES='$($Document.GetVariable('CMDNAMES'))' LASTPROMPT='$($Document.GetVariable('LASTPROMPT'))'"
}
function Wait-AcadMarker {
  param($Document, [string]$Marker, [int]$TimeoutSeconds = 45)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 100
    try { if ([string]$Document.GetVariable('USERS1') -eq $Marker) { Wait-AcadIdle $Document $TimeoutSeconds; return } } catch {}
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "F-028 marker $Marker timed out. CMDNAMES='$($Document.GetVariable('CMDNAMES'))' LASTPROMPT='$($Document.GetVariable('LASTPROMPT'))'"
}
function Get-StringSha256 { param([string]$Value); $hash=[Security.Cryptography.SHA256]::Create(); try { return ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value))).Replace('-','').ToLowerInvariant()) } finally { $hash.Dispose() } }
function Get-FileSha256 { param([string]$Path); $hash=[Security.Cryptography.SHA256]::Create(); $stream=[IO.File]::OpenRead($Path); try { return ([BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-','').ToLowerInvariant()) } finally { $stream.Dispose();$hash.Dispose() } }
function Get-OwnedAcadIdentity {
  param([int]$ProcessId)
  $process=Get-Process -Id $ProcessId -ErrorAction Stop; $path=[IO.Path]::GetFullPath([string]$process.Path)
  if ([IO.Path]::GetFileName($path) -ine 'acad.exe') { throw "F-028 PID $ProcessId is not acad.exe." }
  $start=$process.StartTime.ToUniversalTime().ToString('o'); $version=(Get-Item -LiteralPath $path).VersionInfo
  return [ordered]@{processId=$ProcessId;executablePath=$path;executableName='acad.exe';executableSha256=Get-FileSha256 $path;fileVersion=[string]$version.FileVersion;productVersion=[string]$version.ProductVersion;startTimeUtc=$start;startTimeSha256=Get-StringSha256 $start}
}
function Write-OwnedPidSidecar {
  param([int]$ProcessId)
  $identity=Get-OwnedAcadIdentity $ProcessId
  [ordered]@{schemaVersion=1;processId=$identity.processId;executablePath=$identity.executablePath;executableName=$identity.executableName;executableSha256=$identity.executableSha256;fileVersion=$identity.fileVersion;productVersion=$identity.productVersion;startTimeUtc=$identity.startTimeUtc;startTimeSha256=$identity.startTimeSha256;owned=$true;token=$OwnershipToken}|ConvertTo-Json -Compress|Set-Content -LiteralPath $PidPath -Encoding ascii
  return $identity
}
function Get-InstalledAutoCadUpdateIdentity {
  $items=@(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue)+@(Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue)
  $match=$items|Where-Object{$_.DisplayName-eq'Autodesk AutoCAD 2024.1.2 Update'}|Select-Object -First 1
  if($match){return [ordered]@{displayName=[string]$match.DisplayName;displayVersion=[string]$match.DisplayVersion}};return $null
}
function Format-Number { param([double]$Value); return [string]::Format([Globalization.CultureInfo]::InvariantCulture,'{0:R}',$Value) }
function Format-Point { param([double]$X,[double]$Y); return "(list $(Format-Number $X) $(Format-Number $Y) 0.0)" }
function Get-Point2 { param($Value); return @([double]$Value[0],[double]$Value[1]) }
function Get-EntityLength {
  param($Entity,[string]$ObjectName)
  if($ObjectName-eq'AcDbArc'-or$ObjectName-eq'AcDbEllipse'){return [double](Invoke-ComRetry{$Entity.ArcLength})}
  return [double](Invoke-ComRetry{$Entity.Length})
}
function Get-EntityState {
  param($Entity)
  $name=[string](Invoke-ComRetry{$Entity.ObjectName});$details=[ordered]@{}
  if($name-eq'AcDbLine'){$details.start=Get-Point2(Invoke-NonNullCom{$Entity.StartPoint}'line start');$details.end=Get-Point2(Invoke-NonNullCom{$Entity.EndPoint}'line end')}
  elseif($name-eq'AcDbArc'){$details.center=Get-Point2(Invoke-NonNullCom{$Entity.Center}'arc center');$details.radius=[double](Invoke-ComRetry{$Entity.Radius});$details.startAngle=[double](Invoke-ComRetry{$Entity.StartAngle});$details.endAngle=[double](Invoke-ComRetry{$Entity.EndAngle})}
  elseif($name-eq'AcDbPolyline'){
    $flat=@(Invoke-NonNullCom{$Entity.Coordinates}'polyline coordinates');$vertices=@();for($i=0;$i+1-lt$flat.Count;$i+=2){$vertices+=,@([double]$flat[$i],[double]$flat[$i+1])}
    $details.vertices=$vertices;$details.closed=[bool](Invoke-ComRetry{$Entity.Closed});$details.bulges=@();$details.widths=@();for($i=0;$i-lt$vertices.Count;$i+=1){$details.bulges+=[double](Invoke-ComRetry{$Entity.GetBulge($i)});[double]$sw=0;[double]$ew=0;Invoke-ComRetry{$Entity.GetWidth($i,[ref]$sw,[ref]$ew)}|Out-Null;$details.widths+=,@($sw,$ew)}
  }
  elseif($name-eq'AcDbEllipse'){$details.center=Get-Point2(Invoke-NonNullCom{$Entity.Center}'ellipse center');$details.majorAxis=Get-Point2(Invoke-NonNullCom{$Entity.MajorAxis}'ellipse major');$details.ratio=[double](Invoke-ComRetry{$Entity.RadiusRatio});$details.startParameter=[double](Invoke-ComRetry{$Entity.StartParameter});$details.endParameter=[double](Invoke-ComRetry{$Entity.EndParameter})}
  elseif($name-eq'AcDbSpline'){
    $flat=@(Invoke-ComRetry{$Entity.FitPoints});$points=@();for($i=0;$i+2-lt$flat.Count;$i+=3){$points+=,@([double]$flat[$i],[double]$flat[$i+1])};$details.fitPoints=$points
    $flatControl=@(Invoke-NonNullCom{$Entity.ControlPoints}'spline control points');$controlPoints=@();for($i=0;$i+2-lt$flatControl.Count;$i+=3){$controlPoints+=,@([double]$flatControl[$i],[double]$flatControl[$i+1])};$details.controlPoints=$controlPoints
    $details.knots=@(Invoke-NonNullCom{$Entity.Knots}'spline knots'|ForEach-Object{[double]$_});$splineWeights=Invoke-ComRetry{$Entity.Weights};if($null-eq$splineWeights){$details.weights=[object[]]@()}else{$details.weights=@($splineWeights|ForEach-Object{[double]$_})};$details.degree=[int](Invoke-ComRetry{$Entity.Degree})
  }
  else{$details.unsupported=$true}
  if(-not$details.unsupported){$details.length=Get-EntityLength $Entity $name}
  return [ordered]@{objectName=$name;handle=[string](Invoke-ComRetry{$Entity.Handle});layer=[string](Invoke-ComRetry{$Entity.Layer});color=[int](Invoke-ComRetry{$Entity.Color});lineweight=[int](Invoke-ComRetry{$Entity.Lineweight});linetype=[string](Invoke-ComRetry{$Entity.Linetype});details=$details}
}
function Get-StateByHandle {
  param($Document,[string]$Handle)
  try {$entity=Invoke-ComRetry{$Document.HandleToObject($Handle)}}
  catch {throw "F-028 handle $Handle no longer resolves: $($_.Exception.Message)"}
  return Get-EntityState(Invoke-NonNullCom{$entity}"entity $Handle")
}
function Get-LayerStates {
  param($Document,[string]$Layer)
  $result=@();$count=[int](Invoke-ComRetry{$Document.ModelSpace.Count});for($i=0;$i-lt$count;$i+=1){$entity=Invoke-ComRetry{$Document.ModelSpace.Item($i)};if([string](Invoke-ComRetry{$entity.Layer})-eq$Layer){$result+=Get-StateByHandle $Document ([string](Invoke-ComRetry{$entity.Handle}))}}
  return @($result|Sort-Object handle)
}
function Set-Common { param($Entity,[string]$Layer);Invoke-ComRetry{$Entity.Layer=$Layer;$Entity.Color=1;$Entity.Lineweight=35}|Out-Null;return $Entity }
function New-Line { param($Document,[string]$Layer,[double]$X1,[double]$Y1,[double]$X2,[double]$Y2);[double[]]$a=@($X1,$Y1,0);[double[]]$b=@($X2,$Y2,0);return Set-Common(Invoke-ComRetry{$Document.ModelSpace.AddLine($a,$b)})$Layer }
function New-Arc { param($Document,[string]$Layer,[double]$X,[double]$Y,[double]$Radius,[double]$Start,[double]$End);[double[]]$center=@($X,$Y,0);return Set-Common(Invoke-ComRetry{$Document.ModelSpace.AddArc($center,$Radius,$Start,$End)})$Layer }
function New-Polyline { param($Document,[string]$Layer,[double[]]$Coordinates);return Set-Common(Invoke-ComRetry{$Document.ModelSpace.AddLightWeightPolyline($Coordinates)})$Layer }
function New-Ellipse { param($Document,[string]$Layer,[double]$X,[double]$Y,[double]$MajorX,[double]$MajorY,[double]$Ratio,[double]$Start,[double]$End);[double[]]$center=@($X,$Y,0);[double[]]$major=@($MajorX,$MajorY,0);$entity=Set-Common(Invoke-ComRetry{$Document.ModelSpace.AddEllipse($center,$major,$Ratio)})$Layer;Invoke-ComRetry{$entity.StartParameter=$Start;$entity.EndParameter=$End}|Out-Null;return $entity }
function New-Spline { param($Document,[string]$Layer);[double[]]$fit=@(400,500,0,460,580,0,520,500,0);[double[]]$start=@(60,80,0);[double[]]$finish=@(60,-80,0);return Set-Common(Invoke-NonNullCom{$Document.ModelSpace.AddSpline($fit,$start,$finish)}'fit-point spline')$Layer }
function New-SelectionExpression { param($Entity,[double]$X,[double]$Y);$handle=[string](Invoke-ComRetry{$Entity.Handle});return "(list (handent `"$handle`") $(Format-Point $X $Y))" }
function Invoke-Lengthen {
  param($Document,[string]$Mode,[double]$Value,$Selections,[string]$Measurement='Length',[switch]$UndoLast)
  $marker=[Guid]::NewGuid().ToString('N');$selectionArguments=($Selections|ForEach-Object{New-SelectionExpression $_.entity $_.x $_.y})-join' '
  $modeArgument=switch($Mode){'Delta'{'"_DElta"'}'Percent'{'"_Percent"'}'Total'{'"_Total"'}default{throw "Unsupported F-028 mode $Mode"}}
  $measurementArgument=if($Measurement-eq'Angle'){'"_Angle" '}else{''};$undoArgument=if($UndoLast){' "_Undo"'}else{''}
  $body="(command `"_.LENGTHEN`" $modeArgument $measurementArgument$(Format-Number $Value) $selectionArguments$undoArgument `"`")"
  $lisp="(progn (setvar `"USERS1`" `"`") $body (setvar `"USERS1`" `"$marker`") (princ))`n"
  Invoke-ComRetry{$Document.SendCommand($lisp)}|Out-Null;Wait-AcadMarker $Document $marker
}
function Invoke-LengthenDynamic {
  param($Document,$Entity,[double]$PickX,[double]$PickY,[double]$DestinationX,[double]$DestinationY)
  $marker=[Guid]::NewGuid().ToString('N');$selection=New-SelectionExpression $Entity $PickX $PickY
  $lisp="(progn (setvar `"USERS1`" `"`") (command `"_.LENGTHEN`" `"_DYnamic`" $selection $(Format-Point $DestinationX $DestinationY) `"`") (setvar `"USERS1`" `"$marker`") (princ))`n"
  Invoke-ComRetry{$Document.SendCommand($lisp)}|Out-Null;Wait-AcadMarker $Document $marker
}
function Test-Near { param([double]$A,[double]$B,[double]$Tolerance=0.000001);return [Math]::Abs($A-$B)-le$Tolerance }
function Test-Point { param($A,$B);return $A.Count-ge2-and(Test-Near $A[0] $B[0])-and(Test-Near $A[1] $B[1]) }
function Test-ExactJson { param($A,$B);return ($A|ConvertTo-Json -Depth 12 -Compress)-eq($B|ConvertTo-Json -Depth 12 -Compress) }
function Test-PointSet { param($A,$B);$actual=@($A);$expected=@($B);if($actual.Count-ne$expected.Count){return $false};for($i=0;$i-lt$expected.Count;$i++){if(-not(Test-Point $actual[$i] $expected[$i])){return $false}};return $true }
function Test-NumberSet { param($A,$B);$actual=@($A);$expected=@($B);if($actual.Count-ne$expected.Count){return $false};for($i=0;$i-lt$expected.Count;$i++){if(-not(Test-Near $actual[$i] $expected[$i])){return $false}};return $true }
function Test-CommonPreserved { param($Before,$After);return $Before.objectName-eq$After.objectName-and$Before.handle-eq$After.handle-and$Before.layer-eq$After.layer-and$Before.color-eq$After.color-and$Before.lineweight-eq$After.lineweight-and$Before.linetype-eq$After.linetype }
function Test-StateEqual {
  param($A,$B)
  if($null-eq$A-or$null-eq$B-or-not(Test-CommonPreserved $A $B)){return $false}
  if($A.objectName-eq'AcDbLine'){return(Test-Point $A.details.start $B.details.start)-and(Test-Point $A.details.end $B.details.end)}
  if($A.objectName-eq'AcDbArc'){return(Test-Point $A.details.center $B.details.center)-and(Test-Near $A.details.radius $B.details.radius)-and(Test-Near $A.details.startAngle $B.details.startAngle)-and(Test-Near $A.details.endAngle $B.details.endAngle)}
  if($A.objectName-eq'AcDbPolyline'){return(Test-PointSet $A.details.vertices $B.details.vertices)-and($A.details.closed-eq$B.details.closed)-and(Test-NumberSet $A.details.bulges $B.details.bulges)-and(Test-PointSet $A.details.widths $B.details.widths)}
  if($A.objectName-eq'AcDbEllipse'){return(Test-Point $A.details.center $B.details.center)-and(Test-Point $A.details.majorAxis $B.details.majorAxis)-and(Test-Near $A.details.ratio $B.details.ratio)-and(Test-Near $A.details.startParameter $B.details.startParameter)-and(Test-Near $A.details.endParameter $B.details.endParameter)}
  if($A.objectName-eq'AcDbSpline'){return($A.details.degree-eq$B.details.degree)-and(Test-PointSet $A.details.fitPoints $B.details.fitPoints)-and(Test-PointSet $A.details.controlPoints $B.details.controlPoints)-and(Test-NumberSet $A.details.knots $B.details.knots)-and(Test-NumberSet $A.details.weights $B.details.weights)}
  return $false
}
function Test-StateSetEqual { param($A,$B);if($null-eq$A-or$null-eq$B-or$A.Count-ne$B.Count){return $false};for($i=0;$i-lt$B.Count;$i++){if(-not(Test-StateEqual $A[$i] $B[$i])){return $false}};return $true }
function Test-LengthDelta { param($Before,$After,[double]$Delta);return(Test-CommonPreserved $Before $After)-and(Test-Near $After.details.length ($Before.details.length+$Delta) 0.00001) }

$acad=$null;$scratch=$null;$result=$null;$owned=$false;$ownedIdentity=$null;$automationProcessId=0;$stage='bootstrap'
$sourceDxfSha256=Get-FileSha256 $SourceDxfPath
$preExistingProcessIds=@(Get-Process -Name 'acad' -ErrorAction SilentlyContinue|ForEach-Object{[int]$_.Id})
try {
  $stage='create-owned-process';$acad=New-Object -ComObject AutoCAD.Application.24.3;[uint32]$acadPid=0;[void][F028WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry{$acad.HWND}),[ref]$acadPid);$automationProcessId=[int]$acadPid;$owned=$automationProcessId-gt0-and$preExistingProcessIds-notcontains$automationProcessId
  if(-not$owned){throw'F-028 refuses to use a pre-existing AutoCAD process.'};$ownedIdentity=Write-OwnedPidSidecar $automationProcessId;$installedUpdateIdentity=Get-InstalledAutoCadUpdateIdentity;Invoke-ComRetry{$acad.Visible=$true}|Out-Null
  $stage='open-blank';$initialCount=[int](Invoke-ComRetry{$acad.Documents.Count});if($initialCount-gt0){$candidate=Invoke-ComRetry{$acad.ActiveDocument};if([string](Invoke-ComRetry{$candidate.FullName})-or-not[bool](Invoke-ComRetry{$candidate.Saved})-or[int](Invoke-ComRetry{$candidate.ModelSpace.Count})-ne0){throw'F-028 refuses a non-blank initial document.'};$blank=$candidate}else{$blank=Invoke-ComRetry{$acad.Documents.Add()}};Invoke-ComRetry{$blank.Close($false)}|Out-Null;$scratch=Invoke-ComRetry{$acad.Documents.Open($SourceDxfPath)} -TimeoutSeconds 60;Invoke-ComRetry{$scratch.Activate()}|Out-Null;Wait-AcadIdle $scratch
  $layers=@('F028_DELTA','F028_PERCENT','F028_TOTAL','F028_DYNAMIC','F028_ANGLE','F028_COMMAND_UNDO','F028_LOCKED','F028_OFF','F028_FROZEN');foreach($name in $layers){Invoke-ComRetry{$scratch.Layers.Add($name)}|Out-Null}

  $stage='delta-five-families';$line=Invoke-NonNullCom{$scratch.HandleToObject('10')}'source line';$arc=Invoke-NonNullCom{$scratch.HandleToObject('20')}'source arc';$poly=Invoke-NonNullCom{$scratch.HandleToObject('30')}'source polyline';$ellipse=Invoke-NonNullCom{$scratch.HandleToObject('40')}'source ellipse';$spline=Invoke-NonNullCom{$scratch.HandleToObject('50')}'source control-point spline';foreach($entity in @($line,$arc,$poly,$ellipse,$spline)){Invoke-ComRetry{$entity.Layer='F028_DELTA'}|Out-Null}
  $deltaEntities=@($line,$arc,$poly,$ellipse,$spline);$deltaHandles=@('10','20','30','40','50');$deltaSource=@($deltaHandles|ForEach-Object{Get-StateByHandle $scratch $_})
  $deltaSelections=@(@{entity=$line;x=100;y=0},@{entity=$arc;x=0;y=400},@{entity=$poly;x=200;y=500})
  $stage='delta-command-multiple';$deltaCommandError=$null
  try{Invoke-Lengthen $scratch 'Delta' 25 $deltaSelections}catch{$deltaCommandError=$_}
  if($deltaCommandError){throw $deltaCommandError}
  $stage='delta-read-committed';$deltaCommitted=@($deltaHandles|ForEach-Object{Get-StateByHandle $scratch $_})
  $stage='delta-global-undo';Invoke-ComRetry{$scratch.SendCommand("_.UNDO`n1`n")}|Out-Null;Start-Sleep -Milliseconds 750;Wait-AcadIdle $scratch;$deltaUndone=@($deltaHandles|ForEach-Object{Get-StateByHandle $scratch $_})
  $stage='delta-global-redo';Invoke-ComRetry{$scratch.SendCommand("_.REDO`n")}|Out-Null;Start-Sleep -Milliseconds 750;Wait-AcadIdle $scratch;$deltaRedone=@($deltaHandles|ForEach-Object{Get-StateByHandle $scratch $_})

  $stage='ellipse-dynamic';$ellipseDynamicSource=Get-StateByHandle $scratch $deltaHandles[3];Invoke-LengthenDynamic $scratch $ellipse 400 350 358.385316345286 345.464871341284;$ellipseDynamicState=Get-StateByHandle $scratch $deltaHandles[3]
  $stage='control-spline-dynamic';$controlSplineDynamicSource=Get-StateByHandle $scratch $deltaHandles[4];Invoke-LengthenDynamic $scratch $spline 520 500 550 460;$controlSplineDynamicState=Get-StateByHandle $scratch $deltaHandles[4]

  $stage='percent';$percent=New-Line $scratch 'F028_PERCENT' 0 800 100 800;$percentHandle=[string](Invoke-ComRetry{$percent.Handle});Invoke-Lengthen $scratch 'Percent' 150 @(@{entity=$percent;x=100;y=800});$percentState=Get-StateByHandle $scratch $percentHandle
  $stage='total';$total=New-Line $scratch 'F028_TOTAL' 0 850 100 850;$totalHandle=[string](Invoke-ComRetry{$total.Handle});Invoke-Lengthen $scratch 'Total' 80 @(@{entity=$total;x=100;y=850});$totalState=Get-StateByHandle $scratch $totalHandle
  $stage='dynamic';$dynamic=New-Line $scratch 'F028_DYNAMIC' 0 900 100 900;$dynamicHandle=[string](Invoke-ComRetry{$dynamic.Handle});Invoke-LengthenDynamic $scratch $dynamic 100 900 150 950;$dynamicState=Get-StateByHandle $scratch $dynamicHandle
  $stage='angle';$angle=New-Arc $scratch 'F028_ANGLE' 0 1100 100 0 ([Math]::PI/2);$angleHandle=[string](Invoke-ComRetry{$angle.Handle});Invoke-Lengthen $scratch 'Total' 180 @(@{entity=$angle;x=0;y=1200}) 'Angle';$angleState=Get-StateByHandle $scratch $angleHandle

  $stage='command-undo';$undoFirst=New-Line $scratch 'F028_COMMAND_UNDO' 0 1200 100 1200;$undoSecond=New-Line $scratch 'F028_COMMAND_UNDO' 0 1250 100 1250;$undoHandles=@([string](Invoke-ComRetry{$undoFirst.Handle}),[string](Invoke-ComRetry{$undoSecond.Handle}));Invoke-Lengthen $scratch 'Delta' 10 @(@{entity=$undoFirst;x=100;y=1200},@{entity=$undoSecond;x=100;y=1250}) -UndoLast;$commandUndoStates=@($undoHandles|ForEach-Object{Get-StateByHandle $scratch $_})

  $stage='locked-off-frozen';$locked=New-Line $scratch 'F028_LOCKED' 0 1300 100 1300;$off=New-Line $scratch 'F028_OFF' 0 1350 100 1350;$frozen=New-Line $scratch 'F028_FROZEN' 0 1400 100 1400;$lockedHandle=[string](Invoke-ComRetry{$locked.Handle});$offHandle=[string](Invoke-ComRetry{$off.Handle});$frozenHandle=[string](Invoke-ComRetry{$frozen.Handle});$visibilitySource=@((Get-StateByHandle $scratch $lockedHandle),(Get-StateByHandle $scratch $offHandle),(Get-StateByHandle $scratch $frozenHandle));Invoke-ComRetry{(Invoke-ComRetry{$scratch.Layers.Item('F028_LOCKED')}).Lock=$true;(Invoke-ComRetry{$scratch.Layers.Item('F028_OFF')}).LayerOn=$false;(Invoke-ComRetry{$scratch.Layers.Item('F028_FROZEN')}).Freeze=$true}|Out-Null
  Invoke-Lengthen $scratch 'Delta' 10 @(@{entity=$locked;x=100;y=1300});Invoke-Lengthen $scratch 'Delta' 10 @(@{entity=$off;x=100;y=1350});Invoke-Lengthen $scratch 'Delta' 10 @(@{entity=$frozen;x=100;y=1400});$visibilityCommitted=@((Get-StateByHandle $scratch $lockedHandle),(Get-StateByHandle $scratch $offHandle),(Get-StateByHandle $scratch $frozenHandle))
  $visibilityBehavior=@('locked','off','frozen')|ForEach-Object{$index=@('locked','off','frozen').IndexOf($_);[ordered]@{state=$_;behavior=if(Test-StateEqual $visibilitySource[$index] $visibilityCommitted[$index]){'unchanged'}elseif(Test-Near $visibilityCommitted[$index].details.length ($visibilitySource[$index].details.length+10)){'changed'}else{'unexpected'}}}

  $checks=[ordered]@{
    lineDelta=(Test-LengthDelta $deltaSource[0] $deltaCommitted[0] 25)
    arcDelta=(Test-LengthDelta $deltaSource[1] $deltaCommitted[1] 25)
    polylineDelta=(Test-LengthDelta $deltaSource[2] $deltaCommitted[2] 25)
    lineArcPolylineDelta=($deltaSource.Count-eq5-and$deltaCommitted.Count-eq5-and@(0..2|Where-Object{-not(Test-LengthDelta $deltaSource[$_] $deltaCommitted[$_] 25)}).Count-eq0)
    ellipseExcludedFromNumericMatrix=(Test-ExactJson $deltaSource[3] $deltaCommitted[3])
    ellipseDynamicChanged=((Test-CommonPreserved $ellipseDynamicSource $ellipseDynamicState)-and-not(Test-StateEqual $ellipseDynamicSource.details $ellipseDynamicState.details))
    splineExcludedFromNumericMatrix=(Test-ExactJson $deltaSource[4] $deltaCommitted[4])
    controlSplineDynamicRefused=(Test-ExactJson $controlSplineDynamicSource $controlSplineDynamicState)
    deltaFixedEndpoint=(Test-Point $deltaCommitted[0].details.start @(0,0))-and(Test-Point $deltaCommitted[0].details.end @(125,0))
    percent150=Test-Near $percentState.details.length 150
    total80=Test-Near $totalState.details.length 80
    dynamicEndpoint=Test-Point $dynamicState.details.end @(150,900)
    totalAngle180=(Test-Near $angleState.details.startAngle 0)-and(Test-Near $angleState.details.endAngle ([Math]::PI))
    commandLocalUndo=(Test-Near $commandUndoStates[0].details.length 110)-and(Test-Near $commandUndoStates[1].details.length 100)
    atomicUndo=(Test-ExactJson $deltaSource $deltaUndone)
    atomicRedo=(Test-ExactJson $deltaCommitted $deltaRedone)
    lockedRefused=($visibilityBehavior[0].behavior-eq'unchanged')
    offAndFrozenBehaviorMeasured=($visibilityBehavior[1].behavior-ne'unexpected'-and$visibilityBehavior[2].behavior-ne'unexpected')
  }
  $stage='save-dxf';Invoke-ComRetry{$scratch.Regen(1);$scratch.SaveAs($DxfOutputPath,65)} -TimeoutSeconds 90|Out-Null;Wait-AcadIdle $scratch
  $finalStates=@();foreach($layer in $layers){$finalStates+=@(Get-LayerStates $scratch $layer)}
  $result=[ordered]@{schemaVersion=1;rowId='F-028';benchmark='AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation';engine='Autodesk AutoCAD 2024 desktop COM';engineVersion=[string](Invoke-ComRetry{$acad.Version});automationProcessId=$automationProcessId;automationProcessOwned=$owned;installedUpdateIdentity=$installedUpdateIdentity;automationProcessIdentity=[ordered]@{processId=$ownedIdentity.processId;executableName=$ownedIdentity.executableName;executableSha256=$ownedIdentity.executableSha256;fileVersion=$ownedIdentity.fileVersion;productVersion=$ownedIdentity.productVersion;startTimeSha256=$ownedIdentity.startTimeSha256};sourceDxfSha256=$sourceDxfSha256;observations=[ordered]@{delta=[ordered]@{source=$deltaSource;committed=$deltaCommitted;undone=$deltaUndone;redone=$deltaRedone};ellipseDynamic=[ordered]@{source=$ellipseDynamicSource;committed=$ellipseDynamicState};controlSplineDynamic=[ordered]@{source=$controlSplineDynamicSource;committed=$controlSplineDynamicState};percent=$percentState;total=$totalState;dynamic=$dynamicState;angle=$angleState;commandUndo=$commandUndoStates;visibility=[ordered]@{source=$visibilitySource;committed=$visibilityCommitted;behavior=$visibilityBehavior}};finalStates=$finalStates;checks=$checks;dxfOutputSha256=Get-FileSha256 $DxfOutputPath;cmdNamesAfter=[string](Invoke-ComRetry{$scratch.GetVariable('CMDNAMES')});userDocument=[ordered]@{isolatedOwnedProcess=$owned;blankRestored=$true;sourceDocumentSynthetic=$true};status=if(@($checks.Values|Where-Object{$_-ne$true}).Count-eq0){'PASS'}else{'FAIL'}}
} catch { throw "F-028 AutoCAD stage '$stage' failed at script line $($_.InvocationInfo.ScriptLineNumber): $($_.Exception.Message)" }
finally {
  if($acad-and-not$owned){try{[uint32]$finallyProcessId=0;[void][F028WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry{$acad.HWND}),[ref]$finallyProcessId);if([int]$finallyProcessId-gt0-and$preExistingProcessIds-notcontains[int]$finallyProcessId){$automationProcessId=[int]$finallyProcessId;$ownedIdentity=Write-OwnedPidSidecar $automationProcessId;$owned=$true}}catch{}}
  if($scratch){try{Invoke-ComRetry{$scratch.Close($false)} -TimeoutSeconds 10|Out-Null}catch{}}
  if($owned-and$acad){try{Invoke-ComRetry{$acad.Quit()} -TimeoutSeconds 10|Out-Null}catch{}}
}
if(-not$result){throw'F-028 AutoCAD matrix produced no result.'};$result|ConvertTo-Json -Depth 16;if($result.status-ne'PASS'){exit 1}
