param(
  [Parameter(Mandatory = $true)][string]$PidPath,
  [Parameter(Mandatory = $true)][string]$OwnershipToken,
  [Parameter(Mandatory = $true)][string]$DxfOutputPath
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$DxfOutputPath = [IO.Path]::GetFullPath($DxfOutputPath)
if ([IO.Path]::GetExtension($DxfOutputPath) -ine '.dxf' -or (Test-Path -LiteralPath $DxfOutputPath)) {
  throw 'F-053 DXF output must be a new .dxf path.'
}

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class F053WindowProcess {
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@

function Invoke-ComRetry {
  param([Parameter(Mandatory = $true)][scriptblock]$Action, [int]$TimeoutSeconds = 25)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    try { return (& $Action) } catch {
      if ([DateTime]::UtcNow -ge $deadline) { throw }
      Start-Sleep -Milliseconds 150
    }
  } while ($true)
}

function Wait-AcadIdle {
  param($Document, [int]$TimeoutSeconds = 45)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 100
    try {
      if ([string]::IsNullOrWhiteSpace([string]$Document.GetVariable('CMDNAMES')) -and [int]$Document.GetVariable('CMDACTIVE') -eq 0) { return }
    } catch {}
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "F-053 AutoCAD did not return idle. CMDNAMES='$($Document.GetVariable('CMDNAMES'))' LASTPROMPT='$($Document.GetVariable('LASTPROMPT'))'"
}

function Get-StringSha256 {
  param([string]$Value)
  $hash = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value))).Replace('-', '').ToLowerInvariant()) }
  finally { $hash.Dispose() }
}

