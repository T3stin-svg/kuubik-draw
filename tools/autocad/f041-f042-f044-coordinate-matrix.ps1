param(
  [Parameter(Mandatory = $true)][string]$PidPath,
  [Parameter(Mandatory = $true)][string]$OwnershipToken,
  [Parameter(Mandatory = $true)][string]$DxfOutputPath
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$DxfOutputPath = [IO.Path]::GetFullPath($DxfOutputPath)
if ([IO.Path]::GetExtension($DxfOutputPath) -ine '.dxf' -or (Test-Path -LiteralPath $DxfOutputPath)) {
  throw 'F-041/F-042/F-044 DXF output must be a new .dxf path.'
}

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class F041F044WindowProcess {
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
  throw "F-041/F-042/F-044 AutoCAD did not return idle. CMDNAMES='$($Document.GetVariable('CMDNAMES'))' LASTPROMPT='$($Document.GetVariable('LASTPROMPT'))'"
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
  if ([IO.Path]::GetFileName($path) -ine 'acad.exe') { throw "Owned PID $ProcessId is not acad.exe." }
  $start = $process.StartTime.ToUniversalTime().ToString('o')
  $version = (Get-Item -LiteralPath $path).VersionInfo
  return [ordered]@{
    processId = $ProcessId; executablePath = $path; executableName = 'acad.exe'
    executableSha256 = Get-FileSha256 $path; fileVersion = [string]$version.FileVersion
    productVersion = [string]$version.ProductVersion; startTimeUtc = $start
    startTimeSha256 = Get-StringSha256 $start
  }
}

function Write-OwnedPidSidecar {
  param([int]$ProcessId)
  $identity = Get-OwnedAcadIdentity $ProcessId
  [ordered]@{
    schemaVersion = 1; processId = $identity.processId; executablePath = $identity.executablePath
    executableName = $identity.executableName; executableSha256 = $identity.executableSha256
    fileVersion = $identity.fileVersion; productVersion = $identity.productVersion
    startTimeUtc = $identity.startTimeUtc; startTimeSha256 = $identity.startTimeSha256
    owned = $true; token = $OwnershipToken
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

function Test-Near {
  param([double]$Left, [double]$Right, [int]$Ulps = 8)
  return [double]::IsFinite($Left) -and [double]::IsFinite($Right) -and
    [Math]::Abs($Left - $Right) -le [Math]::Max(1e-15, 2.2204460492503131e-16 * $Ulps * [Math]::Max(1, [Math]::Max([Math]::Abs($Left), [Math]::Abs($Right))))
}

function Test-Point {
  param($Actual, $Expected)
  if ($Actual.Count -ne $Expected.Count) { return $false }
  for ($index = 0; $index -lt $Actual.Count; $index++) {
    if (-not (Test-Near ([double]$Actual[$index]) ([double]$Expected[$index]))) { return $false }
  }
  return $true
}

function Get-EntityState {
  param($Entity)
  $name = [string](Invoke-ComRetry { $Entity.ObjectName })
  $state = [ordered]@{
    handle = [string](Invoke-ComRetry { $Entity.Handle })
    layer = [string](Invoke-ComRetry { $Entity.Layer })
    objectName = $name
  }
  if ($name -eq 'AcDbLine') {
    $state.start = @((Invoke-ComRetry { $Entity.StartPoint }) | ForEach-Object { [double]$_ })
    $state.end = @((Invoke-ComRetry { $Entity.EndPoint }) | ForEach-Object { [double]$_ })
  } elseif ($name -eq 'AcDbPolyline') {
    $flat = @((Invoke-ComRetry { $Entity.Coordinates }) | ForEach-Object { [double]$_ })
    $vertices = @()
    for ($index = 0; $index + 1 -lt $flat.Count; $index += 2) { $vertices += ,@($flat[$index], $flat[$index + 1], 0.0) }
    $state.vertices = $vertices
    $state.closed = [bool](Invoke-ComRetry { $Entity.Closed })
  } else {
    throw "Unsupported coordinate evidence entity '$name'."
  }
  return $state
}

function Get-LayerEntities {
  param($Document, [string]$Layer)
  $states = @()
  foreach ($entity in $Document.ModelSpace) {
    if ([string](Invoke-ComRetry { $entity.Layer }) -eq $Layer) { $states += Get-EntityState $entity }
  }
  return @($states | Sort-Object handle)
}

function Get-MatrixEntities {
  param($Document, [string[]]$Layers)
  $states = @()
  foreach ($layer in $Layers) { $states += @(Get-LayerEntities $Document $layer) }
  return @($states | Sort-Object layer, handle)
}

function Invoke-CommandCase {
  param($Document, [string]$Id, [string]$Layer, [string[]]$Tokens)
  Invoke-ComRetry { $Document.SetVariable('CLAYER', $Layer) } | Out-Null
  $beforeCount = [int](Invoke-ComRetry { $Document.ModelSpace.Count })
  $beforeDbmod = [int](Invoke-ComRetry { $Document.GetVariable('DBMOD') })
  $script = ($Tokens -join "`n") + "`n"
  Invoke-ComRetry { $Document.SendCommand($script) } | Out-Null
  Wait-AcadIdle $Document
  Start-Sleep -Milliseconds 500
  return [ordered]@{
    id = $Id; layer = $Layer; tokens = $Tokens; beforeCount = $beforeCount
    afterCount = [int](Invoke-ComRetry { $Document.ModelSpace.Count })
    beforeDbmod = $beforeDbmod; afterDbmod = [int](Invoke-ComRetry { $Document.GetVariable('DBMOD') })
    cmdNamesAfter = [string](Invoke-ComRetry { $Document.GetVariable('CMDNAMES') })
    cmdActiveAfter = [int](Invoke-ComRetry { $Document.GetVariable('CMDACTIVE') })
    lastPromptAfter = [string](Invoke-ComRetry { $Document.GetVariable('LASTPROMPT') })
    entities = @(Get-LayerEntities $Document $Layer)
  }
}

function Test-Line {
  param($State, $Start, $End)
  return $State.Count -eq 1 -and $State[0].objectName -eq 'AcDbLine' -and
    (Test-Point $State[0].start $Start) -and (Test-Point $State[0].end $End)
}

function Test-Polyline {
  param($State, $Vertices)
  if ($State.Count -ne 1 -or $State[0].objectName -ne 'AcDbPolyline' -or $State[0].closed) { return $false }
  if ($State[0].vertices.Count -ne $Vertices.Count) { return $false }
  for ($index = 0; $index -lt $Vertices.Count; $index++) {
    if (-not (Test-Point $State[0].vertices[$index] $Vertices[$index])) { return $false }
  }
  return $true
}

$layers = @('F041_PLAIN', 'F041_HASH', 'F042_REL_CART', 'F042_REL_POLAR', 'F042_PLINE')
$preExistingProcessIds = @(Get-Process -Name 'acad' -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.Id })
$acad = $null; $scratch = $null; $result = $null; $owned = $false; $ownedIdentity = $null; $automationProcessId = 0
$stage = 'bootstrap'

try {
  $stage = 'create-owned-process'
  $acad = New-Object -ComObject AutoCAD.Application.24.3
  [uint32]$acadPid = 0
  [void][F041F044WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry { $acad.HWND }), [ref]$acadPid)
  $automationProcessId = [int]$acadPid
  $owned = $automationProcessId -gt 0 -and $preExistingProcessIds -notcontains $automationProcessId
  if (-not $owned) { throw 'F-041/F-042/F-044 refuses to use a pre-existing AutoCAD process.' }
  $ownedIdentity = Write-OwnedPidSidecar $automationProcessId
  Write-Host "[F-041/F-042/F-044] owned-process=$automationProcessId"
  $installedUpdateIdentity = Get-InstalledAutoCadUpdateIdentity
  Invoke-ComRetry { $acad.Visible = $true } | Out-Null

  $stage = 'open-scratch'
  $initialOwnedDocumentCount = [int](Invoke-ComRetry { $acad.Documents.Count })
  if ($initialOwnedDocumentCount -gt 0) {
    $candidate = Invoke-ComRetry { $acad.ActiveDocument }
    if (-not [string]::IsNullOrWhiteSpace([string](Invoke-ComRetry { $candidate.FullName })) -or [int](Invoke-ComRetry { $candidate.ModelSpace.Count }) -ne 0) {
      throw 'F-041/F-042/F-044 refuses a non-blank initial document in the owned process.'
    }
    $scratch = $candidate
  } else { $scratch = Invoke-ComRetry { $acad.Documents.Add() } }
  Invoke-ComRetry { $scratch.Activate() } | Out-Null
  Wait-AcadIdle $scratch
  $scratchFullNameBefore = [string](Invoke-ComRetry { $scratch.FullName })
  Write-Host '[F-041/F-042/F-044] scratch-blank-verified'

  $stage = 'coordinate-context'
  Invoke-ComRetry {
    $scratch.SetVariable('INSUNITS', 4); $scratch.SetVariable('LUNITS', 2); $scratch.SetVariable('LUPREC', 8)
    $scratch.SetVariable('AUNITS', 0); $scratch.SetVariable('AUPREC', 8); $scratch.SetVariable('ANGDIR', 0); $scratch.SetVariable('ANGBASE', 0.0)
  } | Out-Null
  Invoke-ComRetry { $scratch.SendCommand("_.UCS`n_World`n") } | Out-Null; Wait-AcadIdle $scratch
  foreach ($layerName in $layers) { Invoke-ComRetry { $scratch.Layers.Add($layerName) } | Out-Null }
  $wcs = [ordered]@{
    ucsName = [string](Invoke-ComRetry { $scratch.GetVariable('UCSNAME') })
    ucsOrg = @((Invoke-ComRetry { $scratch.GetVariable('UCSORG') }) | ForEach-Object { [double]$_ })
    ucsXdir = @((Invoke-ComRetry { $scratch.GetVariable('UCSXDIR') }) | ForEach-Object { [double]$_ })
    ucsYdir = @((Invoke-ComRetry { $scratch.GetVariable('UCSYDIR') }) | ForEach-Object { [double]$_ })
  }
  Write-Host '[F-041/F-042/F-044] wcs-context-ready'

  $stage = 'typed-coordinate-commands'
  Invoke-ComRetry { $scratch.StartUndoMark() } | Out-Null
  try {
    $plain = Invoke-CommandCase $scratch 'absolute-plain-line' 'F041_PLAIN' @('_.LINE', '123456.789012345,-98765.4321098765', '123456.789012346,-98765.4321098755', '')
    $hash = Invoke-CommandCase $scratch 'absolute-hash-line' 'F041_HASH' @('_.LINE', '#10.25,-20.5', '#30.75,-40.125', '')
    $relativeCartesian = Invoke-CommandCase $scratch 'relative-cartesian-line' 'F042_REL_CART' @('_.LINE', '-100.5,200.25', '@-0.000000123456789,0.000000987654321', '')
    $relativePolar = Invoke-CommandCase $scratch 'relative-polar-line' 'F042_REL_POLAR' @('_.LINE', '500,-500', '@123.456789<-33.333333', '')
    $pline = Invoke-CommandCase $scratch 'relative-pline' 'F042_PLINE' @('_.PLINE', '1000,1000', '@250.125,-500.25', '@100.5<135', '')
    $plineBeforeMove = @(Get-LayerEntities $scratch 'F042_PLINE')
    $plineHandle = [string]$plineBeforeMove[0].handle
    $move = Invoke-CommandCase $scratch 'relative-move' 'F042_PLINE' @("(setq f042:ss (ssadd (handent `"$plineHandle`")))", '_.MOVE', '!f042:ss', '', '0,0', '@-12.5,3.25')
  } finally { Invoke-ComRetry { $scratch.EndUndoMark() } | Out-Null }
  Write-Host '[F-041/F-042/F-044] typed-commands-complete'

  $committed = @(Get-MatrixEntities $scratch $layers)
  $stage = 'atomic-undo'
  Invoke-ComRetry { $scratch.SendCommand("_.UNDO`n1`n") } | Out-Null; Wait-AcadIdle $scratch
  Start-Sleep -Milliseconds 500
  $undone = @(Get-MatrixEntities $scratch $layers)
  $stage = 'atomic-redo'
  Invoke-ComRetry { $scratch.SendCommand("_.REDO`n") } | Out-Null; Wait-AcadIdle $scratch
  Start-Sleep -Milliseconds 500
  $redone = @(Get-MatrixEntities $scratch $layers)
  Write-Host '[F-041/F-042/F-044] undo-redo-complete'

  $stage = 'cancel-no-op'
  $cancelBefore = @(Get-MatrixEntities $scratch $layers)
  $cancel = Invoke-CommandCase $scratch 'incomplete-pline-undo-blank' 'F042_PLINE' @('_.PLINE', '5000,5000', '_Undo', '')
  $cancelAfter = @(Get-MatrixEntities $scratch $layers)
  $noOp = Invoke-CommandCase $scratch 'empty-line' 'F041_PLAIN' @('_.LINE', '')
  $afterNoOp = @(Get-MatrixEntities $scratch $layers)
  Write-Host '[F-041/F-042/F-044] cancel-no-op-complete'

  [double[]]$plainStart = @(123456.789012345, -98765.4321098765, 0)
  [double[]]$plainEnd = @(123456.789012346, -98765.4321098755, 0)
  [double[]]$hashStart = @(10.25, -20.5, 0); [double[]]$hashEnd = @(30.75, -40.125, 0)
  [double[]]$relativeStart = @(-100.5, 200.25, 0)
  [double[]]$relativeEnd = @((-100.5 - 0.000000123456789), (200.25 + 0.000000987654321), 0)
  [double]$polarAngle = -33.333333 * [Math]::PI / 180
  [double[]]$polarStart = @(500, -500, 0)
  [double[]]$polarEnd = @((500 + [Math]::Cos($polarAngle) * 123.456789), (-500 + [Math]::Sin($polarAngle) * 123.456789), 0)
  [double[]]$p0 = @(987.5, 1003.25, 0); [double[]]$p1 = @(1237.625, 503.0, 0)
  [double[]]$p2 = @((1237.625 + [Math]::Cos(135 * [Math]::PI / 180) * 100.5), (503.0 + [Math]::Sin(135 * [Math]::PI / 180) * 100.5), 0)

  $plainState = @(Get-LayerEntities $scratch 'F041_PLAIN')
  $hashState = @(Get-LayerEntities $scratch 'F041_HASH')
  $relativeCartesianState = @(Get-LayerEntities $scratch 'F042_REL_CART')
  $relativePolarState = @(Get-LayerEntities $scratch 'F042_REL_POLAR')
  $plineState = @(Get-LayerEntities $scratch 'F042_PLINE')
  $checks = [ordered]@{
    wcsContextExact = [string]::IsNullOrWhiteSpace($wcs.ucsName) -and (Test-Point $wcs.ucsOrg @(0, 0, 0)) -and (Test-Point $wcs.ucsXdir @(1, 0, 0)) -and (Test-Point $wcs.ucsYdir @(0, 1, 0))
    absolutePlainCartesian = Test-Line $plainState $plainStart $plainEnd
    absoluteHashCartesian = Test-Line $hashState $hashStart $hashEnd
    relativeCartesian = Test-Line $relativeCartesianState $relativeStart $relativeEnd
    relativePolar = Test-Line $relativePolarState $polarStart $polarEnd
    plineAndRelativeMove = Test-Polyline $plineState @($p0, $p1, $p2)
    atomicUndoRemovedMatrix = $undone.Count -eq 0
    atomicRedoRestoredMatrix = ($redone | ConvertTo-Json -Depth 12 -Compress) -eq ($committed | ConvertTo-Json -Depth 12 -Compress)
    incompleteCommandCancelNoGeometry = ($cancelAfter | ConvertTo-Json -Depth 12 -Compress) -eq ($cancelBefore | ConvertTo-Json -Depth 12 -Compress) -and $cancel.cmdActiveAfter -eq 0 -and [string]::IsNullOrWhiteSpace($cancel.cmdNamesAfter)
    emptyCommandNoOp = ($afterNoOp | ConvertTo-Json -Depth 12 -Compress) -eq ($cancelAfter | ConvertTo-Json -Depth 12 -Compress) -and $noOp.cmdActiveAfter -eq 0 -and [string]::IsNullOrWhiteSpace($noOp.cmdNamesAfter)
  }
  Write-Host "[F-041/F-042/F-044] checks-complete pass=$(@($checks.Values | Where-Object { $_ -ne $true }).Count -eq 0)"

  $stage = 'save-dxf'
  Invoke-ComRetry { $scratch.Regen(1) } | Out-Null
  Write-Host '[F-041/F-042/F-044] regen-complete'
  Invoke-ComRetry { $scratch.SaveAs($DxfOutputPath, 65) } -TimeoutSeconds 90 | Out-Null
  Write-Host '[F-041/F-042/F-044] save-dxf-complete'
  Wait-AcadIdle $scratch

  $blocked = @(
    [ordered]@{ capability = 'directDistancePointerDirection'; rowId = 'F-044'; status = 'NOT_RUN'; reason = 'COM SendCommand can provide typed tokens but cannot establish and independently read back a live pointer direction; @distance<angle would be relative polar, not direct-distance entry.' },
    [ordered]@{ capability = 'escapeKeyCancel'; rowId = 'F-041/F-042/F-044'; status = 'NOT_RUN'; reason = 'An Escape keystroke is UI input. This matrix proves command-line blank/internal-Undo cancellation and uses no keyboard or window-message injection.' },
    [ordered]@{ capability = 'nonWorldUcsCoordinateEntry'; rowId = 'F-041/F-042'; status = 'NOT_RUN'; reason = 'The current Kuubik precision kernel is a document/world XY contract. This bounded reference pins WCS and does not claim rotated or translated UCS parity.' }
  )
  $result = [ordered]@{
    schemaVersion = 1; rowIds = @('F-041', 'F-042', 'F-044')
    benchmark = 'AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation'
    engine = 'Autodesk AutoCAD 2024 desktop COM command-line coordinate contract'
    engineVersion = [string](Invoke-ComRetry { $acad.Version }); installedUpdateIdentity = $installedUpdateIdentity
    automationProcessId = $automationProcessId; automationProcessOwned = $owned
    automationProcessIdentity = [ordered]@{
      processId = $ownedIdentity.processId; executableName = $ownedIdentity.executableName
      executableSha256 = $ownedIdentity.executableSha256; fileVersion = $ownedIdentity.fileVersion
      productVersion = $ownedIdentity.productVersion; startTimeSha256 = $ownedIdentity.startTimeSha256
    }
    observations = [ordered]@{
      coordinateContext = [ordered]@{ wcs = $wcs; insunits = [int](Invoke-ComRetry { $scratch.GetVariable('INSUNITS') }); lunits = [int](Invoke-ComRetry { $scratch.GetVariable('LUNITS') }); luprec = [int](Invoke-ComRetry { $scratch.GetVariable('LUPREC') }); aunits = [int](Invoke-ComRetry { $scratch.GetVariable('AUNITS') }); auprec = [int](Invoke-ComRetry { $scratch.GetVariable('AUPREC') }); angdir = [int](Invoke-ComRetry { $scratch.GetVariable('ANGDIR') }); angbase = [double](Invoke-ComRetry { $scratch.GetVariable('ANGBASE') }); dynmodeObserved = [int](Invoke-ComRetry { $scratch.GetVariable('DYNMODE') }); dynpicoordsObserved = [int](Invoke-ComRetry { $scratch.GetVariable('DYNPICOORDS') }); dynamicInputProfileChanged = $false }
      commands = @($plain, $hash, $relativeCartesian, $relativePolar, $pline, $move, $cancel, $noOp)
      plineBeforeMove = $plineBeforeMove; committed = $committed; undone = $undone; redone = $redone
      afterCancel = $cancelAfter; afterNoOp = $afterNoOp; blocked = $blocked
    }
    checks = $checks; dxfOutputSha256 = Get-FileSha256 $DxfOutputPath
    cmdNamesAfter = [string](Invoke-ComRetry { $scratch.GetVariable('CMDNAMES') })
    userDocument = [ordered]@{
      isolatedOwnedProcess = $owned; preExistingProcessCount = $preExistingProcessIds.Count
      initialOwnedDocumentCount = $initialOwnedDocumentCount
      scratchBlankVerified = [string]::IsNullOrWhiteSpace($scratchFullNameBefore)
      scratchPathAfterSave = $DxfOutputPath; userDocumentTouched = $false
    }
    status = if (@($checks.Values | Where-Object { $_ -ne $true }).Count -eq 0) { 'PARTIAL' } else { 'FAIL' }
  }
} catch {
  throw "F-041/F-042/F-044 AutoCAD stage '$stage' failed at script line $($_.InvocationInfo.ScriptLineNumber): $($_.Exception.Message)"
} finally {
  if ($acad -and -not $owned) {
    try {
      [uint32]$finallyProcessId = 0
      [void][F041F044WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry { $acad.HWND }), [ref]$finallyProcessId)
      if ([int]$finallyProcessId -gt 0 -and $preExistingProcessIds -notcontains [int]$finallyProcessId) {
        $automationProcessId = [int]$finallyProcessId; $ownedIdentity = Write-OwnedPidSidecar $automationProcessId; $owned = $true
      }
    } catch {}
  }
  if ($scratch) { try { Invoke-ComRetry { $scratch.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
  if ($owned -and $acad) { try { Invoke-ComRetry { $acad.Quit() } -TimeoutSeconds 10 | Out-Null } catch {} }
}

if (-not $result) { throw 'F-041/F-042/F-044 AutoCAD matrix produced no result.' }
$result | ConvertTo-Json -Depth 20
if ($result.status -eq 'FAIL') { exit 1 }
