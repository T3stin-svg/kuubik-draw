param(
  [Parameter(Mandatory = $true)][string]$TempDwgPath,
  [Parameter(Mandatory = $true)][string]$PidPath,
  [Parameter(Mandatory = $true)][string]$OwnershipToken
)

$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class F101WindowProcess {
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
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
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Action,
    [Parameter(Mandatory = $true)][string]$Label,
    [int]$TimeoutSeconds = 20
  )
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    try {
      $value = & $Action
      if ($null -ne $value) { return $value }
    } catch {
      if ([DateTime]::UtcNow -ge $deadline) { throw }
    }
    if ([DateTime]::UtcNow -ge $deadline) { throw "F-101 $Label remained null for $TimeoutSeconds seconds." }
    Start-Sleep -Milliseconds 150
  } while ($true)
}

function Wait-AcadIdle {
  param([Parameter(Mandatory = $true)]$Document, [int]$TimeoutSeconds = 30)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 100
    try {
      if ([string]::IsNullOrWhiteSpace([string]$Document.GetVariable('CMDNAMES')) -and [int]$Document.GetVariable('CMDACTIVE') -eq 0) { return }
    } catch {}
  } while ([DateTime]::UtcNow -lt $deadline)
  $commands = try { [string]$Document.GetVariable('CMDNAMES') } catch { '' }
  $prompt = try { [string]$Document.GetVariable('LASTPROMPT') } catch { '' }
  throw "AutoCAD did not return idle for F-101. CMDNAMES='$commands' LASTPROMPT='$prompt'"
}

function Send-AcadCommand {
  param([Parameter(Mandatory = $true)]$Document, [Parameter(Mandatory = $true)][string]$Command)
  Invoke-ComRetry { $Document.SendCommand($Command) } | Out-Null
  Wait-AcadIdle $Document
}

function Get-Sha256 {
  param([Parameter(Mandatory = $true)][string]$Path)
  $stream = [IO.File]::OpenRead($Path)
  try {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
  } finally { $stream.Dispose() }
}

function Get-Point2 {
  param($Value)
  return [ordered]@{ x = [double]$Value[0]; y = [double]$Value[1] }
}

function Get-ViewportState {
  param([Parameter(Mandatory = $true)]$Document, [Parameter(Mandatory = $true)][string]$Handle)
  $viewport = Invoke-NonNullCom { $Document.HandleToObject($Handle) } "viewport handle $Handle"
  return [ordered]@{
    handle = [string](Invoke-ComRetry { $viewport.Handle })
    objectName = [string](Invoke-ComRetry { $viewport.ObjectName })
    target = Get-Point2 (Invoke-NonNullCom { $viewport.Target } "viewport $Handle target")
    viewCenter = Get-Point2 (Invoke-NonNullCom { $Document.GetVariable('VIEWCTR') } 'VIEWCTR')
    viewHeight = [double](Invoke-ComRetry { $Document.GetVariable('VIEWSIZE') })
    customScale = [double](Invoke-ComRetry { $viewport.CustomScale })
    twistAngleRad = [double](Invoke-ComRetry { $viewport.TwistAngle })
    displayLocked = [bool](Invoke-ComRetry { $viewport.DisplayLocked })
    viewportOn = [bool](Invoke-ComRetry { $viewport.ViewportOn })
    mSpace = [bool](Invoke-ComRetry { $Document.MSpace })
    cvport = [int](Invoke-ComRetry { $Document.GetVariable('CVPORT') })
  }
}

function Get-LineState {
  param([Parameter(Mandatory = $true)]$Document, [Parameter(Mandatory = $true)][string]$Handle)
  $line = Invoke-ComRetry { $Document.HandleToObject($Handle) }
  return [ordered]@{
    handle = [string](Invoke-ComRetry { $line.Handle })
    start = Get-Point2 (Invoke-ComRetry { $line.StartPoint })
    end = Get-Point2 (Invoke-ComRetry { $line.EndPoint })
  }
}

function Enter-ViewportModel {
  param([Parameter(Mandatory = $true)]$Document, [Parameter(Mandatory = $true)]$Viewport)
  Invoke-ComRetry {
    $Viewport.Display($true)
    $Document.MSpace = $true
    $Document.ActivePViewport = $Viewport
    $Document.Regen(1)
  } | Out-Null
  Start-Sleep -Milliseconds 250
}