function Get-FileSha256 {
  param([string]$Path)
  $hash = [Security.Cryptography.SHA256]::Create()
  $stream = [IO.File]::OpenRead($Path)
  try { return ([BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()) }
  finally { $stream.Dispose(); $hash.Dispose() }
}

function Get-OwnedAcadIdentity {
  param([int]$ProcessId)
  $process = Get-Process -Id $ProcessId -ErrorAction Stop
  $path = [IO.Path]::GetFullPath([string]$process.Path)
  if ([IO.Path]::GetFileName($path) -ine 'acad.exe') { throw "F-053 PID $ProcessId is not acad.exe." }
  $start = $process.StartTime.ToUniversalTime().ToString('o')
  $version = (Get-Item -LiteralPath $path).VersionInfo
  return [ordered]@{
    processId = $ProcessId
    executablePath = $path
    executableName = 'acad.exe'
    executableSha256 = Get-FileSha256 $path
    fileVersion = [string]$version.FileVersion
    productVersion = [string]$version.ProductVersion
    startTimeUtc = $start
    startTimeSha256 = Get-StringSha256 $start
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
  $items = @(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue) +
    @(Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue)
  $match = $items | Where-Object { $_.DisplayName -eq 'Autodesk AutoCAD 2024.1.2 Update' } | Select-Object -First 1
  if (-not $match) { return $null }
  return [ordered]@{ displayName = [string]$match.DisplayName; displayVersion = [string]$match.DisplayVersion }
}

function Get-UnitsState {
  param($Document)
  return [ordered]@{
    insunits = [int](Invoke-ComRetry { $Document.GetVariable('INSUNITS') })
    lunits = [int](Invoke-ComRetry { $Document.GetVariable('LUNITS') })
    luprec = [int](Invoke-ComRetry { $Document.GetVariable('LUPREC') })
    aunits = [int](Invoke-ComRetry { $Document.GetVariable('AUNITS') })
    auprec = [int](Invoke-ComRetry { $Document.GetVariable('AUPREC') })
    angdir = [int](Invoke-ComRetry { $Document.GetVariable('ANGDIR') })
    angbase = [double](Invoke-ComRetry { $Document.GetVariable('ANGBASE') })
  }
}

function Set-UnitsState {
  param($Document, [int]$Insunits, [int]$Luprec, [int]$Auprec, [int]$Angdir, [double]$Angbase)
  Invoke-ComRetry { $Document.SetVariable('INSUNITS', $Insunits) } | Out-Null
  Invoke-ComRetry { $Document.SetVariable('LUNITS', 2) } | Out-Null
  Invoke-ComRetry { $Document.SetVariable('LUPREC', $Luprec) } | Out-Null
  Invoke-ComRetry { $Document.SetVariable('AUNITS', 0) } | Out-Null
  Invoke-ComRetry { $Document.SetVariable('AUPREC', $Auprec) } | Out-Null
  Invoke-ComRetry { $Document.SetVariable('ANGDIR', $Angdir) } | Out-Null
  Invoke-ComRetry { $Document.SetVariable('ANGBASE', $Angbase) } | Out-Null
}

function Get-LineState {
  param($Document, [string]$Handle)
  $line = Invoke-ComRetry { $Document.HandleToObject($Handle) }
  return [ordered]@{
    handle = [string](Invoke-ComRetry { $line.Handle })
    start = @((Invoke-ComRetry { $line.StartPoint }) | ForEach-Object { [double]$_ })
    end = @((Invoke-ComRetry { $line.EndPoint }) | ForEach-Object { [double]$_ })
  }
}

function Test-JsonExact {
  param($Left, $Right)
  return ($Left | ConvertTo-Json -Depth 8 -Compress) -eq ($Right | ConvertTo-Json -Depth 8 -Compress)
}

function Test-Near {
  param([double]$Left, [double]$Right, [double]$Tolerance = 0.000000000001)
  return [Math]::Abs($Left - $Right) -le $Tolerance * [Math]::Max(1, [Math]::Max([Math]::Abs($Left), [Math]::Abs($Right)))
}

function Test-UnitsState {
  param($State, [int]$Insunits, [int]$Luprec, [int]$Auprec, [int]$Angdir, [double]$Angbase)
  return $State.insunits -eq $Insunits -and $State.lunits -eq 2 -and $State.luprec -eq $Luprec -and
    $State.aunits -eq 0 -and $State.auprec -eq $Auprec -and $State.angdir -eq $Angdir -and (Test-Near $State.angbase $Angbase)
}

function Invoke-InvalidSetting {
  param($Document, [string]$Name, $Value)
  $before = Get-UnitsState $Document
  $rejected = $false
  $message = $null
  try { Invoke-ComRetry { $Document.SetVariable($Name, $Value) } -TimeoutSeconds 2 | Out-Null }
  catch { $rejected = $true; $message = [string]$_.Exception.Message }
  $after = Get-UnitsState $Document
  return [ordered]@{ name = $Name; value = $Value; rejected = $rejected; message = $message; stateUnchanged = Test-JsonExact $before $after }
}

$preExistingProcessIds = @(Get-Process -Name 'acad' -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.Id })
$acad = $null
$scratch = $null
$result = $null
$owned = $false
$ownedIdentity = $null
$automationProcessId = 0
$stage = 'bootstrap'
$piOverThree = [Math]::PI / 3

try {
  $stage = 'create-owned-process'
  $acad = New-Object -ComObject AutoCAD.Application.24.3
  [uint32]$acadPid = 0
  [void][F053WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry { $acad.HWND }), [ref]$acadPid)
  $automationProcessId = [int]$acadPid
  $owned = $automationProcessId -gt 0 -and $preExistingProcessIds -notcontains $automationProcessId
  if (-not $owned) { throw 'F-053 refuses to use a pre-existing AutoCAD process.' }
  $ownedIdentity = Write-OwnedPidSidecar $automationProcessId
  $installedUpdateIdentity = Get-InstalledAutoCadUpdateIdentity
  Invoke-ComRetry { $acad.Visible = $true } | Out-Null

  $stage = 'open-scratch'
  $initialOwnedDocumentCount = [int](Invoke-ComRetry { $acad.Documents.Count })
  if ($initialOwnedDocumentCount -gt 0) {
    $candidate = Invoke-ComRetry { $acad.ActiveDocument }
    if (-not [string]::IsNullOrWhiteSpace([string](Invoke-ComRetry { $candidate.FullName })) -or [int](Invoke-ComRetry { $candidate.ModelSpace.Count }) -ne 0) {
      throw 'F-053 refuses a non-blank initial document in the owned process.'
    }
    $scratch = $candidate
  } else {
    $scratch = Invoke-ComRetry { $acad.Documents.Add() }
  }
  Invoke-ComRetry { $scratch.Activate() } | Out-Null
  Wait-AcadIdle $scratch
  $scratchFullNameBefore = [string](Invoke-ComRetry { $scratch.FullName })

  $stage = 'create-geometry'
  [double[]]$start = @(-123456789.12345679, 0.000000123456789, 0)
  [double[]]$end = @(987654321.9876543, -0.000000987654321, 0)
  $line = Invoke-ComRetry { $scratch.ModelSpace.AddLine($start, $end) }
  $lineHandle = [string](Invoke-ComRetry { $line.Handle })

  $stage = 'baseline-settings'
  Set-UnitsState $scratch 4 4 4 0 0
  $baseline = Get-UnitsState $scratch
  $geometryBaseline = Get-LineState $scratch $lineHandle

  $stage = 'atomic-units-commit'
  Invoke-ComRetry { $scratch.StartUndoMark() } | Out-Null
  try { Set-UnitsState $scratch 6 8 8 1 $piOverThree }
  finally { Invoke-ComRetry { $scratch.EndUndoMark() } | Out-Null }
  $committed = Get-UnitsState $scratch
  $geometryCommitted = Get-LineState $scratch $lineHandle

  $stage = 'atomic-undo'
  Invoke-ComRetry { $scratch.SendCommand("_.UNDO`n1`n") } | Out-Null
  Wait-AcadIdle $scratch
  $undone = Get-UnitsState $scratch
  $geometryUndone = Get-LineState $scratch $lineHandle

  $stage = 'atomic-redo'
  Invoke-ComRetry { $scratch.SendCommand("_.REDO`n") } | Out-Null
  Wait-AcadIdle $scratch
  $redone = Get-UnitsState $scratch
  $geometryRedone = Get-LineState $scratch $lineHandle

  $stage = 'no-op'
  $noOpBefore = Get-UnitsState $scratch
  $noOpGeometryBefore = Get-LineState $scratch $lineHandle
  $noOpDbmodBefore = [int](Invoke-ComRetry { $scratch.GetVariable('DBMOD') })
  Set-UnitsState $scratch 6 8 8 1 $piOverThree
  $noOpAfter = Get-UnitsState $scratch
  $noOpGeometryAfter = Get-LineState $scratch $lineHandle
  $noOpDbmodAfter = [int](Invoke-ComRetry { $scratch.GetVariable('DBMOD') })

  $stage = 'invalid-settings'
  $invalidLuprec = Invoke-InvalidSetting $scratch 'LUPREC' 99
  $invalidInsunits = Invoke-InvalidSetting $scratch 'INSUNITS' 999
  $afterInvalid = Get-UnitsState $scratch
  $geometryAfterInvalid = Get-LineState $scratch $lineHandle

  $checks = [ordered]@{
    baselineExact = Test-UnitsState $baseline 4 4 4 0 0
    committedExact = Test-UnitsState $committed 6 8 8 1 $piOverThree
    existingGeometryCoordinatesPreserved = (Test-JsonExact $geometryBaseline $geometryCommitted) -and (Test-JsonExact $geometryCommitted $geometryUndone) -and (Test-JsonExact $geometryCommitted $geometryRedone)
    atomicUndo = Test-UnitsState $undone 4 4 4 0 0
    atomicRedo = Test-UnitsState $redone 6 8 8 1 $piOverThree
    noOpSettingsAndGeometryUnchanged = (Test-JsonExact $noOpBefore $noOpAfter) -and (Test-JsonExact $noOpGeometryBefore $noOpGeometryAfter)
    invalidLuprecRejected = $invalidLuprec.rejected -and $invalidLuprec.stateUnchanged
    invalidInsunitsRejected = $invalidInsunits.rejected -and $invalidInsunits.stateUnchanged
    invalidLeavesGeometryUnchanged = Test-JsonExact $geometryCommitted $geometryAfterInvalid
  }

  $stage = 'save-dxf'
  Invoke-ComRetry { $scratch.Regen(1); $scratch.SaveAs($DxfOutputPath, 65) } -TimeoutSeconds 90 | Out-Null
  Wait-AcadIdle $scratch

  $result = [ordered]@{
    schemaVersion = 1
    rowId = 'F-053'
    benchmark = 'AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation'
    engine = 'Autodesk AutoCAD 2024 desktop COM system-variable contract'
    engineVersion = [string](Invoke-ComRetry { $acad.Version })
    installedUpdateIdentity = $installedUpdateIdentity
    automationProcessId = $automationProcessId
    automationProcessOwned = $owned
    automationProcessIdentity = [ordered]@{
      processId = $ownedIdentity.processId
      executableName = $ownedIdentity.executableName
      executableSha256 = $ownedIdentity.executableSha256
      fileVersion = $ownedIdentity.fileVersion
      productVersion = $ownedIdentity.productVersion
      startTimeSha256 = $ownedIdentity.startTimeSha256
    }
    observations = [ordered]@{
      baseline = $baseline
      committed = $committed
      undone = $undone
      redone = $redone
      noOp = [ordered]@{
        settingsBefore = $noOpBefore
        settingsAfter = $noOpAfter
        dbmodBefore = $noOpDbmodBefore
        dbmodAfter = $noOpDbmodAfter
        dbmodUnchanged = $noOpDbmodBefore -eq $noOpDbmodAfter
      }
      invalid = [ordered]@{ luprec = $invalidLuprec; insunits = $invalidInsunits; after = $afterInvalid }
      geometry = [ordered]@{ baseline = $geometryBaseline; committed = $geometryCommitted; undone = $geometryUndone; redone = $geometryRedone; afterInvalid = $geometryAfterInvalid }
      blocked = @(
        [ordered]@{ capability = 'separateDrawingAndInsertionUnitFields'; status = 'NOT_RUN'; reason = 'AutoCAD UNITS exposes one drawing INSUNITS insertion-scale value; it does not provide the two independent Kuubik contract fields.' },
        [ordered]@{ capability = 'modalUnitsDialogCancel'; status = 'NOT_RUN'; reason = 'COM system variables cannot prove modal UNITS Cancel without UI input simulation; no SendKeys or user-window automation was used.' }
      )
    }
    checks = $checks
    dxfOutputSha256 = Get-FileSha256 $DxfOutputPath
    cmdNamesAfter = [string](Invoke-ComRetry { $scratch.GetVariable('CMDNAMES') })
    userDocument = [ordered]@{
      isolatedOwnedProcess = $owned
      preExistingProcessCount = $preExistingProcessIds.Count
      initialOwnedDocumentCount = $initialOwnedDocumentCount
      scratchBlankVerified = [string]::IsNullOrWhiteSpace($scratchFullNameBefore)
      scratchPathAfterSave = $DxfOutputPath
      userDocumentTouched = $false
    }
    status = if (@($checks.Values | Where-Object { $_ -ne $true }).Count -eq 0) { 'PARTIAL' } else { 'FAIL' }
  }
} catch {
  throw "F-053 AutoCAD stage '$stage' failed at script line $($_.InvocationInfo.ScriptLineNumber): $($_.Exception.Message)"
} finally {
  if ($acad -and -not $owned) {
    try {
      [uint32]$finallyProcessId = 0
      [void][F053WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry { $acad.HWND }), [ref]$finallyProcessId)
      if ([int]$finallyProcessId -gt 0 -and $preExistingProcessIds -notcontains [int]$finallyProcessId) {
        $automationProcessId = [int]$finallyProcessId
        $ownedIdentity = Write-OwnedPidSidecar $automationProcessId
        $owned = $true
      }
    } catch {}
  }
  if ($scratch) { try { Invoke-ComRetry { $scratch.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
  if ($owned -and $acad) { try { Invoke-ComRetry { $acad.Quit() } -TimeoutSeconds 10 | Out-Null } catch {} }
}

if (-not $result) { throw 'F-053 AutoCAD matrix produced no result.' }
$result | ConvertTo-Json -Depth 16
if ($result.status -eq 'FAIL') { exit 1 }
