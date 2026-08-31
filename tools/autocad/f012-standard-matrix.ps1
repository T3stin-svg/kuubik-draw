param(
  [Parameter(Mandatory = $true)][string]$PidPath,
  [Parameter(Mandatory = $true)][string]$OwnershipToken,
  [Parameter(Mandatory = $true)][string]$DxfOutputPath
)

$ErrorActionPreference = 'Stop'
$DxfOutputPath = [IO.Path]::GetFullPath($DxfOutputPath)
if ([IO.Path]::GetExtension($DxfOutputPath) -ine '.dxf' -or (Test-Path -LiteralPath $DxfOutputPath)) { throw 'F-012 DXF output must be a new .dxf path.' }
$interopCommonPath = 'C:\Program Files\Autodesk\AutoCAD 2024\Autodesk.AutoCAD.Interop.Common.dll'
if (-not (Test-Path -LiteralPath $interopCommonPath)) { throw "F-012 requires $interopCommonPath" }
Add-Type -Path $interopCommonPath
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class F012WindowProcess {
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
  throw "F-012 AutoCAD did not return idle. CMDNAMES='$($Document.GetVariable('CMDNAMES'))' LASTPROMPT='$($Document.GetVariable('LASTPROMPT'))'"
}
function Wait-AcadMarker {
  param($Document, [string]$Marker, [int]$TimeoutSeconds = 45)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 100
    try { if ([string]$Document.GetVariable('USERS1') -eq $Marker) { Wait-AcadIdle $Document $TimeoutSeconds; return } } catch {}
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "F-012 marker $Marker timed out. CMDNAMES='$($Document.GetVariable('CMDNAMES'))' LASTPROMPT='$($Document.GetVariable('LASTPROMPT'))'"
}
function Get-StringSha256 { param([string]$Value); $hash = [Security.Cryptography.SHA256]::Create(); try { return ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value))).Replace('-', '').ToLowerInvariant()) } finally { $hash.Dispose() } }
function Get-FileSha256 { param([string]$Path); $hash = [Security.Cryptography.SHA256]::Create(); $stream = [IO.File]::OpenRead($Path); try { return ([BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()) } finally { $stream.Dispose(); $hash.Dispose() } }
function Get-OwnedAcadIdentity {
  param([int]$ProcessId)
  $process = Get-Process -Id $ProcessId -ErrorAction Stop
  $path = [IO.Path]::GetFullPath([string]$process.Path)
  if ([IO.Path]::GetFileName($path) -ine 'acad.exe') { throw "F-012 PID $ProcessId is not acad.exe." }
  $start = $process.StartTime.ToUniversalTime().ToString('o'); $version = (Get-Item -LiteralPath $path).VersionInfo
  return [ordered]@{ processId = $ProcessId; executablePath = $path; executableName = 'acad.exe'; executableSha256 = Get-FileSha256 $path; fileVersion = [string]$version.FileVersion; productVersion = [string]$version.ProductVersion; startTimeUtc = $start; startTimeSha256 = Get-StringSha256 $start }
}
function Write-OwnedPidSidecar {
  param([int]$ProcessId)
  $identity = Get-OwnedAcadIdentity $ProcessId
  [ordered]@{ schemaVersion = 1; processId = $identity.processId; executablePath = $identity.executablePath; executableName = $identity.executableName; executableSha256 = $identity.executableSha256; fileVersion = $identity.fileVersion; productVersion = $identity.productVersion; startTimeUtc = $identity.startTimeUtc; startTimeSha256 = $identity.startTimeSha256; owned = $true; token = $OwnershipToken } | ConvertTo-Json -Compress | Set-Content -LiteralPath $PidPath -Encoding ascii
  return $identity
}
function Get-InstalledAutoCadUpdateIdentity {
  $items = @(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue) + @(Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue)
  $match = $items | Where-Object { $_.DisplayName -eq 'Autodesk AutoCAD 2024.1.2 Update' } | Select-Object -First 1
  if ($match) { return [ordered]@{ displayName = [string]$match.DisplayName; displayVersion = [string]$match.DisplayVersion } }
  return $null
}
function Get-Point2 { param($Value); return @([double]$Value[0], [double]$Value[1]) }
function Get-PointSet {
  param($Value)
  if ($null -eq $Value) { return @() }
  $flat = @($Value); $points = @()
  for ($index = 0; $index + 2 -lt $flat.Count; $index += 3) { $points += ,@([double]$flat[$index], [double]$flat[$index + 1]) }
  return @($points)
}
function Get-NumberSet {
  param($Value)
  if ($null -eq $Value -or $Value -isnot [Array]) { return ,@() }
  return ,@($Value | ForEach-Object { [double]$_ })
}
function Get-SplineState {
  param($Entity)
  $fitPoints = @(); try { $fitPoints = Get-PointSet (Invoke-ComRetry { $Entity.FitPoints }) } catch {}
  $controlPoints = Get-PointSet (Invoke-NonNullCom { $Entity.ControlPoints } 'spline control points')
  $weights = @(); try { $weights = Get-NumberSet (Invoke-ComRetry { $Entity.Weights }) } catch {}
  $periodic = $null; try { $periodic = [bool](Invoke-ComRetry { $Entity.IsPeriodic }) } catch {}
  $directionPoints = if ($fitPoints.Count -gt 0) { $fitPoints } else { $controlPoints }
  return [ordered]@{
    objectName = [string](Invoke-ComRetry { $Entity.ObjectName })
    handle = [string](Invoke-ComRetry { $Entity.Handle })
    layer = [string](Invoke-ComRetry { $Entity.Layer })
    color = [int](Invoke-ComRetry { $Entity.Color })
    lineweight = [int](Invoke-ComRetry { $Entity.Lineweight })
    linetype = [string](Invoke-ComRetry { $Entity.Linetype })
    details = [ordered]@{
      degree = [int](Invoke-ComRetry { $Entity.Degree })
      closed = [bool](Invoke-ComRetry { $Entity.Closed })
      periodic = $periodic
      rational = [bool](Invoke-ComRetry { $Entity.IsRational })
      start = @($directionPoints[0])
      end = @($directionPoints[$directionPoints.Count - 1])
      fitPoints = $fitPoints
      controlPoints = $controlPoints
      knots = Get-NumberSet (Invoke-NonNullCom { $Entity.Knots } 'spline knots')
      weights = $weights
      fitTolerance = [double](Invoke-ComRetry { $Entity.FitTolerance })
    }
  }
}
function Get-StateByHandle { param($Document, [string]$Handle); return Get-SplineState (Invoke-NonNullCom { $Document.HandleToObject($Handle) } "spline $Handle") }
function Invoke-SplineCreation {
  param($Document)
  $marker = [Guid]::NewGuid().ToString('N')
  $lisp = "(progn (setvar `"USERS1`" `"`") (setvar `"CLAYER`" `"F012_FIT`") (command `"_.SPLINE`" (list 0.0 0.0 0.0) (list 40.0 70.0 0.0) (list 100.0 0.0 0.0) `"`" `"`" `"`") (setvar `"USERS2`" (cdr (assoc 5 (entget (entlast))))) (setvar `"USERS1`" `"$marker`") (princ))`n"
  Invoke-ComRetry { $Document.SendCommand($lisp) } | Out-Null; Wait-AcadMarker $Document $marker
  $handle = [string](Invoke-ComRetry { $Document.GetVariable('USERS2') }); if (-not $handle) { throw 'F-012 SPLINE creation returned no handle.' }
  return $handle
}
function Invoke-SplineEdit {
  param($Document, [string]$Handle, [string[]]$Options)
  $marker = [Guid]::NewGuid().ToString('N'); $arguments = ($Options | ForEach-Object { "`"$_`"" }) -join ' '
  $lisp = "(progn (setvar `"USERS1`" `"`") (command `"_.SPLINEDIT`" (handent `"$Handle`") $arguments `"`") (setvar `"USERS1`" `"$marker`") (princ))`n"
  Invoke-ComRetry { $Document.SendCommand($lisp) } | Out-Null; Wait-AcadMarker $Document $marker
}
function New-SplineJoinProbe {
  param($Document, [double]$OffsetY = -3800.0)
  $marker = [Guid]::NewGuid().ToString('N')
  $culture = [System.Globalization.CultureInfo]::InvariantCulture
  $y0 = $OffsetY.ToString('R', $culture); $y1 = ($OffsetY + 40.0).ToString('R', $culture); $y2 = ($OffsetY + 20.0).ToString('R', $culture)
  $lisp = "(progn (setvar `"USERS1`" `"`") (setvar `"CLAYER`" `"F012_FIT`") (command `"_.SPLINE`" (list 0.0 $y0 0.0) (list 40.0 $y1 0.0) (list 100.0 $y0 0.0) `"`" `"`" `"`") (setq f012joinsource (entlast)) (command `"_.LINE`" (list 100.0 $y0 0.0) (list 150.0 $y2 0.0) `"`") (setq f012jointarget (entlast)) (setvar `"USERS2`" (cdr (assoc 5 (entget f012joinsource)))) (setvar `"USERS3`" (cdr (assoc 5 (entget f012jointarget)))) (setvar `"USERS1`" `"$marker`") (princ))`n"
  Invoke-ComRetry { $Document.SendCommand($lisp) } | Out-Null; Wait-AcadMarker $Document $marker
  return [ordered]@{ sourceHandle = [string](Invoke-ComRetry { $Document.GetVariable('USERS2') }); targetHandle = [string](Invoke-ComRetry { $Document.GetVariable('USERS3') }) }
}
function Invoke-SplineJoinProbe {
  param($Document, [string]$SourceHandle, [string]$TargetHandle)
  $marker = [Guid]::NewGuid().ToString('N')
  $lisp = "(progn (setvar `"USERS1`" `"`") (command `"_.SPLINEDIT`" (handent `"$SourceHandle`") `"_Join`" (handent `"$TargetHandle`") `"`" `"`") (setvar `"USERS1`" `"$marker`") (princ))`n"
  Invoke-ComRetry { $Document.SendCommand($lisp) } | Out-Null; Wait-AcadMarker $Document $marker
}
function Test-HandleExists {
  param($Document, [string]$Handle)
  try { $null = Invoke-ComRetry { $Document.HandleToObject($Handle) } -TimeoutSeconds 2; return $true } catch { return $false }
}
function New-CvDeleteProbe {
  param($Document, [double]$OffsetY = 0.0, [double[]]$AddParameters = @(0.5))
  $marker = [Guid]::NewGuid().ToString('N')
  $culture = [System.Globalization.CultureInfo]::InvariantCulture
  $y0 = $OffsetY.ToString('R', $culture); $y1 = ($OffsetY + 70.0).ToString('R', $culture); $y2 = ($OffsetY - 20.0).ToString('R', $culture)
  $addCommands = ($AddParameters | ForEach-Object {
    $parameter = ([double]$_).ToString('R', $culture)
    "(command `"_.SPLINEDIT`" f012cvdelete `"_Refine`" `"_Add`" (vlax-curve-getPointAtParam f012cvdelete (* $parameter (vlax-curve-getEndParam f012cvdelete))) `"`" `"_Exit`" `"`")"
  }) -join ' '
  $lisp = "(progn (setvar `"USERS1`" `"`" ) (command `"_.PLINE`" (list 200.0 $y0 0.0) (list 230.0 $y1 0.0) (list 280.0 $y2 0.0) (list 320.0 $y0 0.0) `"`") (setq f012cvsource (entlast)) (command `"_.PEDIT`" f012cvsource `"_Spline`" `"`") (command `"_.SPLINE`" `"_Object`" f012cvsource `"`") (setq f012cvdelete (entlast)) $addCommands (command `"_.CVSHOW`" f012cvdelete `"`") (command `"_.ZOOM`" `"_Object`" f012cvdelete `"`") (setvar `"USERS2`" (cdr (assoc 5 (entget f012cvdelete)))) (setvar `"USERS1`" `"$marker`") (princ))`n"
  Invoke-ComRetry { $Document.SendCommand($lisp) } | Out-Null; Wait-AcadMarker $Document $marker
  $handle = [string](Invoke-ComRetry { $Document.GetVariable('USERS2') })
  if (-not $handle) { throw 'F-012 CV Delete fixture returned no handle.' }
  return $handle
}
function Invoke-CvDeleteProbe {
  param($Document, [string]$Handle, [double[]]$Point = @(255.0, 25.0))
  $marker = [Guid]::NewGuid().ToString('N')
  $culture = [System.Globalization.CultureInfo]::InvariantCulture
  $x = ([double]$Point[0]).ToString('R', $culture); $y = ([double]$Point[1]).ToString('R', $culture)
  $lisp = "(progn (setvar `"USERS1`" `"`") (command `"_.SPLINEDIT`" (handent `"$Handle`") `"_Refine`" `"_Delete`" (list $x $y 0.0) `"`" `"_Exit`" `"`") (setvar `"USERS1`" `"$marker`") (princ))`n"
  Invoke-ComRetry { $Document.SendCommand($lisp) } | Out-Null; Wait-AcadMarker $Document $marker
}
function Invoke-CvAddParameters {
  param($Document, [string]$Handle, [double[]]$Parameters)
  $culture = [System.Globalization.CultureInfo]::InvariantCulture
  foreach ($value in $Parameters) {
    $marker = [Guid]::NewGuid().ToString('N')
    $parameter = ([double]$value).ToString('R', $culture)
    $lisp = "(progn (setvar `"USERS1`" `"`") (setq f012cvadd (handent `"$Handle`")) (command `"_.SPLINEDIT`" f012cvadd `"_Refine`" `"_Add`" (vlax-curve-getPointAtParam f012cvadd (* $parameter (vlax-curve-getEndParam f012cvadd))) `"`" `"_Exit`" `"`") (setvar `"USERS1`" `"$marker`") (princ))`n"
    Invoke-ComRetry { $Document.SendCommand($lisp) } | Out-Null; Wait-AcadMarker $Document $marker
  }
}
function Set-CvProbeWeights {
  param($Document, [string]$Handle, [double[]]$Weights)
  $entity = Invoke-NonNullCom { $Document.HandleToObject($Handle) } "spline $Handle"
  if ([int](Invoke-ComRetry { $entity.NumberOfControlPoints }) -lt $Weights.Count) { throw 'F-012 CV weight fixture count mismatch.' }
  for ($index = 0; $index -lt $Weights.Count; $index++) {
    $weight = [double]$Weights[$index]
    try { Invoke-ComRetry { $entity.SetWeight([int]$index, $weight) } | Out-Null }
    catch { throw "F-012 CV weight fixture failed at index $index of $($Weights.Count): $($_.Exception.Message)" }
  }
  Invoke-ComRetry { $entity.Update() } | Out-Null
}
function Test-Near { param([double]$A, [double]$B, [double]$Tolerance = 0.000001); return [Math]::Abs($A - $B) -le $Tolerance }
function Test-Point { param($A, $B); return $A.Count -ge 2 -and (Test-Near $A[0] $B[0]) -and (Test-Near $A[1] $B[1]) }
function Test-PointSet { param($A, $B); if ($A.Count -ne $B.Count) { return $false }; for ($index = 0; $index -lt $A.Count; $index++) { if (-not (Test-Point $A[$index] $B[$index])) { return $false } }; return $true }
function Test-NumberSetNear { param($A, $B); if ($A.Count -ne $B.Count) { return $false }; for ($index = 0; $index -lt $A.Count; $index++) { if (-not (Test-Near $A[$index] $B[$index])) { return $false } }; return $true }
function Test-ExactJson { param($A, $B); return ($A | ConvertTo-Json -Depth 12 -Compress) -eq ($B | ConvertTo-Json -Depth 12 -Compress) }
function Test-CommonPreserved { param($Before, $After); return $Before.objectName -eq $After.objectName -and $Before.handle -eq $After.handle -and $Before.layer -eq $After.layer -and $Before.color -eq $After.color -and $Before.lineweight -eq $After.lineweight -and $Before.linetype -eq $After.linetype }