function Same-Camera {
  param($A, $B, [double]$Tolerance = 0.00000001)
  return [Math]::Abs([double]$A.target.x - [double]$B.target.x) -le $Tolerance -and
    [Math]::Abs([double]$A.target.y - [double]$B.target.y) -le $Tolerance -and
    [Math]::Abs([double]$A.viewCenter.x - [double]$B.viewCenter.x) -le $Tolerance -and
    [Math]::Abs([double]$A.viewCenter.y - [double]$B.viewCenter.y) -le $Tolerance -and
    [Math]::Abs([double]$A.viewHeight - [double]$B.viewHeight) -le $Tolerance -and
    [Math]::Abs([double]$A.customScale - [double]$B.customScale) -le $Tolerance -and
    [Math]::Abs([double]$A.twistAngleRad - [double]$B.twistAngleRad) -le $Tolerance
}

$preExistingProcessIds = @(Get-Process -Name 'acad' -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.Id })
$acad = $null; $scratch = $null; $reopened = $null; $result = $null; $automationProcessId = 0; $owned = $false; $automationProcessIdentity = $null
$tempDwg = [IO.Path]::GetFullPath($TempDwgPath)
$pidFile = [IO.Path]::GetFullPath($PidPath)
try {
  $acad = New-Object -ComObject AutoCAD.Application.24.3
  Invoke-ComRetry { $acad.Visible = $true; $acad.WindowState = 3 } | Out-Null
  [uint32]$resolvedProcessId = 0
  [void][F101WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry { $acad.HWND }), [ref]$resolvedProcessId)
  $automationProcessId = [int]$resolvedProcessId
  $owned = $automationProcessId -gt 0 -and $preExistingProcessIds -notcontains $automationProcessId
  $engineVersion = [string](Invoke-ComRetry { $acad.Version })
  Write-Host "[F-101] automation-process pid=$automationProcessId owned=$owned"
  if (-not $owned) { throw 'F-101 refuses to use a pre-existing AutoCAD process.' }
  $automationProcess = Get-Process -Id $automationProcessId -ErrorAction Stop
  $automationExecutablePath = [IO.Path]::GetFullPath([string]$automationProcess.Path)
  if ([IO.Path]::GetFileName($automationExecutablePath) -ine 'acad.exe') { throw "F-101 PID $automationProcessId is not acad.exe." }
  $automationProcessIdentity = [ordered]@{
    processId = $automationProcessId
    executablePath = $automationExecutablePath
    startTimeUtc = $automationProcess.StartTime.ToUniversalTime().ToString('o')
  }
  [ordered]@{ schemaVersion = 1; processId = $automationProcessId; executablePath = $automationProcessIdentity.executablePath; startTimeUtc = $automationProcessIdentity.startTimeUtc; owned = $true; token = $OwnershipToken } |
    ConvertTo-Json -Compress | Set-Content -LiteralPath $pidFile -Encoding ascii

  $scratch = if ([int](Invoke-ComRetry { $acad.Documents.Count }) -gt 0) { Invoke-ComRetry { $acad.ActiveDocument } } else { Invoke-ComRetry { $acad.Documents.Add() } }
  if ([string](Invoke-ComRetry { $scratch.FullName }) -or [int](Invoke-ComRetry { $scratch.ModelSpace.Count }) -ne 0) { throw 'F-101 refuses a saved or non-blank drawing.' }
  Invoke-ComRetry { $scratch.Activate() } | Out-Null
  Wait-AcadIdle $scratch
  $papers = @(Invoke-ComRetry { @($scratch.Layouts | Where-Object { [string]$_.Name -ne 'Model' } | Sort-Object TabOrder) } -TimeoutSeconds 30)
  if ($papers.Count -lt 1) { throw 'F-101 QNEW did not provide a paper layout.' }
  $paper = $papers[0]
  foreach ($extra in @($papers | Select-Object -Skip 1)) { Invoke-ComRetry { $extra.Delete() } | Out-Null }
  Invoke-ComRetry { $paper.Name = 'F101 LOCK'; $scratch.ActiveLayout = $paper; $scratch.ActiveSpace = 0; $scratch.MSpace = $false } | Out-Null

  [double[]]$lineStart = @(0, 0, 0); [double[]]$lineEnd = @(1000, 0, 0)
  $line = Invoke-ComRetry { $scratch.ModelSpace.AddLine($lineStart, $lineEnd) }
  $lineHandle = [string](Invoke-ComRetry { $line.Handle })
  [double[]]$viewportCenter = @(150, 100, 0); [double[]]$initialTarget = @(0, 0, 0)
  $viewport = Invoke-ComRetry { $scratch.PaperSpace.AddPViewport($viewportCenter, 200, 100) }
  $viewportHandle = [string](Invoke-ComRetry { $viewport.Handle })
  Invoke-ComRetry {
    $viewport.Display($true)
    $viewport.Target = $initialTarget
    $viewport.CustomScale = 0.1
    $viewport.TwistAngle = 0
    $viewport.DisplayLocked = $false
    $scratch.Regen(1)
  } | Out-Null
  # A newly added PViewport does not expose a stable Target through COM until
  # AutoCAD has activated it once.
  Enter-ViewportModel $scratch $viewport
  $initial = Get-ViewportState $scratch $viewportHandle
  Write-Host '[F-101] initial viewport ready'

  Invoke-ComRetry { $viewport.DisplayLocked = $true; $scratch.Regen(1) } | Out-Null
  Enter-ViewportModel $scratch $viewport
  $locked = Get-ViewportState $scratch $viewportHandle
  Write-Host '[F-101] locked zoom'
  Send-AcadCommand $scratch "_.ZOOM`n_C`n500,250`n500`n"
  $afterLockedZoom = Get-ViewportState $scratch $viewportHandle
  Enter-ViewportModel $scratch $viewport
  Write-Host '[F-101] locked pan'
  Send-AcadCommand $scratch "_.-PAN`n0,0`n100,50`n"
  $afterLockedPan = Get-ViewportState $scratch $viewportHandle
  Enter-ViewportModel $scratch $viewport
  Write-Host '[F-101] locked model edit'
  Send-AcadCommand $scratch "(progn (command `"_.MOVE`" (handent `"$lineHandle`") `"`" `"0,0`" `"100,50`") (princ))`n"
  $afterLockedEdit = Get-LineState $scratch $lineHandle
  $afterLockedEditViewport = Get-ViewportState $scratch $viewportHandle

  Invoke-ComRetry { $scratch.MSpace = $false; $viewport.DisplayLocked = $false; $scratch.Regen(1) } | Out-Null
  Enter-ViewportModel $scratch $viewport
  $unlocked = Get-ViewportState $scratch $viewportHandle
  Write-Host '[F-101] unlocked zoom'
  Send-AcadCommand $scratch "_.ZOOM`n_C`n500,250`n500`n"
  $afterUnlockedZoom = Get-ViewportState $scratch $viewportHandle
  Enter-ViewportModel $scratch $viewport
  Write-Host '[F-101] unlocked pan'
  Send-AcadCommand $scratch "_.-PAN`n0,0`n100,50`n"
  $afterUnlockedPan = Get-ViewportState $scratch $viewportHandle

  Invoke-ComRetry { $scratch.MSpace = $false; $viewport.DisplayLocked = $true; $scratch.Regen(1) } | Out-Null
  Enter-ViewportModel $scratch $viewport
  $relocked = Get-ViewportState $scratch $viewportHandle
  Write-Host '[F-101] save reopen'
  Invoke-ComRetry { $scratch.MSpace = $false; $scratch.Regen(1) } | Out-Null
  Invoke-ComRetry { $scratch.SaveAs($tempDwg, 64) } | Out-Null
  Invoke-ComRetry { $scratch.Close($false) } | Out-Null
  $scratch = $null
  $dwgInfo = Get-Item -LiteralPath $tempDwg
  $dwgBytes = [long]$dwgInfo.Length
  $dwgSha256 = Get-Sha256 $tempDwg
  $reopened = Invoke-ComRetry { $acad.Documents.Open($tempDwg) }
  Invoke-ComRetry { $reopened.Activate() } | Out-Null
  Wait-AcadIdle $reopened
  $reopenedPaper = Invoke-ComRetry { $reopened.Layouts.Item('F101 LOCK') }
  Invoke-ComRetry { $reopened.ActiveLayout = $reopenedPaper; $reopened.ActiveSpace = 0; $reopened.MSpace = $false; $reopened.Regen(1) } | Out-Null
  $reopenedViewport = Invoke-ComRetry { $reopened.HandleToObject($viewportHandle) }
  Enter-ViewportModel $reopened $reopenedViewport
  $afterReopen = Get-ViewportState $reopened $viewportHandle
  $lineAfterReopen = Get-LineState $reopened $lineHandle
  Invoke-ComRetry { $reopened.MSpace = $false; $reopened.Regen(1) } | Out-Null
  $afterReopenPaper = [ordered]@{ mSpace = [bool](Invoke-ComRetry { $reopened.MSpace }); cvport = [int](Invoke-ComRetry { $reopened.GetVariable('CVPORT') }) }

  $checks = [ordered]@{
    nativeViewport = $initial.objectName -eq 'AcDbViewport' -and $initial.viewportOn -and $initial.handle -eq $viewportHandle
    defaultUnlocked = -not $initial.displayLocked
    lockEntersModel = $locked.displayLocked -and $locked.mSpace -and $locked.cvport -gt 1
    lockedZoomSuppressed = $afterLockedZoom.displayLocked -and (Same-Camera $locked $afterLockedZoom)
    lockedPanSuppressed = $afterLockedPan.displayLocked -and (Same-Camera $locked $afterLockedPan)
    modelEditAllowedWhileLocked = $afterLockedEdit.start.x -eq 100 -and $afterLockedEdit.start.y -eq 50 -and $afterLockedEdit.end.x -eq 1100 -and $afterLockedEdit.end.y -eq 50 -and $afterLockedEditViewport.displayLocked
    unlockedState = -not $unlocked.displayLocked
    unlockedZoomChangesView = -not (Same-Camera $unlocked $afterUnlockedZoom)
    unlockedPanChangesView = -not (Same-Camera $afterUnlockedZoom $afterUnlockedPan)
    relockedState = $relocked.displayLocked -and (Same-Camera $afterUnlockedPan $relocked)
    nativeDwgReopen = $afterReopen.handle -eq $viewportHandle -and $afterReopen.objectName -eq 'AcDbViewport' -and $afterReopen.viewportOn
    lockAndCameraPersisted = $afterReopen.displayLocked -and (Same-Camera $relocked $afterReopen)
    modelEditPersisted = $lineAfterReopen.handle -eq $lineHandle -and $lineAfterReopen.start.x -eq 100 -and $lineAfterReopen.start.y -eq 50 -and $lineAfterReopen.end.x -eq 1100 -and $lineAfterReopen.end.y -eq 50
    paperAfterReopen = -not $afterReopenPaper.mSpace -and $afterReopenPaper.cvport -eq 1
  }
  $status = if (@($checks.Values | Where-Object { $_ -ne $true }).Count -eq 0) { 'PASS' } else { 'FAIL' }
  $result = [ordered]@{
    schemaVersion = 1; rowId = 'F-101'; benchmark = 'AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation'
    engine = 'Autodesk AutoCAD 2024 desktop COM/native PViewport commands'; engineVersion = $engineVersion
    automationProcessId = $automationProcessId; automationProcessOwned = $owned; automationProcessIdentity = $automationProcessIdentity
    handles = [ordered]@{ viewport = $viewportHandle; modelLine = $lineHandle }
    initial = $initial; locked = $locked; afterLockedZoom = $afterLockedZoom; afterLockedPan = $afterLockedPan
    afterLockedEdit = [ordered]@{ line = $afterLockedEdit; viewport = $afterLockedEditViewport }
    unlocked = $unlocked; afterUnlockedZoom = $afterUnlockedZoom; afterUnlockedPan = $afterUnlockedPan
    relocked = $relocked; afterReopen = $afterReopen; afterReopenPaper = $afterReopenPaper; lineAfterReopen = $lineAfterReopen; checks = $checks
    dwg = [ordered]@{ bytes = $dwgBytes; sha256 = $dwgSha256; saveAsType = 64; retained = $false }
    status = $status
  }
} catch {
  Write-Error ("F-101 failure at {0}: {1}" -f $_.InvocationInfo.PositionMessage, $_.Exception.Message)
  throw
} finally {
  if ($reopened) { try { Invoke-ComRetry { $reopened.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
  if ($scratch) { try { Invoke-ComRetry { $scratch.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
  if (Test-Path -LiteralPath $tempDwg) { Remove-Item -LiteralPath $tempDwg -Force }
  if ($owned -and $acad) { try { Invoke-ComRetry { $acad.Quit() } -TimeoutSeconds 10 | Out-Null } catch {} }
}

if (-not $result) { throw 'F-101 AutoCAD matrix produced no result.' }
$result.userDocument = [ordered]@{ isolatedOwnedProcess = $owned; blankRestored = $owned }
$finalStatus = $result.status
$result | ConvertTo-Json -Depth 14
if ($finalStatus -ne 'PASS') { exit 1 }
