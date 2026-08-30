param(
  [Parameter(Mandatory = $true)][string]$PidPath,
  [Parameter(Mandatory = $true)][string]$OwnershipToken,
  [Parameter(Mandatory = $true)][string]$DxfOutputPath,
  [Parameter(Mandatory = $true)][string]$EscapeHelperPath
)

$ErrorActionPreference = 'Stop'
$DxfOutputPath = [IO.Path]::GetFullPath($DxfOutputPath)
$EscapeHelperPath = [IO.Path]::GetFullPath($EscapeHelperPath)
if ([IO.Path]::GetExtension($DxfOutputPath) -ine '.dxf' -or (Test-Path -LiteralPath $DxfOutputPath)) { throw 'F-027 DXF output must be a new .dxf path.' }
if (-not (Test-Path -LiteralPath $EscapeHelperPath -PathType Leaf)) { throw 'F-027 Escape helper is missing.' }

$interopCommonPath = 'C:\Program Files\Autodesk\AutoCAD 2024\Autodesk.AutoCAD.Interop.Common.dll'
if (-not (Test-Path -LiteralPath $interopCommonPath)) { throw "F-027 requires $interopCommonPath" }
Add-Type -Path $interopCommonPath
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class F027WindowProcess {
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
  throw "F-027 AutoCAD did not return idle. CMDNAMES='$($Document.GetVariable('CMDNAMES'))' LASTPROMPT='$($Document.GetVariable('LASTPROMPT'))'"
}
function Wait-AcadMarker {
  param($Document, [string]$Marker, [int]$TimeoutSeconds = 45)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 100
    try { if ([string]$Document.GetVariable('USERS1') -eq $Marker) { Wait-AcadIdle $Document $TimeoutSeconds; return } } catch {}
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "F-027 marker $Marker timed out. CMDNAMES='$($Document.GetVariable('CMDNAMES'))' LASTPROMPT='$($Document.GetVariable('LASTPROMPT'))'"
}
function Get-StringSha256 { param([string]$Value); $hash=[Security.Cryptography.SHA256]::Create(); try { return ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value))).Replace('-','').ToLowerInvariant()) } finally { $hash.Dispose() } }
function Get-FileSha256 { param([string]$Path); $hash=[Security.Cryptography.SHA256]::Create(); $stream=[IO.File]::OpenRead($Path); try { return ([BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-','').ToLowerInvariant()) } finally { $stream.Dispose();$hash.Dispose() } }
function Get-OwnedAcadIdentity {
  param([int]$ProcessId)
  $process=Get-Process -Id $ProcessId -ErrorAction Stop; $path=[IO.Path]::GetFullPath([string]$process.Path)
  if ([IO.Path]::GetFileName($path) -ine 'acad.exe') { throw "F-027 PID $ProcessId is not acad.exe." }
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
function Get-EntityState {
  param($Entity)
  $name=[string](Invoke-ComRetry{$Entity.ObjectName});$details=[ordered]@{}
  if($name-eq'AcDbLine'){$details.start=Get-Point2(Invoke-NonNullCom{$Entity.StartPoint}'line start');$details.end=Get-Point2(Invoke-NonNullCom{$Entity.EndPoint}'line end')}
  elseif($name-eq'AcDbPolyline'){
    $flat=@(Invoke-NonNullCom{$Entity.Coordinates}'polyline coordinates');$vertices=@();for($i=0;$i+1-lt$flat.Count;$i+=2){$vertices+=,@([double]$flat[$i],[double]$flat[$i+1])}
    $details.vertices=$vertices;$details.closed=[bool](Invoke-ComRetry{$Entity.Closed});$details.bulges=@();$details.widths=@();for($i=0;$i-lt$vertices.Count;$i+=1){$details.bulges+=[double](Invoke-ComRetry{$Entity.GetBulge($i)});[double]$sw=0;[double]$ew=0;Invoke-ComRetry{$Entity.GetWidth($i,[ref]$sw,[ref]$ew)}|Out-Null;$details.widths+=,@($sw,$ew)}
  }
  elseif($name-eq'AcDbCircle'){$details.center=Get-Point2(Invoke-NonNullCom{$Entity.Center}'circle center');$details.radius=[double](Invoke-ComRetry{$Entity.Radius})}
  elseif($name-eq'AcDbArc'){$details.center=Get-Point2(Invoke-NonNullCom{$Entity.Center}'arc center');$details.radius=[double](Invoke-ComRetry{$Entity.Radius});$details.startAngle=[double](Invoke-ComRetry{$Entity.StartAngle});$details.endAngle=[double](Invoke-ComRetry{$Entity.EndAngle})}
  elseif($name-eq'AcDbEllipse'){$details.center=Get-Point2(Invoke-NonNullCom{$Entity.Center}'ellipse center');$details.majorAxis=Get-Point2(Invoke-NonNullCom{$Entity.MajorAxis}'ellipse major');$details.ratio=[double](Invoke-ComRetry{$Entity.RadiusRatio});$details.startParameter=[double](Invoke-ComRetry{$Entity.StartParameter});$details.endParameter=[double](Invoke-ComRetry{$Entity.EndParameter})}
  else{$details.unsupported=$true}
  return [ordered]@{objectName=$name;handle=[string](Invoke-ComRetry{$Entity.Handle});layer=[string](Invoke-ComRetry{$Entity.Layer});color=[int](Invoke-ComRetry{$Entity.Color});lineweight=[int](Invoke-ComRetry{$Entity.Lineweight});linetype=[string](Invoke-ComRetry{$Entity.Linetype});details=$details}
}
function Get-StateByHandle { param($Document,[string]$Handle); return Get-EntityState(Invoke-NonNullCom{$Document.HandleToObject($Handle)}"entity $Handle") }
function Get-LayerStates {
  param($Document,[string]$Layer)
  $result=@();$count=[int](Invoke-ComRetry{$Document.ModelSpace.Count});for($i=0;$i-lt$count;$i+=1){$entity=Invoke-ComRetry{$Document.ModelSpace.Item($i)};if([string](Invoke-ComRetry{$entity.Layer})-eq$Layer){$result+=Get-StateByHandle $Document ([string](Invoke-ComRetry{$entity.Handle}))}}
  return @($result|Sort-Object handle)
}
function Set-Common { param($Entity,[string]$Layer);Invoke-ComRetry{$Entity.Layer=$Layer;$Entity.Color=1;$Entity.Lineweight=50}|Out-Null;return $Entity }
function New-Line { param($Document,[string]$Layer,[double]$X1,[double]$Y1,[double]$X2,[double]$Y2);[double[]]$a=@($X1,$Y1,0);[double[]]$b=@($X2,$Y2,0);return Set-Common (Invoke-ComRetry{$Document.ModelSpace.AddLine($a,$b)}) $Layer }
function New-Polyline { param($Document,[string]$Layer,[double[]]$Coordinates);$entity=Set-Common(Invoke-ComRetry{$Document.ModelSpace.AddLightWeightPolyline($Coordinates)})$Layer;return $entity }
function New-Circle { param($Document,[string]$Layer,[double]$X,[double]$Y,[double]$Radius);[double[]]$center=@($X,$Y,0);return Set-Common(Invoke-ComRetry{$Document.ModelSpace.AddCircle($center,$Radius)})$Layer }
function New-Arc { param($Document,[string]$Layer,[double]$X,[double]$Y,[double]$Radius,[double]$Start,[double]$End);[double[]]$center=@($X,$Y,0);return Set-Common(Invoke-ComRetry{$Document.ModelSpace.AddArc($center,$Radius,$Start,$End)})$Layer }
function New-Ellipse { param($Document,[string]$Layer,[double]$X,[double]$Y,[double]$MajorX,[double]$MajorY,[double]$Ratio,[double]$Start,[double]$End);[double[]]$center=@($X,$Y,0);[double[]]$major=@($MajorX,$MajorY,0);$entity=Set-Common(Invoke-ComRetry{$Document.ModelSpace.AddEllipse($center,$major,$Ratio)})$Layer;Invoke-ComRetry{$entity.StartParameter=$Start;$entity.EndParameter=$End}|Out-Null;return $entity }
function Invoke-StretchWindow {
  param($Document,$Entity,[double]$X1,[double]$Y1,[double]$X2,[double]$Y2,[double]$Dx=25,[double]$Dy=5,$ViewBounds=$null)
  $handle=[string](Invoke-ComRetry{$Entity.Handle});$marker=[Guid]::NewGuid().ToString('N')
  $zoom=if($null-ne$ViewBounds-and$ViewBounds.Count-eq4){"(command `"_.ZOOM`" `"_Window`" $(Format-Point $ViewBounds[0] $ViewBounds[1]) $(Format-Point $ViewBounds[2] $ViewBounds[3]))"}else{"(command `"_.ZOOM`" `"_Object`" (handent `"$handle`") `"`")"}
  $body="(command `"_.STRETCH`" `"_Crossing`" $(Format-Point $X1 $Y1) $(Format-Point $X2 $Y2) `"`" $(Format-Point 0 0) $(Format-Point $Dx $Dy))"
  $lisp="(progn (setvar `"USERS1`" `"`") $zoom $body (setvar `"USERS1`" `"$marker`") (princ))`n";Invoke-ComRetry{$Document.SendCommand($lisp)}|Out-Null;Wait-AcadMarker $Document $marker;Invoke-ComRetry{$Document.Regen(1)}|Out-Null
}
function Invoke-StretchPolygon {
  param($Document,$Entity,$Points,[double]$Dx=25,[double]$Dy=5)
  $handle=[string](Invoke-ComRetry{$Entity.Handle});$marker=[Guid]::NewGuid().ToString('N');$pointArgs=($Points|ForEach-Object{Format-Point $_[0] $_[1]})-join' '
  $lisp="(progn (setvar `"USERS1`" `"`") (command `"_.ZOOM`" `"_Object`" (handent `"$handle`") `"`") (command `"_.STRETCH`" `"_CPolygon`" $pointArgs `"`" `"`" $(Format-Point 0 0) $(Format-Point $Dx $Dy)) (setvar `"USERS1`" `"$marker`") (princ))`n";Invoke-ComRetry{$Document.SendCommand($lisp)}|Out-Null;Wait-AcadMarker $Document $marker;Invoke-ComRetry{$Document.Regen(1)}|Out-Null
}
function Invoke-StretchIndividual {
  param($Document,$Entity,[double]$Dx=25,[double]$Dy=5)
  $handle=[string](Invoke-ComRetry{$Entity.Handle});$marker=[Guid]::NewGuid().ToString('N');$lisp="(progn (setvar `"USERS1`" `"`") (setq f027set (ssadd (handent `"$handle`"))) (command `"_.STRETCH`" f027set `"`" $(Format-Point 0 0) $(Format-Point $Dx $Dy)) (setvar `"USERS1`" `"$marker`") (princ))`n";Invoke-ComRetry{$Document.SendCommand($lisp)}|Out-Null;Wait-AcadMarker $Document $marker;Invoke-ComRetry{$Document.Regen(1)}|Out-Null
}
function Invoke-RejectedStretch {
  param($Document,[int]$ProcessId,$Entity,[double]$X1,[double]$Y1,[double]$X2,[double]$Y2)
  $handle=[string](Invoke-ComRetry{$Entity.Handle})
  $body="(command `"_.STRETCH`" `"_Crossing`" $(Format-Point $X1 $Y1) $(Format-Point $X2 $Y2) `"`" $(Format-Point 0 0) $(Format-Point 25 5))"
  $helpers=@()
  try {
    foreach($delay in @(1000,3000)){
      $helpers+=Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$EscapeHelperPath,'-TargetProcessId',([string]$ProcessId),'-DelayMs',([string]$delay)) -WindowStyle Hidden -PassThru
    }
    Invoke-ComRetry{$Document.SendCommand("(progn (command `"_.ZOOM`" `"_Object`" (handent `"$handle`") `"`") $body (princ))`n")}|Out-Null
    foreach($helper in $helpers){
      if(-not$helper.WaitForExit(15000)){throw 'F-027 Escape watchdog timed out.'}
      if($helper.ExitCode-ne0){throw "F-027 Escape watchdog exited $($helper.ExitCode)."}
    }
  } finally {
    foreach($helper in $helpers){if(-not$helper.HasExited){$helper.Kill();$helper.WaitForExit()}}
  }
  Wait-AcadIdle $Document
  Invoke-ComRetry{$Document.Regen(1)}|Out-Null
  Start-Sleep -Milliseconds 250
}
function Test-Near { param([double]$A,[double]$B,[double]$Tolerance=0.000000001);return [Math]::Abs($A-$B)-le$Tolerance }
function Test-Point { param($A,$B);return $A.Count-ge2-and(Test-Near $A[0] $B[0])-and(Test-Near $A[1] $B[1]) }
function Test-Common { param($State,[string]$Type,[string]$Layer,[string]$Handle);return $State.objectName-eq$Type-and$State.layer-eq$Layer-and$State.handle-eq$Handle-and$State.color-eq1-and$State.lineweight-eq50-and$State.linetype-eq'ByLayer' }
function Test-LineState { param($State,[string]$Layer,[string]$Handle,$Start,$End);return(Test-Common $State 'AcDbLine' $Layer $Handle)-and(Test-Point $State.details.start $Start)-and(Test-Point $State.details.end $End) }
function Test-PointSet {
  param($Actual,$Expected)
  if($null-eq$Actual-or$null-eq$Expected-or$Actual.Count-ne$Expected.Count){return $false}
  for($i=0;$i-lt$Expected.Count;$i+=1){if(-not(Test-Point $Actual[$i] $Expected[$i])){return $false}}
  return $true
}
function Test-NumberSet {
  param($Actual,$Expected)
  if($null-eq$Actual-or$null-eq$Expected-or$Actual.Count-ne$Expected.Count){return $false}
  for($i=0;$i-lt$Expected.Count;$i+=1){if(-not(Test-Near $Actual[$i] $Expected[$i])){return $false}}
  return $true
}
function Test-PolylineState {
  param($State,[string]$Layer,[string]$Handle,$Vertices,[bool]$Closed,$Bulges,$Widths)
  return (Test-Common $State 'AcDbPolyline' $Layer $Handle)-and
    ([bool]$State.details.closed-eq$Closed)-and
    (Test-PointSet $State.details.vertices $Vertices)-and
    (Test-NumberSet $State.details.bulges $Bulges)-and
    (Test-PointSet $State.details.widths $Widths)
}
function Test-ArcState {
  param($State,[string]$Layer,[string]$Handle,$Center,[double]$Radius,[double]$Start,[double]$End)
  return (Test-Common $State 'AcDbArc' $Layer $Handle)-and(Test-Point $State.details.center $Center)-and
    (Test-Near $State.details.radius $Radius)-and(Test-Near $State.details.startAngle $Start)-and(Test-Near $State.details.endAngle $End)
}
function Test-CircleState {
  param($State,[string]$Layer,[string]$Handle,$Center,[double]$Radius)
  return (Test-Common $State 'AcDbCircle' $Layer $Handle)-and(Test-Point $State.details.center $Center)-and(Test-Near $State.details.radius $Radius)
}
function Test-EllipseState {
  param($State,[string]$Layer,[string]$Handle,$Center,$Major,[double]$Ratio,[double]$Start,[double]$End)
  return (Test-Common $State 'AcDbEllipse' $Layer $Handle)-and(Test-Point $State.details.center $Center)-and
    (Test-Point $State.details.majorAxis $Major)-and(Test-Near $State.details.ratio $Ratio)-and
    (Test-Near $State.details.startParameter $Start)-and(Test-Near $State.details.endParameter $End)
}
function Test-StateSetExact { param($First,$Second);return(($First|ConvertTo-Json -Depth 12 -Compress)-eq($Second|ConvertTo-Json -Depth 12 -Compress)) }

$acad=$null;$scratch=$null;$result=$null;$automationProcessId=0;$owned=$false;$ownedIdentity=$null;$stage='startup'
$preExistingProcessIds=@(Get-Process -Name acad -ErrorAction SilentlyContinue|ForEach-Object{[int]$_.Id})
try {
  $stage='create-owned-application'
  $acad=New-Object -ComObject AutoCAD.Application.24.3
  [uint32]$resolvedProcessId=0;[void][F027WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry{$acad.HWND}),[ref]$resolvedProcessId);$automationProcessId=[int]$resolvedProcessId
  $owned=$automationProcessId-gt0-and$preExistingProcessIds-notcontains$automationProcessId;if(-not$owned){throw'F-027 refuses to use a pre-existing AutoCAD process.'}
  $ownedIdentity=Write-OwnedPidSidecar $automationProcessId;$installedUpdateIdentity=Get-InstalledAutoCadUpdateIdentity;Invoke-ComRetry{$acad.Visible=$true}|Out-Null
  $stage='validate-scratch-document'
  if([int](Invoke-ComRetry{$acad.Documents.Count})-gt0){$candidate=Invoke-ComRetry{$acad.ActiveDocument};if([string](Invoke-ComRetry{$candidate.FullName})-or[int](Invoke-ComRetry{$candidate.ModelSpace.Count})-ne0){throw'F-027 refuses a saved or nonblank automation document.'};$scratch=$candidate}else{$scratch=Invoke-ComRetry{$acad.Documents.Add()}}
  Invoke-ComRetry{$scratch.Activate();$scratch.SetVariable('CMDECHO',0);$scratch.SetVariable('FILEDIA',0)}|Out-Null;Wait-AcadIdle $scratch
  $stage='create-layers';$layers=@('F027_LINE','F027_CPOLY','F027_POLY','F027_ARC','F027_ARC_CENTER','F027_ELLIPSE','F027_WRAP','F027_ELLIPSE_MID','F027_FULL','F027_CIRCLE','F027_INDIVIDUAL','F027_GLOBAL','F027_LOCKED');foreach($name in $layers){Invoke-ComRetry{$scratch.Layers.Add($name)}|Out-Null}

  $sourceStates=[ordered]@{}
  $stage='crossing-window-line';$line=New-Line $scratch 'F027_LINE' 0 0 100 0;$lineHandle=[string](Invoke-ComRetry{$line.Handle});$sourceStates.line=Get-StateByHandle $scratch $lineHandle;Invoke-StretchWindow $scratch $line 90 -10 110 10
  $stage='crossing-polygon-line';$cp=New-Line $scratch 'F027_CPOLY' 0 100 100 100;$cpHandle=[string](Invoke-ComRetry{$cp.Handle});$sourceStates.crossingPolygon=Get-StateByHandle $scratch $cpHandle;Invoke-StretchPolygon $scratch $cp @(@(90,90),@(110,90),@(110,110),@(90,110))
  $stage='polyline-vertex';$poly=New-Polyline $scratch 'F027_POLY' ([double[]]@(0,200,100,200,200,200));Invoke-ComRetry{$poly.SetBulge(0,0.5);$poly.SetBulge(1,-0.25);$poly.SetWidth(0,2,4);$poly.SetWidth(1,4,6)}|Out-Null;$polyHandle=[string](Invoke-ComRetry{$poly.Handle});$sourceStates.polyline=Get-StateByHandle $scratch $polyHandle;Invoke-StretchWindow $scratch $poly 90 190 110 210
  $stage='arc-endpoint';$arc=New-Arc $scratch 'F027_ARC' 300 300 100 0 ([Math]::PI);$arcHandle=[string](Invoke-ComRetry{$arc.Handle});$sourceStates.arc=Get-StateByHandle $scratch $arcHandle;Invoke-StretchWindow $scratch $arc 390 290 410 310
  $stage='arc-center-noop';$arcCenter=New-Arc $scratch 'F027_ARC_CENTER' 600 300 100 0 ([Math]::PI);$arcCenterHandle=[string](Invoke-ComRetry{$arcCenter.Handle});$sourceStates.arcCenter=Get-StateByHandle $scratch $arcCenterHandle;Invoke-StretchWindow $scratch $arcCenter 590 290 610 410
  $stage='quarter-ellipse';$ellipse=New-Ellipse $scratch 'F027_ELLIPSE' 900 300 100 0 0.5 0 ([Math]::PI/2);$ellipseHandle=[string](Invoke-ComRetry{$ellipse.Handle});$sourceStates.ellipse=Get-StateByHandle $scratch $ellipseHandle;Invoke-StretchWindow $scratch $ellipse 990 290 1010 310
  $stage='wrapped-ellipse';$wrapped=New-Ellipse $scratch 'F027_WRAP' 1200 300 100 0 0.5 5.5 7;$wrappedHandle=[string](Invoke-ComRetry{$wrapped.Handle});$sourceStates.wrapped=Get-StateByHandle $scratch $wrappedHandle;Invoke-StretchWindow $scratch $wrapped 1265 320 1285 345
  $stage='ellipse-midpoint-noop';$ellipseMid=New-Ellipse $scratch 'F027_ELLIPSE_MID' 1500 300 100 0 0.5 0 ([Math]::PI/2);$ellipseMidHandle=[string](Invoke-ComRetry{$ellipseMid.Handle});$sourceStates.ellipseMidpoint=Get-StateByHandle $scratch $ellipseMidHandle;Invoke-StretchWindow $scratch $ellipseMid 1560 325 1580 345
  $stage='full-ellipse-center';$full=New-Ellipse $scratch 'F027_FULL' 1800 300 100 0 0.5 0 (2*[Math]::PI);$fullHandle=[string](Invoke-ComRetry{$full.Handle});$sourceStates.fullEllipse=Get-StateByHandle $scratch $fullHandle;Invoke-StretchWindow $scratch $full 1790 290 1910 310
  $stage='circle-center';$circle=New-Circle $scratch 'F027_CIRCLE' 2100 300 100;$circleHandle=[string](Invoke-ComRetry{$circle.Handle});$sourceStates.circle=Get-StateByHandle $scratch $circleHandle;Invoke-StretchWindow $scratch $circle 2090 290 2210 310
  $stage='individual-whole-move';$individual=New-Line $scratch 'F027_INDIVIDUAL' 0 500 100 500;$individualHandle=[string](Invoke-ComRetry{$individual.Handle});$sourceStates.individual=Get-StateByHandle $scratch $individualHandle;Invoke-StretchIndividual $scratch $individual

  $stage='atomic-undo-redo';$g1=New-Line $scratch 'F027_GLOBAL' 0 600 100 600;$g1Handle=[string](Invoke-ComRetry{$g1.Handle});$g2=New-Line $scratch 'F027_GLOBAL' 0 650 100 650;$g2Handle=[string](Invoke-ComRetry{$g2.Handle});$globalSource=@(Get-LayerStates $scratch 'F027_GLOBAL');Invoke-ComRetry{$scratch.StartUndoMark()}|Out-Null;try{Invoke-StretchWindow $scratch $g1 90 590 110 660 -ViewBounds @(-50,550,150,700)}finally{Invoke-ComRetry{$scratch.EndUndoMark()}|Out-Null};$globalCommitted=@(Get-LayerStates $scratch 'F027_GLOBAL');Invoke-ComRetry{$scratch.SendCommand("_.UNDO`n1`n")}|Out-Null;Start-Sleep -Milliseconds 750;Wait-AcadIdle $scratch;$globalUndone=@(Get-LayerStates $scratch 'F027_GLOBAL');Invoke-ComRetry{$scratch.SendCommand("_.REDO`n")}|Out-Null;Start-Sleep -Milliseconds 750;Wait-AcadIdle $scratch;$globalRedone=@(Get-LayerStates $scratch 'F027_GLOBAL')
  $stage='locked-layer-noop';$locked=New-Line $scratch 'F027_LOCKED' 0 750 100 750;$lockedHandle=[string](Invoke-ComRetry{$locked.Handle});$sourceStates.locked=Get-StateByHandle $scratch $lockedHandle;$lockedLayer=Invoke-ComRetry{$scratch.Layers.Item('F027_LOCKED')};Invoke-ComRetry{$lockedLayer.Lock=$true}|Out-Null;Invoke-RejectedStretch $scratch $automationProcessId $locked 90 740 110 760;Invoke-ComRetry{$lockedLayer.Lock=$false}|Out-Null

  $stage='readback-and-assertions'
  $observations=[ordered]@{
    source=$sourceStates;line=Get-StateByHandle $scratch $lineHandle;crossingPolygon=Get-StateByHandle $scratch $cpHandle;polyline=Get-StateByHandle $scratch $polyHandle;arc=Get-StateByHandle $scratch $arcHandle;arcCenter=Get-StateByHandle $scratch $arcCenterHandle;ellipse=Get-StateByHandle $scratch $ellipseHandle;wrapped=Get-StateByHandle $scratch $wrappedHandle;ellipseMidpoint=Get-StateByHandle $scratch $ellipseMidHandle;fullEllipse=Get-StateByHandle $scratch $fullHandle;circle=Get-StateByHandle $scratch $circleHandle;individual=Get-StateByHandle $scratch $individualHandle;globalUndoRedo=[ordered]@{source=$globalSource;committed=$globalCommitted;undone=$globalUndone;redone=$globalRedone};locked=Get-StateByHandle $scratch $lockedHandle
  }
  $checks=[ordered]@{
    sourceStatesExact=(
      (Test-LineState $observations.source.line 'F027_LINE' $lineHandle @(0,0) @(100,0))-and
      (Test-LineState $observations.source.crossingPolygon 'F027_CPOLY' $cpHandle @(0,100) @(100,100))-and
      (Test-PolylineState $observations.source.polyline 'F027_POLY' $polyHandle @(@(0,200),@(100,200),@(200,200)) $false @(0.5,-0.25,0) @(@(2,4),@(4,6),@(0,0)))-and
      (Test-ArcState $observations.source.arc 'F027_ARC' $arcHandle @(300,300) 100 0 ([Math]::PI))-and
      (Test-ArcState $observations.source.arcCenter 'F027_ARC_CENTER' $arcCenterHandle @(600,300) 100 0 ([Math]::PI))-and
      (Test-EllipseState $observations.source.ellipse 'F027_ELLIPSE' $ellipseHandle @(900,300) @(100,0) 0.5 0 ([Math]::PI/2))-and
      (Test-EllipseState $observations.source.wrapped 'F027_WRAP' $wrappedHandle @(1200,300) @(100,0) 0.5 5.5 7)-and
      (Test-EllipseState $observations.source.ellipseMidpoint 'F027_ELLIPSE_MID' $ellipseMidHandle @(1500,300) @(100,0) 0.5 0 ([Math]::PI/2))-and
      (Test-EllipseState $observations.source.fullEllipse 'F027_FULL' $fullHandle @(1800,300) @(100,0) 0.5 0 (2*[Math]::PI))-and
      (Test-CircleState $observations.source.circle 'F027_CIRCLE' $circleHandle @(2100,300) 100)-and
      (Test-LineState $observations.source.individual 'F027_INDIVIDUAL' $individualHandle @(0,500) @(100,500))-and
      (Test-LineState $observations.source.locked 'F027_LOCKED' $lockedHandle @(0,750) @(100,750))
    )
    crossingWindowEndpoint=Test-LineState $observations.line 'F027_LINE' $lineHandle @(0,0) @(125,5)
    crossingPolygonEndpoint=Test-LineState $observations.crossingPolygon 'F027_CPOLY' $cpHandle @(0,100) @(125,105)
    polylineVertexAndProperties=Test-PolylineState $observations.polyline 'F027_POLY' $polyHandle @(@(0,200),@(125,205),@(200,200)) $false @(0.39968038348871576,-0.33259505261886968,0) @(@(2,4),@(4,6),@(0,0))
    arcEndpoint=Test-ArcState $observations.arc 'F027_ARC' $arcHandle @(312.7957603151085,289.1907858201167) 113.3125 0.139975357410291 3.04605442683294
    arcCenterNotStretchPoint=(Test-StateSetExact $observations.source.arcCenter $observations.arcCenter)
    quarterEllipse=Test-EllipseState $observations.ellipse 'F027_ELLIPSE' $ellipseHandle @(909.852004872791,298.9222357577537) @(115.564843901568,2.120881991279924) 0.444723039979619 0.077190120252004 1.647986447046899
    wrappedEllipse=Test-EllipseState $observations.wrapped 'F027_WRAP' $wrappedHandle @(1216.321187837475,324.7416264179425) @(-95.68145757452969,29.35210104127352) 0.576564048333548 2.341890538582327 3.841890538582323
    ellipseMidpointNoChange=(Test-StateSetExact $observations.source.ellipseMidpoint $observations.ellipseMidpoint)
    fullEllipseCenterMovesWhole=Test-EllipseState $observations.fullEllipse 'F027_FULL' $fullHandle @(1825,305) @(100,0) 0.5 0 (2*[Math]::PI)
    circleCenterMovesWhole=Test-CircleState $observations.circle 'F027_CIRCLE' $circleHandle @(2125,305) 100
    individualMovesWhole=Test-LineState $observations.individual 'F027_INDIVIDUAL' $individualHandle @(25,505) @(125,505)
    atomicUndoRedo=(
      (Test-StateSetExact $globalSource $globalUndone) -and
      (Test-StateSetExact $globalCommitted $globalRedone) -and
      ($globalCommitted.Count-eq2) -and
      (Test-LineState ($globalCommitted|Where-Object{$_.handle-eq$g1Handle}|Select-Object -First 1) 'F027_GLOBAL' $g1Handle @(0,600) @(125,605)) -and
      (Test-LineState ($globalCommitted|Where-Object{$_.handle-eq$g2Handle}|Select-Object -First 1) 'F027_GLOBAL' $g2Handle @(0,650) @(125,655))
    )
    lockedLayerNoChange=(Test-StateSetExact $observations.source.locked $observations.locked)
    handlesAndPropertiesPreserved=(
      @(@(
        $observations.line,
        $observations.crossingPolygon,
        $observations.polyline,
        $observations.arc,
        $observations.arcCenter,
        $observations.ellipse,
        $observations.wrapped,
        $observations.ellipseMidpoint,
        $observations.fullEllipse,
        $observations.circle,
        $observations.individual,
        $observations.globalUndoRedo.committed[0],
        $observations.globalUndoRedo.committed[1],
        $observations.locked
      ) | Where-Object {
        $_.handle -and $_.layer -and $_.objectName -and $_.color -eq 1 -and $_.lineweight -eq 50 -and $_.linetype -eq 'ByLayer'
      }).Count -eq 14
    )
  }
  $stage='save-dxf';Invoke-ComRetry{$scratch.Regen(1);$scratch.SaveAs($DxfOutputPath,65)} -TimeoutSeconds 90|Out-Null;Wait-AcadIdle $scratch
  $stage='build-report'
  $result=[ordered]@{schemaVersion=1;rowId='F-027';benchmark='AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation';engine='Autodesk AutoCAD 2024 desktop COM';engineVersion=[string](Invoke-ComRetry{$acad.Version});automationProcessId=$automationProcessId;automationProcessOwned=$owned;installedUpdateIdentity=$installedUpdateIdentity;automationProcessIdentity=[ordered]@{processId=$ownedIdentity.processId;executableName=$ownedIdentity.executableName;executableSha256=$ownedIdentity.executableSha256;fileVersion=$ownedIdentity.fileVersion;productVersion=$ownedIdentity.productVersion;startTimeSha256=$ownedIdentity.startTimeSha256};observations=$observations;checks=$checks;dxfOutputSha256=Get-FileSha256 $DxfOutputPath;cmdNamesAfter=[string](Invoke-ComRetry{$scratch.GetVariable('CMDNAMES')});userDocument=[ordered]@{isolatedOwnedProcess=$owned;blankRestored=$true};status=if(@($checks.Values|Where-Object{$_-ne$true}).Count-eq0){'PASS'}else{'FAIL'}}
} catch {
  throw "F-027 AutoCAD stage '$stage' failed at script line $($_.InvocationInfo.ScriptLineNumber): $($_.Exception.Message)"
} finally {
  if($acad-and-not$owned){try{[uint32]$finallyProcessId=0;[void][F027WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry{$acad.HWND}),[ref]$finallyProcessId);if([int]$finallyProcessId-gt0-and$preExistingProcessIds-notcontains[int]$finallyProcessId){$automationProcessId=[int]$finallyProcessId;$ownedIdentity=Write-OwnedPidSidecar $automationProcessId;$owned=$true}}catch{}}
  if($scratch){try{Invoke-ComRetry{$scratch.Close($false)} -TimeoutSeconds 10|Out-Null}catch{}}
  if($owned-and$acad){try{Invoke-ComRetry{$acad.Quit()} -TimeoutSeconds 10|Out-Null}catch{}}
}
if(-not$result){throw'F-027 AutoCAD matrix produced no result.'};$result|ConvertTo-Json -Depth 16;if($result.status-ne'PASS'){exit 1}