$acad = $null; $scratch = $null; $result = $null; $owned = $false; $ownedIdentity = $null; $automationProcessId = 0; $stage = 'bootstrap'
$preExistingProcessIds = @(Get-Process -Name 'acad' -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.Id })
try {
  $stage = 'create-owned-process'; $acad = New-Object -ComObject AutoCAD.Application.24.3; [uint32]$acadPid = 0; [void][F012WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry { $acad.HWND }), [ref]$acadPid); $automationProcessId = [int]$acadPid; $owned = $automationProcessId -gt 0 -and $preExistingProcessIds -notcontains $automationProcessId
  if (-not $owned) { throw 'F-012 refuses to use a pre-existing AutoCAD process.' }
  $ownedIdentity = Write-OwnedPidSidecar $automationProcessId; $installedUpdateIdentity = Get-InstalledAutoCadUpdateIdentity; Invoke-ComRetry { $acad.Visible = $true } | Out-Null
  $stage = 'open-blank'; $initialCount = [int](Invoke-ComRetry { $acad.Documents.Count }); if ($initialCount -gt 0) { $candidate = Invoke-ComRetry { $acad.ActiveDocument }; $candidateFullName = [string](Invoke-ComRetry { $candidate.FullName }); $candidateSaved = [bool](Invoke-ComRetry { $candidate.Saved }); $candidateEntityCount = [int](Invoke-ComRetry { $candidate.ModelSpace.Count }); if ($candidateFullName -or -not $candidateSaved -or $candidateEntityCount -ne 0) { throw "F-012 refuses a non-blank initial document: fullName='$candidateFullName', saved=$candidateSaved, modelSpaceCount=$candidateEntityCount." }; $scratch = $candidate } else { $scratch = Invoke-ComRetry { $acad.Documents.Add() } }; Invoke-ComRetry { $scratch.Activate() } | Out-Null; Wait-AcadIdle $scratch
  $stage = 'create-layer'; Invoke-ComRetry { $scratch.Layers.Add('F012_FIT') } | Out-Null
  $stage = 'command-create'; $handle = Invoke-SplineCreation $scratch; $entity = Invoke-NonNullCom { $scratch.HandleToObject($handle) } 'created spline'; Invoke-ComRetry { $entity.Color = 1; $entity.Lineweight = 35 } | Out-Null; $source = Get-StateByHandle $scratch $handle
  $stage = 'command-reverse'; Invoke-SplineEdit $scratch $handle @('_Reverse'); $reversed = Get-StateByHandle $scratch $handle
  $stage = 'global-undo'; Invoke-ComRetry { $scratch.SendCommand("_.UNDO`n1`n") } | Out-Null; Start-Sleep -Milliseconds 750; Wait-AcadIdle $scratch; $undone = Get-StateByHandle $scratch $handle
  $stage = 'global-redo'; Invoke-ComRetry { $scratch.SendCommand("_.REDO`n") } | Out-Null; Start-Sleep -Milliseconds 750; Wait-AcadIdle $scratch; $redone = Get-StateByHandle $scratch $handle
  $stage = 'command-close'; Invoke-SplineEdit $scratch $handle @('_Close'); $closed = Get-StateByHandle $scratch $handle
  $stage = 'command-open'; Invoke-SplineEdit $scratch $handle @('_Open'); $opened = Get-StateByHandle $scratch $handle
  $stage = 'command-local-undo'; Invoke-SplineEdit $scratch $handle @('_Reverse', '_Undo'); $commandUndone = Get-StateByHandle $scratch $handle
  $stage = 'cv-delete-fixture'; $cvDeleteHandle = New-CvDeleteProbe $scratch; $cvDeleteBefore = Get-StateByHandle $scratch $cvDeleteHandle
  $stage = 'cv-delete-command'; Invoke-CvDeleteProbe $scratch $cvDeleteHandle $cvDeleteBefore.details.controlPoints[2]; $cvDeleteAfter = Get-StateByHandle $scratch $cvDeleteHandle
  $stage = 'cv-delete-cleanup'; Invoke-ComRetry { $scratch.HandleToObject($cvDeleteHandle).Delete() } | Out-Null

  $cvDeleteCases = @()
  foreach ($deleteIndex in @(0, 1, 2, 3, 4, 5)) {
    $stage = "cv-delete-multispan-fixture-$deleteIndex"
    $caseHandle = New-CvDeleteProbe $scratch (-200.0 - 120.0 * $deleteIndex) @(0.3, 0.7)
    $caseBefore = Get-StateByHandle $scratch $caseHandle
    $pick = @($caseBefore.details.controlPoints[$deleteIndex])
    $stage = "cv-delete-multispan-command-$deleteIndex"
    Invoke-CvDeleteProbe $scratch $caseHandle $pick
    $caseAfter = Get-StateByHandle $scratch $caseHandle
    $cvDeleteCases += [ordered]@{ deleteIndex = $deleteIndex; pickedPoint = $pick; before = $caseBefore; after = $caseAfter }
    $stage = "cv-delete-multispan-cleanup-$deleteIndex"
    Invoke-ComRetry { $scratch.HandleToObject($caseHandle).Delete() } | Out-Null
  }
  $cvDeleteMatrixPass = $cvDeleteCases.Count -eq 6
  foreach ($case in $cvDeleteCases) {
    $expectedPoints = @()
    for ($pointIndex = 0; $pointIndex -lt $case.before.details.controlPoints.Count; $pointIndex++) {
      if ($pointIndex -ne $case.deleteIndex) { $expectedPoints += ,@($case.before.details.controlPoints[$pointIndex]) }
    }
    $expectedKnots = @($case.before.details.knots)
    $removeKnotIndex = if ($case.deleteIndex -le 2) { 4 } else { 5 }
    $expectedKnots = @($expectedKnots[0..($removeKnotIndex - 1)] + $expectedKnots[($removeKnotIndex + 1)..($expectedKnots.Count - 1)])
    $casePass = $case.after.details.degree -eq 3 -and $case.before.details.controlPoints.Count -eq 6 -and $case.after.details.controlPoints.Count -eq 5 -and (Test-CommonPreserved $case.before $case.after) -and (Test-PointSet $case.after.details.controlPoints $expectedPoints) -and (Test-NumberSetNear $case.after.details.knots $expectedKnots)
    if (-not $casePass) { $cvDeleteMatrixPass = $false }
  }

  $stage = 'cv-delete-rational-fixture'
  $rationalHandle = New-CvDeleteProbe $scratch -500.0 @(0.5)
  # AutoCAD 2024 ActiveX exposes the Refine-added fifth CV in NumberOfControlPoints
  # but SetWeight rejects that final index. Set the first four explicitly and retain
  # the fifth CV's default weight for the measured graphical Delete workflow.
  Set-CvProbeWeights $scratch $rationalHandle @(1.0, 1.5, 2.0, 2.5)
  $rationalBefore = Get-StateByHandle $scratch $rationalHandle
  $stage = 'cv-delete-rational-command'
  Invoke-CvDeleteProbe $scratch $rationalHandle $rationalBefore.details.controlPoints[2]
  $rationalAfter = Get-StateByHandle $scratch $rationalHandle
  $stage = 'cv-delete-rational-cleanup'
  Invoke-ComRetry { $scratch.HandleToObject($rationalHandle).Delete() } | Out-Null

  $repeatedCases = @()
  foreach ($deleteIndex in @(0, 1, 2, 3, 4, 5)) {
    $stage = "cv-delete-repeated-fixture-$deleteIndex"
    $caseHandle = New-CvDeleteProbe $scratch (-1000.0 - 120.0 * $deleteIndex) @(0.5, 0.5)
    $caseBefore = Get-StateByHandle $scratch $caseHandle
    $pick = @($caseBefore.details.controlPoints[$deleteIndex])
    $stage = "cv-delete-repeated-command-$deleteIndex"
    Invoke-CvDeleteProbe $scratch $caseHandle $pick
    $caseAfter = Get-StateByHandle $scratch $caseHandle
    $repeatedCases += [ordered]@{ deleteIndex = $deleteIndex; pickedPoint = $pick; before = $caseBefore; after = $caseAfter }
    $stage = "cv-delete-repeated-cleanup-$deleteIndex"
    Invoke-ComRetry { $scratch.HandleToObject($caseHandle).Delete() } | Out-Null
  }
  $repeatedMatrixPass = $repeatedCases.Count -eq 6
  foreach ($case in $repeatedCases) {
    $expectedPoints = @()
    for ($pointIndex = 0; $pointIndex -lt $case.before.details.controlPoints.Count; $pointIndex++) {
      if ($pointIndex -ne $case.deleteIndex) { $expectedPoints += ,@($case.before.details.controlPoints[$pointIndex]) }
    }
    $expectedKnots = @($case.before.details.knots[0..3] + $case.before.details.knots[5..($case.before.details.knots.Count - 1)])
    $casePass = $case.after.details.degree -eq 3 -and $case.before.details.controlPoints.Count -eq 6 -and $case.after.details.controlPoints.Count -eq 5 -and (Test-CommonPreserved $case.before $case.after) -and (Test-PointSet $case.after.details.controlPoints $expectedPoints) -and (Test-NumberSetNear $case.after.details.knots $expectedKnots)
    if (-not $casePass) { $repeatedMatrixPass = $false }
  }

  $minimumCases = @()
  foreach ($deleteIndex in @(0, 1, 2, 3)) {
    $stage = "cv-delete-minimum-fixture-$deleteIndex"
    $minimumHandle = New-CvDeleteProbe $scratch (-1900.0 - 120.0 * $deleteIndex) @()
    $minimumBefore = Get-StateByHandle $scratch $minimumHandle
    $pick = @($minimumBefore.details.controlPoints[$deleteIndex])
    $stage = "cv-delete-minimum-command-$deleteIndex"
    Invoke-CvDeleteProbe $scratch $minimumHandle $pick
    $minimumAfter = Get-StateByHandle $scratch $minimumHandle
    $minimumCases += [ordered]@{ deleteIndex = $deleteIndex; pickedPoint = $pick; before = $minimumBefore; after = $minimumAfter }
    $stage = "cv-delete-minimum-cleanup-$deleteIndex"
    Invoke-ComRetry { $scratch.HandleToObject($minimumHandle).Delete() } | Out-Null
  }
  $minimumMatrixPass = $minimumCases.Count -eq 4
  foreach ($case in $minimumCases) {
    $expectedPoints = @()
    for ($pointIndex = 0; $pointIndex -lt $case.before.details.controlPoints.Count; $pointIndex++) {
      if ($pointIndex -ne $case.deleteIndex) { $expectedPoints += ,@($case.before.details.controlPoints[$pointIndex]) }
    }
    $casePass = $case.before.details.degree -eq 3 -and $case.after.details.degree -eq 2 -and $case.before.details.controlPoints.Count -eq 4 -and $case.after.details.controlPoints.Count -eq 3 -and (Test-CommonPreserved $case.before $case.after) -and (Test-PointSet $case.after.details.controlPoints $expectedPoints) -and (Test-NumberSetNear $case.after.details.knots @(0.0, 0.0, 0.0, 1.0, 1.0, 1.0))
    if (-not $casePass) { $minimumMatrixPass = $false }
  }

  $quadraticCases = @()
  foreach ($deleteIndex in @(0, 1, 2, 3, 4)) {
    $stage = "cv-delete-quadratic-fixture-$deleteIndex"
    $quadraticHandle = New-CvDeleteProbe $scratch (-2500.0 - 120.0 * $deleteIndex) @()
    $cubicBefore = Get-StateByHandle $scratch $quadraticHandle
    Invoke-CvDeleteProbe $scratch $quadraticHandle $cubicBefore.details.controlPoints[2]
    Invoke-CvAddParameters $scratch $quadraticHandle @(0.35, 0.7)
    $quadraticBefore = Get-StateByHandle $scratch $quadraticHandle
    $pick = @($quadraticBefore.details.controlPoints[$deleteIndex])
    $stage = "cv-delete-quadratic-command-$deleteIndex"
    Invoke-CvDeleteProbe $scratch $quadraticHandle $pick
    $quadraticAfter = Get-StateByHandle $scratch $quadraticHandle
    $quadraticCases += [ordered]@{ deleteIndex = $deleteIndex; pickedPoint = $pick; before = $quadraticBefore; after = $quadraticAfter }
    $stage = "cv-delete-quadratic-cleanup-$deleteIndex"
    Invoke-ComRetry { $scratch.HandleToObject($quadraticHandle).Delete() } | Out-Null
  }
  $quadraticMatrixPass = $quadraticCases.Count -eq 5
  foreach ($case in $quadraticCases) {
    $expectedPoints = @()
    for ($pointIndex = 0; $pointIndex -lt $case.before.details.controlPoints.Count; $pointIndex++) {
      if ($pointIndex -ne $case.deleteIndex) { $expectedPoints += ,@($case.before.details.controlPoints[$pointIndex]) }
    }
    $expectedKnots = @($case.before.details.knots)
    $removeKnotIndex = if ($case.deleteIndex -le 1) { 3 } else { 4 }
    $expectedKnots = @($expectedKnots[0..($removeKnotIndex - 1)] + $expectedKnots[($removeKnotIndex + 1)..($expectedKnots.Count - 1)])
    $casePass = $case.before.details.degree -eq 2 -and $case.after.details.degree -eq 2 -and $case.before.details.controlPoints.Count -eq 5 -and $case.after.details.controlPoints.Count -eq 4 -and (Test-CommonPreserved $case.before $case.after) -and (Test-PointSet $case.after.details.controlPoints $expectedPoints) -and (Test-NumberSetNear $case.after.details.knots $expectedKnots)
    if (-not $casePass) { $quadraticMatrixPass = $false }
  }

  $stage = 'cv-delete-periodic-fixture'
  $periodicHandle = New-CvDeleteProbe $scratch -3300.0 @(0.3, 0.7)
  Invoke-SplineEdit $scratch $periodicHandle @('_Close')
  $periodicBefore = Get-StateByHandle $scratch $periodicHandle
  $stage = 'cv-delete-periodic-command'
  Invoke-CvDeleteProbe $scratch $periodicHandle $periodicBefore.details.controlPoints[2]
  $periodicAfter = Get-StateByHandle $scratch $periodicHandle
  $stage = 'cv-delete-periodic-cleanup'
  Invoke-ComRetry { $scratch.HandleToObject($periodicHandle).Delete() } | Out-Null

  $stage = 'join-line-fixture'
  $joinHandles = New-SplineJoinProbe $scratch
  $joinSourceEntity = Invoke-NonNullCom { $scratch.HandleToObject($joinHandles.sourceHandle) } 'join source spline'
  Invoke-ComRetry { $joinSourceEntity.Color = 2; $joinSourceEntity.Lineweight = 50 } | Out-Null
  $joinBefore = Get-StateByHandle $scratch $joinHandles.sourceHandle
  $joinTargetBefore = [ordered]@{ handle = $joinHandles.targetHandle; objectName = [string](Invoke-ComRetry { $scratch.HandleToObject($joinHandles.targetHandle).ObjectName }) }
  $stage = 'join-line-command'
  Invoke-SplineJoinProbe $scratch $joinHandles.sourceHandle $joinHandles.targetHandle
  $joinAfter = Get-StateByHandle $scratch $joinHandles.sourceHandle
  $joinTargetExistsAfter = Test-HandleExists $scratch $joinHandles.targetHandle

  $expectedCvDeleteBeforePoints = @(@(200.0, 0.0), @(215.0, 35.0), @(255.0, 25.0), @(300.0, -10.0), @(320.0, 0.0))
  $expectedCvDeleteAfterPoints = @(@(200.0, 0.0), @(215.0, 35.0), @(300.0, -10.0), @(320.0, 0.0))
  $expectedCvDeleteBeforeKnots = @(0.0, 0.0, 0.0, 0.0, 0.5, 1.0, 1.0, 1.0, 1.0)
  $expectedCvDeleteAfterKnots = @(0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0)

  $checks = [ordered]@{
    commandCreatedFitSpline = $source.objectName -eq 'AcDbSpline' -and $source.details.fitPoints.Count -eq 3 -and $source.details.degree -eq 3
    propertiesPreserved = (Test-CommonPreserved $source $reversed) -and (Test-CommonPreserved $source $opened) -and $source.color -eq 1 -and $source.lineweight -eq 35
    reverseSwapsEndpoints = (Test-Point $reversed.details.start $source.details.end) -and (Test-Point $reversed.details.end $source.details.start)
    atomicUndo = Test-ExactJson $source $undone
    atomicRedo = Test-ExactJson $reversed $redone
    closeCreatesPeriodicSpline = $closed.details.closed -eq $true -and $closed.details.periodic -eq $true
    openRestoresReversedDirection = $opened.details.closed -eq $false -and $opened.details.periodic -eq $false -and (Test-Point $opened.details.start $reversed.details.start) -and (Test-Point $opened.details.end $reversed.details.end)
    commandLocalUndo = Test-ExactJson $opened $commandUndone
    cvDeleteRemovesPickedControlVertex = $cvDeleteBefore.details.degree -eq 3 -and $cvDeleteBefore.details.controlPoints.Count -eq 5 -and $cvDeleteAfter.details.degree -eq 3 -and $cvDeleteAfter.details.controlPoints.Count -eq 4 -and (Test-CommonPreserved $cvDeleteBefore $cvDeleteAfter) -and (Test-ExactJson $cvDeleteBefore.details.controlPoints $expectedCvDeleteBeforePoints) -and (Test-ExactJson $cvDeleteAfter.details.controlPoints $expectedCvDeleteAfterPoints) -and (Test-ExactJson $cvDeleteBefore.details.knots $expectedCvDeleteBeforeKnots) -and (Test-ExactJson $cvDeleteAfter.details.knots $expectedCvDeleteAfterKnots)
    cvDeleteGrevilleKnotMatrix = $cvDeleteMatrixPass
    cvDeletePreservesRationalWeights = $rationalBefore.details.rational -eq $true -and $rationalAfter.details.rational -eq $true -and (Test-CommonPreserved $rationalBefore $rationalAfter) -and (Test-ExactJson $rationalAfter.details.controlPoints @($rationalBefore.details.controlPoints[0], $rationalBefore.details.controlPoints[1], $rationalBefore.details.controlPoints[3], $rationalBefore.details.controlPoints[4])) -and (Test-ExactJson $rationalAfter.details.knots @(0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0)) -and (Test-ExactJson $rationalAfter.details.weights @(1.0, 1.5, 2.5, 1.0))
    cvDeleteRepeatedKnotMatrix = $repeatedMatrixPass
    cvDeleteReducesMinimumCubicDegree = $minimumMatrixPass
    cvDeleteQuadraticGrevilleKnotMatrix = $quadraticMatrixPass
    cvDeletePeriodicExact = $periodicBefore.details.closed -eq $true -and $periodicBefore.details.periodic -eq $true -and $periodicAfter.details.closed -eq $true -and $periodicAfter.details.periodic -eq $true -and (Test-CommonPreserved $periodicBefore $periodicAfter) -and (Test-ExactJson $periodicAfter.details.controlPoints @($periodicBefore.details.controlPoints[0], $periodicBefore.details.controlPoints[1], $periodicBefore.details.controlPoints[3], $periodicBefore.details.controlPoints[4], $periodicBefore.details.controlPoints[5])) -and (Test-ExactJson $periodicAfter.details.knots @($periodicBefore.details.knots[0], $periodicBefore.details.knots[1], $periodicBefore.details.knots[3], $periodicBefore.details.knots[4], $periodicBefore.details.knots[5], $periodicBefore.details.knots[6]))
    joinLineCreatesC0Spline = (Test-CommonPreserved $joinBefore $joinAfter) -and $joinTargetBefore.objectName -eq 'AcDbLine' -and $joinTargetExistsAfter -eq $false -and $joinAfter.details.degree -eq 3 -and $joinAfter.details.fitPoints.Count -eq 0 -and $joinAfter.details.controlPoints.Count -eq 8 -and $joinAfter.details.knots.Count -eq 12 -and $joinAfter.details.weights.Count -eq 8 -and (@($joinAfter.details.weights | Where-Object { -not (Test-Near $_ 1.0) }).Count -eq 0) -and (Test-Point $joinAfter.details.start @(0.0, -3800.0)) -and (Test-Point $joinAfter.details.end @(150.0, -3780.0)) -and (Test-Point $joinAfter.details.controlPoints[4] @(100.0, -3800.0)) -and (Test-Point $joinAfter.details.controlPoints[5] @(116.66666666666669, -3793.333333333334)) -and (Test-Point $joinAfter.details.controlPoints[6] @(133.33333333333334, -3786.6666666666674)) -and (Test-Point $joinAfter.details.controlPoints[7] @(150.0, -3780.0)) -and (@($joinAfter.details.knots | Where-Object { Test-Near $_ $joinBefore.details.knots[-1] }).Count -eq 3) -and (@($joinAfter.details.knots | Where-Object { Test-Near $_ ($joinBefore.details.knots[-1] + 1.0) }).Count -eq 4)
  }
  $stage = 'save-dxf'; Invoke-ComRetry { $scratch.Regen(1); $scratch.SaveAs($DxfOutputPath, 65) } -TimeoutSeconds 90 | Out-Null; Wait-AcadIdle $scratch; $finalStates = @((Get-StateByHandle $scratch $handle), (Get-StateByHandle $scratch $joinHandles.sourceHandle))
  $result = [ordered]@{ schemaVersion = 1; rowId = 'F-012'; benchmark = 'AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation'; engine = 'Autodesk AutoCAD 2024 desktop COM'; engineVersion = [string](Invoke-ComRetry { $acad.Version }); automationProcessId = $automationProcessId; automationProcessOwned = $owned; installedUpdateIdentity = $installedUpdateIdentity; automationProcessIdentity = [ordered]@{ processId = $ownedIdentity.processId; executableName = $ownedIdentity.executableName; executableSha256 = $ownedIdentity.executableSha256; fileVersion = $ownedIdentity.fileVersion; productVersion = $ownedIdentity.productVersion; startTimeSha256 = $ownedIdentity.startTimeSha256 }; observations = [ordered]@{ source = $source; reversed = $reversed; undone = $undone; redone = $redone; closed = $closed; opened = $opened; commandUndone = $commandUndone; cvDeleteBefore = $cvDeleteBefore; cvDeleteAfter = $cvDeleteAfter; cvDeleteCases = $cvDeleteCases; cvDeleteRational = [ordered]@{ before = $rationalBefore; after = $rationalAfter }; cvDeleteRepeatedCases = $repeatedCases; cvDeleteMinimumCases = $minimumCases; cvDeleteQuadraticCases = $quadraticCases; cvDeletePeriodic = [ordered]@{ before = $periodicBefore; after = $periodicAfter }; joinLine = [ordered]@{ sourceBefore = $joinBefore; targetBefore = $joinTargetBefore; sourceAfter = $joinAfter; targetExistsAfter = $joinTargetExistsAfter } }; finalStates = $finalStates; checks = $checks; dxfOutputSha256 = Get-FileSha256 $DxfOutputPath; cmdNamesAfter = [string](Invoke-ComRetry { $scratch.GetVariable('CMDNAMES') }); userDocument = [ordered]@{ isolatedOwnedProcess = $owned; blankRestored = $true; sourceDocumentSynthetic = $true }; status = if (@($checks.Values | Where-Object { $_ -ne $true }).Count -eq 0) { 'PASS' } else { 'FAIL' } }
} catch { throw "F-012 AutoCAD stage '$stage' failed at script line $($_.InvocationInfo.ScriptLineNumber): $($_.Exception.Message)" }
finally {
  if ($acad -and -not $owned) { try { [uint32]$finallyProcessId = 0; [void][F012WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry { $acad.HWND }), [ref]$finallyProcessId); if ([int]$finallyProcessId -gt 0 -and $preExistingProcessIds -notcontains [int]$finallyProcessId) { $automationProcessId = [int]$finallyProcessId; $ownedIdentity = Write-OwnedPidSidecar $automationProcessId; $owned = $true } } catch {} }
  if ($scratch) { try { Invoke-ComRetry { $scratch.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
  if ($owned -and $acad) { try { Invoke-ComRetry { $acad.Quit() } -TimeoutSeconds 10 | Out-Null } catch {} }
}
if (-not $result) { throw 'F-012 AutoCAD matrix produced no result.' }
$result | ConvertTo-Json -Depth 16
if ($result.status -ne 'PASS') { exit 1 }
