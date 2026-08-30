param(
  [Parameter(Mandatory = $true)][string]$PidPath,
  [Parameter(Mandatory = $true)][string]$OwnershipToken,
  [Parameter(Mandatory = $true)][string]$DxfOutputPath
)

$ErrorActionPreference = 'Stop'
$DxfOutputPath = [IO.Path]::GetFullPath($DxfOutputPath)
if ([IO.Path]::GetExtension($DxfOutputPath) -ine '.dxf' -or (Test-Path -LiteralPath $DxfOutputPath)) { throw 'F-029 DXF output must be a new .dxf path.' }
$interopCommonPath = 'C:\Program Files\Autodesk\AutoCAD 2024\Autodesk.AutoCAD.Interop.Common.dll'
if (-not (Test-Path -LiteralPath $interopCommonPath)) { throw "F-029 requires $interopCommonPath" }
Add-Type -Path $interopCommonPath
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class F029WindowProcess {
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
  throw "F-029 AutoCAD did not return idle. CMDNAMES='$($Document.GetVariable('CMDNAMES'))' LASTPROMPT='$($Document.GetVariable('LASTPROMPT'))'"
}
function Wait-AcadMarker {
  param($Document, [string]$Marker, [int]$TimeoutSeconds = 45)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 100
    try { if ([string]$Document.GetVariable('USERS1') -eq $Marker) { Wait-AcadIdle $Document $TimeoutSeconds; return } } catch {}
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "F-029 marker $Marker timed out. CMDNAMES='$($Document.GetVariable('CMDNAMES'))' LASTPROMPT='$($Document.GetVariable('LASTPROMPT'))'"
}
function Get-StringSha256 { param([string]$Value); $hash=[Security.Cryptography.SHA256]::Create(); try { return ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value))).Replace('-','').ToLowerInvariant()) } finally { $hash.Dispose() } }
function Get-FileSha256 { param([string]$Path); $hash=[Security.Cryptography.SHA256]::Create(); $stream=[IO.File]::OpenRead($Path); try { return ([BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-','').ToLowerInvariant()) } finally { $stream.Dispose();$hash.Dispose() } }
function Get-OwnedAcadIdentity {
  param([int]$ProcessId)
  $process=Get-Process -Id $ProcessId -ErrorAction Stop; $path=[IO.Path]::GetFullPath([string]$process.Path)
  if ([IO.Path]::GetFileName($path) -ine 'acad.exe') { throw "F-029 PID $ProcessId is not acad.exe." }
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
function Format-Point { param($Point); return "(list $(Format-Number $Point[0]) $(Format-Number $Point[1]) 0.0)" }
function Get-Point2 { param($Value); return @([double]$Value[0],[double]$Value[1]) }
function Get-PointSet3 {
  param($Value)
  $flat=@($Value);$points=@();for($i=0;$i+2-lt$flat.Count;$i+=3){$points+=,@([double]$flat[$i],[double]$flat[$i+1])};return $points
}
function Normalize-Weights {
  param($Value)
  $weights=@($Value|ForEach-Object{[double]$_});if($weights.Count-eq0){return @()};$basis=[double]$weights[0];if([Math]::Abs($basis)-le1e-12){throw 'F-029 rational SPLINE weight basis is zero.'};return @($weights|ForEach-Object{[double]$_/$basis})
}
function Get-EntityState {
  param($Entity)
  $name=[string](Invoke-ComRetry{$Entity.ObjectName});$details=[ordered]@{}
  if($name-eq'AcDbLine'){$details.start=Get-Point2(Invoke-NonNullCom{$Entity.StartPoint}'line start');$details.end=Get-Point2(Invoke-NonNullCom{$Entity.EndPoint}'line end')}
  elseif($name-eq'AcDbCircle'){$details.center=Get-Point2(Invoke-NonNullCom{$Entity.Center}'circle center');$details.radius=[double](Invoke-ComRetry{$Entity.Radius})}
  elseif($name-eq'AcDbPolyline'){
    $flat=@(Invoke-NonNullCom{$Entity.Coordinates}'polyline coordinates');$vertices=@();for($i=0;$i+1-lt$flat.Count;$i+=2){$vertices+=,@([double]$flat[$i],[double]$flat[$i+1])}
    $details.vertices=$vertices;$details.closed=[bool](Invoke-ComRetry{$Entity.Closed});$details.bulges=@();$details.widths=@();for($i=0;$i-lt$vertices.Count;$i+=1){$details.bulges+=[double](Invoke-ComRetry{$Entity.GetBulge($i)});[double]$sw=0;[double]$ew=0;Invoke-ComRetry{$Entity.GetWidth($i,[ref]$sw,[ref]$ew)}|Out-Null;$details.widths+=,@($sw,$ew)}
  }
  elseif($name-eq'AcDbSpline'){
    $details.degree=[int](Invoke-ComRetry{$Entity.Degree});$details.controlPoints=Get-PointSet3(Invoke-NonNullCom{$Entity.ControlPoints}'spline control points');$details.knots=@(Invoke-NonNullCom{$Entity.Knots}'spline knots'|ForEach-Object{[double]$_});$details.weights=Normalize-Weights(Invoke-NonNullCom{$Entity.Weights}'spline weights');$details.closed=[bool](Invoke-ComRetry{$Entity.Closed2});$details.periodic=[bool](Invoke-ComRetry{$Entity.IsPeriodic});$details.rational=[bool](Invoke-ComRetry{$Entity.IsRational});$details.fitPointCount=[int](Invoke-ComRetry{$Entity.NumberOfFitPoints});$details.controlPointCount=[int](Invoke-ComRetry{$Entity.NumberOfControlPoints})
  }
  elseif($name-eq'AcDbText'){$details.position=Get-Point2(Invoke-NonNullCom{$Entity.InsertionPoint}'text insertion');$details.height=[double](Invoke-ComRetry{$Entity.Height});$details.rotation=[double](Invoke-ComRetry{$Entity.Rotation});$details.text=[string](Invoke-ComRetry{$Entity.TextString})}
  else{$details.unsupported=$true}
  return [ordered]@{objectName=$name;handle=[string](Invoke-ComRetry{$Entity.Handle});layer=[string](Invoke-ComRetry{$Entity.Layer});color=[int](Invoke-ComRetry{$Entity.Color});lineweight=[int](Invoke-ComRetry{$Entity.Lineweight});linetype=[string](Invoke-ComRetry{$Entity.Linetype});details=$details}
}
function Get-StateByHandle { param($Document,[string]$Handle); return Get-EntityState(Invoke-NonNullCom{$Document.HandleToObject($Handle)}"entity $Handle") }
function Get-LayerStates {
  param($Document,[string]$Layer)
  $result=@();$count=[int](Invoke-ComRetry{$Document.ModelSpace.Count});for($i=0;$i-lt$count;$i+=1){$entity=Invoke-ComRetry{$Document.ModelSpace.Item($i)};if([string](Invoke-ComRetry{$entity.Layer})-eq$Layer){$result+=Get-StateByHandle $Document ([string](Invoke-ComRetry{$entity.Handle}))}}
  return @($result|Sort-Object handle)
}
function Set-Common { param($Entity,[string]$Layer);Invoke-ComRetry{$Entity.Layer=$Layer;$Entity.Color=1;$Entity.Lineweight=35}|Out-Null;return $Entity }
function New-Line { param($Document,[string]$Layer,[double]$X1,[double]$Y1,[double]$X2,[double]$Y2);[double[]]$a=@($X1,$Y1,0);[double[]]$b=@($X2,$Y2,0);return Set-Common(Invoke-ComRetry{$Document.ModelSpace.AddLine($a,$b)})$Layer }
function New-Circle { param($Document,[string]$Layer,[double]$X,[double]$Y,[double]$Radius);[double[]]$center=@($X,$Y,0);return Set-Common(Invoke-ComRetry{$Document.ModelSpace.AddCircle($center,$Radius)})$Layer }
function New-Polyline { param($Document,[string]$Layer,[double[]]$Coordinates);return Set-Common(Invoke-ComRetry{$Document.ModelSpace.AddLightWeightPolyline($Coordinates)})$Layer }
function New-RationalSpline {
  param($Document,[string]$Layer)
  $marker=[Guid]::NewGuid().ToString('N')
  $lisp="(progn (setvar `"USERS1`" `"`") (setvar `"USERS2`" `"`") (setq f029:s (entmakex (list (cons 0 `"SPLINE`") (cons 100 `"AcDbEntity`") (cons 8 `"$Layer`") (cons 100 `"AcDbSpline`") (cons 210 (list 0.0 0.0 1.0)) (cons 70 4) (cons 71 3) (cons 72 8) (cons 73 4) (cons 74 0) (cons 40 0.0) (cons 40 0.0) (cons 40 0.0) (cons 40 0.0) (cons 40 1.0) (cons 40 1.0) (cons 40 1.0) (cons 40 1.0) (cons 41 1.0) (cons 41 0.8) (cons 41 1.2) (cons 41 1.0) (cons 10 (list 0.0 300.0 0.0)) (cons 10 (list 40.0 380.0 0.0)) (cons 10 (list 80.0 380.0 0.0)) (cons 10 (list 120.0 300.0 0.0))))) (setvar `"USERS2`" (if f029:s (cdr (assoc 5 (entget f029:s))) `"`")) (setvar `"USERS1`" `"$marker`") (princ))`n"
  Invoke-ComRetry{$Document.SendCommand($lisp)}|Out-Null;Wait-AcadMarker $Document $marker;$handle=[string](Invoke-ComRetry{$Document.GetVariable('USERS2')});if([string]::IsNullOrWhiteSpace($handle)){throw 'F-029 rational SPLINE entmakex returned no handle.'};return Set-Common(Invoke-NonNullCom{$Document.HandleToObject($handle)}'rational spline')$Layer
}
function New-Text { param($Document,[string]$Layer);[double[]]$point=@(0,450,0);return Set-Common(Invoke-ComRetry{$Document.ModelSpace.AddText('ALIGN',$point,10)})$Layer }
function Invoke-Align {
  param($Document,$Entities,$Source1,$Destination1,$Source2=$null,$Destination2=$null,[bool]$Scale=$false)
  $marker=[Guid]::NewGuid().ToString('N');$adds=($Entities|ForEach-Object{"(ssadd (handent `"$([string](Invoke-ComRetry{$_.Handle}))`") f029:ss)"})-join' '
  if($null-eq$Source2){$arguments="$(Format-Point $Source1) $(Format-Point $Destination1) `"`""}
  else{$scaleOption=if($Scale){'"_Yes"'}else{'"_No"'};$arguments="$(Format-Point $Source1) $(Format-Point $Destination1) $(Format-Point $Source2) $(Format-Point $Destination2) `"`" $scaleOption"}
  $lisp="(progn (setvar `"USERS1`" `"`") (setq f029:ss (ssadd)) $adds (command `"_.ALIGN`" f029:ss `"`" $arguments) (setvar `"USERS1`" `"$marker`") (princ))`n"
  Invoke-ComRetry{$Document.SendCommand($lisp)}|Out-Null;Wait-AcadMarker $Document $marker
}
function Test-Near { param([double]$A,[double]$B,[double]$Tolerance=0.0000001);return [Math]::Abs($A-$B)-le$Tolerance }
function Test-Point { param($A,$B);return $A.Count-ge2-and(Test-Near $A[0] $B[0])-and(Test-Near $A[1] $B[1]) }
function Test-PointSet { param($A,$B);if($null-eq$A-or$null-eq$B-or$A.Count-ne$B.Count){return $false};for($i=0;$i-lt$B.Count;$i++){if(-not(Test-Point $A[$i] $B[$i])){return $false}};return $true }
function Test-NumberSet { param($A,$B);if($null-eq$A-or$null-eq$B-or$A.Count-ne$B.Count){return $false};for($i=0;$i-lt$B.Count;$i++){if(-not(Test-Near $A[$i] $B[$i])){return $false}};return $true }
function Test-Common { param($State,[string]$Type,[string]$Layer,[string]$Handle);return $State.objectName-eq$Type-and$State.layer-eq$Layer-and$State.handle-eq$Handle-and$State.color-eq1-and$State.lineweight-eq35-and$State.linetype-eq'ByLayer' }
function Test-Line { param($State,[string]$Layer,[string]$Handle,$Start,$End);return(Test-Common $State 'AcDbLine' $Layer $Handle)-and(Test-Point $State.details.start $Start)-and(Test-Point $State.details.end $End) }
function Test-Circle { param($State,[string]$Layer,[string]$Handle,$Center,[double]$Radius);return(Test-Common $State 'AcDbCircle' $Layer $Handle)-and(Test-Point $State.details.center $Center)-and(Test-Near $State.details.radius $Radius) }
function Test-Polyline { param($State,[string]$Layer,[string]$Handle,$Vertices,$Widths,$Bulges,[bool]$Closed);return(Test-Common $State 'AcDbPolyline' $Layer $Handle)-and(Test-PointSet $State.details.vertices $Vertices)-and(Test-PointSet $State.details.widths $Widths)-and(Test-NumberSet $State.details.bulges $Bulges)-and$State.details.closed-eq$Closed }
function Test-Spline { param($State,[string]$Layer,[string]$Handle,$ControlPoints,$Knots,$Weights);return(Test-Common $State 'AcDbSpline' $Layer $Handle)-and$State.details.degree-eq3-and$State.details.controlPointCount-eq4-and$State.details.fitPointCount-eq0-and$State.details.rational-eq$true-and$State.details.closed-eq$false-and$State.details.periodic-eq$false-and(Test-PointSet $State.details.controlPoints $ControlPoints)-and(Test-NumberSet $State.details.knots $Knots)-and(Test-NumberSet $State.details.weights $Weights) }
function Test-Text { param($State,[string]$Layer,[string]$Handle,$Point,[double]$Height,[double]$Rotation);return (Test-Common $State 'AcDbText' $Layer $Handle)-and(Test-Point $State.details.position $Point)-and(Test-Near $State.details.height $Height)-and(Test-Near $State.details.rotation $Rotation)-and$State.details.text-eq'ALIGN' }
function Test-StateEquivalent {
  param($Actual,$Expected)
  if($null-eq$Actual-or$null-eq$Expected-or-not(Test-Common $Actual $Expected.objectName $Expected.layer $Expected.handle)){return $false}
  if($Actual.objectName-eq'AcDbLine'){return(Test-Point $Actual.details.start $Expected.details.start)-and(Test-Point $Actual.details.end $Expected.details.end)}
  if($Actual.objectName-eq'AcDbCircle'){return(Test-Point $Actual.details.center $Expected.details.center)-and(Test-Near $Actual.details.radius $Expected.details.radius)}
  if($Actual.objectName-eq'AcDbPolyline'){return(Test-PointSet $Actual.details.vertices $Expected.details.vertices)-and($Actual.details.closed-eq$Expected.details.closed)-and(Test-NumberSet $Actual.details.bulges $Expected.details.bulges)-and(Test-PointSet $Actual.details.widths $Expected.details.widths)}
  if($Actual.objectName-eq'AcDbSpline'){return($Actual.details.degree-eq$Expected.details.degree)-and($Actual.details.controlPointCount-eq$Expected.details.controlPointCount)-and($Actual.details.fitPointCount-eq$Expected.details.fitPointCount)-and($Actual.details.rational-eq$Expected.details.rational)-and($Actual.details.closed-eq$Expected.details.closed)-and($Actual.details.periodic-eq$Expected.details.periodic)-and(Test-PointSet $Actual.details.controlPoints $Expected.details.controlPoints)-and(Test-NumberSet $Actual.details.knots $Expected.details.knots)-and(Test-NumberSet $Actual.details.weights $Expected.details.weights)}
  if($Actual.objectName-eq'AcDbText'){return(Test-Point $Actual.details.position $Expected.details.position)-and(Test-Near $Actual.details.height $Expected.details.height)-and(Test-Near $Actual.details.rotation $Expected.details.rotation)-and($Actual.details.text-eq$Expected.details.text)}
  return $false
}
function Test-StateSetEquivalent {
  param($Actual,$Expected)
  if($null-eq$Actual-or$null-eq$Expected-or$Actual.Count-ne$Expected.Count){return $false}
  for($i=0;$i-lt$Expected.Count;$i+=1){if(-not(Test-StateEquivalent $Actual[$i] $Expected[$i])){return $false}}
  return $true
}

$acad=$null;$scratch=$null;$result=$null;$owned=$false;$ownedIdentity=$null;$automationProcessId=0;$stage='bootstrap'
$preExistingProcessIds=@(Get-Process -Name 'acad' -ErrorAction SilentlyContinue|ForEach-Object{[int]$_.Id})
try {
  $stage='create-owned-process';$acad=New-Object -ComObject AutoCAD.Application.24.3;[uint32]$acadPid=0;[void][F029WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry{$acad.HWND}),[ref]$acadPid);$automationProcessId=[int]$acadPid;$owned=$automationProcessId-gt0-and$preExistingProcessIds-notcontains$automationProcessId
  if(-not$owned){throw 'F-029 refuses to use a pre-existing AutoCAD process.'};$ownedIdentity=Write-OwnedPidSidecar $automationProcessId;$installedUpdateIdentity=Get-InstalledAutoCadUpdateIdentity;Invoke-ComRetry{$acad.Visible=$true}|Out-Null
  $stage='open-blank';$initialCount=[int](Invoke-ComRetry{$acad.Documents.Count});if($initialCount-gt0){$candidate=Invoke-ComRetry{$acad.ActiveDocument};if([string](Invoke-ComRetry{$candidate.FullName})-or[int](Invoke-ComRetry{$candidate.ModelSpace.Count})-ne0){throw 'F-029 refuses a non-blank initial document.'};$scratch=$candidate}else{$scratch=Invoke-ComRetry{$acad.Documents.Add()}};Invoke-ComRetry{$scratch.Activate()}|Out-Null;Wait-AcadIdle $scratch
  foreach($name in @('F029_ONE','F029_NOSCALE','F029_SCALE','F029_OPPOSITE','F029_NOOP','F029_UNLOCKED','F029_LOCKED')){Invoke-ComRetry{$scratch.Layers.Add($name)}|Out-Null}

  $stage='one-pair';$one=New-Line $scratch 'F029_ONE' 0 0 100 0;$oneHandle=[string](Invoke-ComRetry{$one.Handle});$oneSource=Get-StateByHandle $scratch $oneHandle;Invoke-Align $scratch @($one) @(0,0) @(50,25);$oneCommitted=Get-StateByHandle $scratch $oneHandle
  $stage='two-pair-no-scale';$noScale=New-Line $scratch 'F029_NOSCALE' 0 0 100 0;$noScaleHandle=[string](Invoke-ComRetry{$noScale.Handle});Invoke-Align $scratch @($noScale) @(0,0) @(100,200) @(100,0) @(100,400) $false;$noScaleCommitted=Get-StateByHandle $scratch $noScaleHandle
  $stage='opposite-direction';$opposite=New-Line $scratch 'F029_OPPOSITE' 0 0 100 0;$oppositeHandle=[string](Invoke-ComRetry{$opposite.Handle});Invoke-Align $scratch @($opposite) @(100,0) @(0,0) @(0,0) @(0,100) $false;$oppositeCommitted=Get-StateByHandle $scratch $oppositeHandle
  $stage='no-op';$noop=New-Line $scratch 'F029_NOOP' 0 0 100 0;$noopHandle=[string](Invoke-ComRetry{$noop.Handle});$noopSource=Get-StateByHandle $scratch $noopHandle;Invoke-Align $scratch @($noop) @(0,0) @(0,0) @(100,0) @(100,0) $false;$noopCommitted=Get-StateByHandle $scratch $noopHandle

  $stage='locked-mixed';$unlocked=New-Line $scratch 'F029_UNLOCKED' 0 700 100 700;$locked=New-Line $scratch 'F029_LOCKED' 0 750 100 750;$unlockedHandle=[string](Invoke-ComRetry{$unlocked.Handle});$lockedHandle=[string](Invoke-ComRetry{$locked.Handle});$lockedSource=@((Get-StateByHandle $scratch $unlockedHandle),(Get-StateByHandle $scratch $lockedHandle));Invoke-ComRetry{(Invoke-ComRetry{$scratch.Layers.Item('F029_LOCKED')}).Lock=$true}|Out-Null;Invoke-Align $scratch @($unlocked,$locked) @(0,700) @(50,725);$lockedCommitted=@((Get-StateByHandle $scratch $unlockedHandle),(Get-StateByHandle $scratch $lockedHandle))
  $lockedBehavior=if((Test-Line $lockedCommitted[0] 'F029_UNLOCKED' $unlockedHandle @(0,700) @(100,700))-and(Test-Line $lockedCommitted[1] 'F029_LOCKED' $lockedHandle @(0,750) @(100,750))){'all-refused'}elseif((Test-Line $lockedCommitted[0] 'F029_UNLOCKED' $unlockedHandle @(50,725) @(150,725))-and(Test-Line $lockedCommitted[1] 'F029_LOCKED' $lockedHandle @(0,750) @(100,750))){'unlocked-only'}else{'unexpected'}

  $stage='two-pair-scale-yes';$line=New-Line $scratch 'F029_SCALE' 0 0 100 0;$circle=New-Circle $scratch 'F029_SCALE' 0 100 25;$poly=New-Polyline $scratch 'F029_SCALE' ([double[]]@(0,200,100,200));Invoke-ComRetry{$poly.SetWidth(0,2,4);$poly.SetWidth(1,4,6);$poly.SetBulge(1,0.5);$poly.Closed=$true}|Out-Null;$spline=New-RationalSpline $scratch 'F029_SCALE';$text=New-Text $scratch 'F029_SCALE';$scaleEntities=@($line,$circle,$poly,$spline,$text);$scaleHandles=@($scaleEntities|ForEach-Object{[string](Invoke-ComRetry{$_.Handle})});$scaleSource=@($scaleHandles|ForEach-Object{Get-StateByHandle $scratch $_})
  Invoke-Align $scratch $scaleEntities @(0,0) @(100,200) @(100,0) @(100,400) $true;$scaleCommitted=@($scaleHandles|ForEach-Object{Get-StateByHandle $scratch $_});Invoke-ComRetry{$scratch.SendCommand("_.U`n")}|Out-Null;Start-Sleep -Milliseconds 750;Wait-AcadIdle $scratch;$scaleUndone=@($scaleHandles|ForEach-Object{Get-StateByHandle $scratch $_});Invoke-ComRetry{$scratch.SendCommand("_.REDO`n")}|Out-Null;Start-Sleep -Milliseconds 750;Wait-AcadIdle $scratch;$scaleRedone=@($scaleHandles|ForEach-Object{Get-StateByHandle $scratch $_})

  $checks=[ordered]@{
    onePairTranslation=Test-Line $oneCommitted 'F029_ONE' $oneHandle @(50,25) @(150,25)
    twoPairNoScale=Test-Line $noScaleCommitted 'F029_NOSCALE' $noScaleHandle @(100,200) @(100,300)
    oppositeDirection=Test-Line $oppositeCommitted 'F029_OPPOSITE' $oppositeHandle @(0,100) @(0,0)
    noOpExact=($noopSource|ConvertTo-Json -Depth 8 -Compress)-eq($noopCommitted|ConvertTo-Json -Depth 8 -Compress)
    lockedSelectionBehaviorMeasured=$lockedBehavior-ne'unexpected'
    scaleLine=Test-Line $scaleCommitted[0] 'F029_SCALE' $scaleHandles[0] @(100,200) @(100,400)
    scaleCircle=Test-Circle $scaleCommitted[1] 'F029_SCALE' $scaleHandles[1] @(-100,200) 50
    scalePolyline=Test-Polyline $scaleCommitted[2] 'F029_SCALE' $scaleHandles[2] @(@(-300,200),@(-300,400)) @(@(4,8),@(8,12)) @(0,0.5) $true
    scaleSpline=Test-Spline $scaleCommitted[3] 'F029_SCALE' $scaleHandles[3] @(@(-500,200),@(-660,280),@(-660,360),@(-500,440)) @(0,0,0,0,1,1,1,1) @(1,0.8,1.2,1)
    scaleText=Test-Text $scaleCommitted[4] 'F029_SCALE' $scaleHandles[4] @(-800,200) 20 ([Math]::PI/2)
    undoLine=Test-StateEquivalent $scaleUndone[0] $scaleSource[0]
    undoCircle=Test-StateEquivalent $scaleUndone[1] $scaleSource[1]
    undoPolyline=Test-StateEquivalent $scaleUndone[2] $scaleSource[2]
    undoSpline=Test-StateEquivalent $scaleUndone[3] $scaleSource[3]
    undoText=Test-StateEquivalent $scaleUndone[4] $scaleSource[4]
    atomicUndo=Test-StateSetEquivalent $scaleUndone $scaleSource
    atomicRedo=Test-StateSetEquivalent $scaleRedone $scaleCommitted
  }
  $stage='save-dxf';Invoke-ComRetry{$scratch.Regen(1);$scratch.SaveAs($DxfOutputPath,65)} -TimeoutSeconds 90|Out-Null;Wait-AcadIdle $scratch
  $finalStates=@();foreach($layer in @('F029_ONE','F029_NOSCALE','F029_SCALE','F029_OPPOSITE','F029_NOOP','F029_UNLOCKED','F029_LOCKED')){$finalStates+=@(Get-LayerStates $scratch $layer)}
  $result=[ordered]@{schemaVersion=1;rowId='F-029';benchmark='AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation';engine='Autodesk AutoCAD 2024 desktop COM';engineVersion=[string](Invoke-ComRetry{$acad.Version});automationProcessId=$automationProcessId;automationProcessOwned=$owned;installedUpdateIdentity=$installedUpdateIdentity;automationProcessIdentity=[ordered]@{processId=$ownedIdentity.processId;executableName=$ownedIdentity.executableName;executableSha256=$ownedIdentity.executableSha256;fileVersion=$ownedIdentity.fileVersion;productVersion=$ownedIdentity.productVersion;startTimeSha256=$ownedIdentity.startTimeSha256};observations=[ordered]@{onePair=[ordered]@{source=$oneSource;committed=$oneCommitted};twoPairNoScale=$noScaleCommitted;opposite=$oppositeCommitted;noOp=[ordered]@{source=$noopSource;committed=$noopCommitted};locked=[ordered]@{source=$lockedSource;committed=$lockedCommitted;behavior=$lockedBehavior};scale=[ordered]@{source=$scaleSource;committed=$scaleCommitted;undone=$scaleUndone;redone=$scaleRedone}};finalStates=$finalStates;checks=$checks;dxfOutputSha256=Get-FileSha256 $DxfOutputPath;cmdNamesAfter=[string](Invoke-ComRetry{$scratch.GetVariable('CMDNAMES')});userDocument=[ordered]@{isolatedOwnedProcess=$owned;blankRestored=$true};status=if(@($checks.Values|Where-Object{$_-ne$true}).Count-eq0){'PASS'}else{'FAIL'}}
} catch { throw "F-029 AutoCAD stage '$stage' failed at script line $($_.InvocationInfo.ScriptLineNumber): $($_.Exception.Message)" }
finally {
  if($acad-and-not$owned){try{[uint32]$finallyProcessId=0;[void][F029WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry{$acad.HWND}),[ref]$finallyProcessId);if([int]$finallyProcessId-gt0-and$preExistingProcessIds-notcontains[int]$finallyProcessId){$automationProcessId=[int]$finallyProcessId;$ownedIdentity=Write-OwnedPidSidecar $automationProcessId;$owned=$true}}catch{}}
  if($scratch){try{Invoke-ComRetry{$scratch.Close($false)} -TimeoutSeconds 10|Out-Null}catch{}}
  if($owned-and$acad){try{Invoke-ComRetry{$acad.Quit()} -TimeoutSeconds 10|Out-Null}catch{}}
}
if(-not$result){throw 'F-029 AutoCAD matrix produced no result.'};$result|ConvertTo-Json -Depth 16;if($result.status-ne'PASS'){exit 1}
