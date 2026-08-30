param(
  [Parameter(Mandatory = $true)][string]$PidPath,
  [Parameter(Mandatory = $true)][string]$OwnershipToken,
  [Parameter(Mandatory = $true)][string]$DxfOutputPath,
  [Parameter(Mandatory = $true)][string]$EscapeHelperPath
)

$ErrorActionPreference = 'Stop'
$DxfOutputPath = [IO.Path]::GetFullPath($DxfOutputPath)
if ([IO.Path]::GetExtension($DxfOutputPath) -ine '.dxf' -or (Test-Path -LiteralPath $DxfOutputPath)) { throw 'F-025 DXF output must be a new .dxf path.' }
$EscapeHelperPath = [IO.Path]::GetFullPath($EscapeHelperPath)
if (-not (Test-Path -LiteralPath $EscapeHelperPath -PathType Leaf)) { throw 'F-025 Escape helper path does not exist.' }

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class F025WindowProcess {
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
  public static IntPtr FindModelViewport(IntPtr root, int expectedWidth, int expectedHeight) {
    IntPtr result = IntPtr.Zero; double bestScore = double.MaxValue; long bestArea = 0;
    EnumChildWindows(root, delegate(IntPtr child, IntPtr unused) {
      var className = new System.Text.StringBuilder(256); GetClassName(child, className, className.Capacity);
      if (className.ToString() != "ACADDM_CHILD_DXGI_FLIP_MODE_VIEW_CLASS") return true;
      RECT rect; if (!GetWindowRect(child, out rect)) return true;
      int width = rect.Right - rect.Left; int height = rect.Bottom - rect.Top; if (width <= 0 || height <= 0) return true;
      long area = (long)width * height; double expectedAspect = expectedHeight > 0 ? (double)expectedWidth / expectedHeight : 0; double aspect = (double)width / height;
      double score = Math.Abs(aspect - expectedAspect) + Math.Abs(width - expectedWidth) / (double)Math.Max(1, expectedWidth) + Math.Abs(height - expectedHeight) / (double)Math.Max(1, expectedHeight);
      if (score < bestScore || (Math.Abs(score - bestScore) < 0.000001 && area > bestArea)) { bestScore = score; bestArea = area; result = child; }
      return true;
    }, IntPtr.Zero);
    return result;
  }
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

function Wait-AcadIdle {
  param([Parameter(Mandatory = $true)]$Document, [int]$TimeoutSeconds = 45)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 100
    try { if ([string]::IsNullOrWhiteSpace([string]$Document.GetVariable('CMDNAMES')) -and [int]$Document.GetVariable('CMDACTIVE') -eq 0) { return } } catch {}
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "AutoCAD did not return idle. CMDNAMES='$($Document.GetVariable('CMDNAMES'))' LASTPROMPT='$($Document.GetVariable('LASTPROMPT'))'"
}

function Wait-AcadCommandMarker {
  param([Parameter(Mandatory = $true)]$Document, [Parameter(Mandatory = $true)][string]$Marker, [int]$TimeoutSeconds = 45)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 100
    try { if ([string]$Document.GetVariable('USERS1') -eq $Marker) { Wait-AcadIdle $Document $TimeoutSeconds; return } } catch {}
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "AutoCAD did not complete marker '$Marker'. CMDNAMES='$($Document.GetVariable('CMDNAMES'))' LASTPROMPT='$($Document.GetVariable('LASTPROMPT'))'"
}

function Write-Stage {
  param([Parameter(Mandatory = $true)][string]$Name)
  Write-Host "[F-025] stage=$Name"
}

function Get-StringSha256 { param([string]$Value); $algorithm = [Security.Cryptography.SHA256]::Create(); try { return ([BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value))).Replace('-', '').ToLowerInvariant()) } finally { $algorithm.Dispose() } }
function Get-FileSha256 { param([string]$Path); $algorithm = [Security.Cryptography.SHA256]::Create(); $stream = [IO.File]::OpenRead($Path); try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()) } finally { $stream.Dispose(); $algorithm.Dispose() } }

function Get-OwnedAcadIdentity {
  param([int]$ProcessId)
  $process = Get-Process -Id $ProcessId -ErrorAction Stop
  $path = [IO.Path]::GetFullPath([string]$process.Path)
  if ([IO.Path]::GetFileName($path) -ine 'acad.exe') { throw "F-025 PID $ProcessId is not acad.exe." }
  $startTimeUtc = $process.StartTime.ToUniversalTime().ToString('o'); $version = (Get-Item -LiteralPath $path -ErrorAction Stop).VersionInfo
  return [ordered]@{ processId = $ProcessId; executablePath = $path; executableName = [IO.Path]::GetFileName($path); executableSha256 = Get-FileSha256 $path; fileVersion = [string]$version.FileVersion; productVersion = [string]$version.ProductVersion; startTimeUtc = $startTimeUtc; startTimeSha256 = Get-StringSha256 $startTimeUtc }
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
function Convert-FlatPoints { param($Values); $flat = @($Values); $points = @(); for ($index = 0; $index + 1 -lt $flat.Count; $index += 2) { $points += ,@([double]$flat[$index], [double]$flat[$index + 1]) }; return @($points) }
function Format-InvariantNumber { param([double]$Value); return [string]::Format([Globalization.CultureInfo]::InvariantCulture, '{0:R}', $Value) }

function Get-ModelScreenPoint {
  param($Document, [IntPtr]$ViewportHandle, [double]$WorldX, [double]$WorldY)
  $rect = New-Object F025WindowProcess+RECT
  if (-not [F025WindowProcess]::GetWindowRect($ViewportHandle, [ref]$rect)) { throw 'F-025 could not read the AutoCAD model viewport rectangle.' }
  $screenSize = @(Invoke-NonNullCom { $Document.GetVariable('SCREENSIZE') } 'SCREENSIZE'); $viewCenter = @(Invoke-NonNullCom { $Document.GetVariable('VIEWCTR') } 'VIEWCTR'); $viewHeight = [double](Invoke-NonNullCom { $Document.GetVariable('VIEWSIZE') } 'VIEWSIZE')
  $viewportWidth = $rect.Right - $rect.Left; $viewportHeight = $rect.Bottom - $rect.Top
  if ($screenSize.Count -lt 2 -or $viewCenter.Count -lt 2 -or $viewportWidth -ne [int][Math]::Round([double]$screenSize[0]) -or $viewportHeight -ne [int][Math]::Round([double]$screenSize[1]) -or -not ($viewHeight -gt 0)) { throw "F-025 viewport/SCREENSIZE mismatch: rect=$viewportWidth x $viewportHeight screen=$($screenSize -join 'x') viewHeight=$viewHeight" }
  $pixelsPerWorldUnit = [double]$screenSize[1] / $viewHeight
  return [ordered]@{ x = [int][Math]::Round($rect.Left + [double]$screenSize[0] / 2 + ($WorldX - [double]$viewCenter[0]) * $pixelsPerWorldUnit); y = [int][Math]::Round($rect.Top + [double]$screenSize[1] / 2 - ($WorldY - [double]$viewCenter[1]) * $pixelsPerWorldUnit) }
}

function Get-EntityState {
  param($Entity)
  $objectName = [string](Invoke-ComRetry { $Entity.ObjectName }); $details = [ordered]@{}
  switch ($objectName) {
    'AcDbLine' { $details.start = Get-Point2 (Invoke-ComRetry { $Entity.StartPoint }); $details.end = Get-Point2 (Invoke-ComRetry { $Entity.EndPoint }) }
    'AcDbRay' { $details.basePoint = Get-Point2 (Invoke-ComRetry { $Entity.BasePoint }); $details.secondPoint = Get-Point2 (Invoke-ComRetry { $Entity.SecondPoint }) }
    'AcDbXline' { $details.basePoint = Get-Point2 (Invoke-ComRetry { $Entity.BasePoint }); $details.secondPoint = Get-Point2 (Invoke-ComRetry { $Entity.SecondPoint }) }
    'AcDbPolyline' {
      $details.vertices = Convert-FlatPoints (Invoke-ComRetry { $Entity.Coordinates }); $details.closed = [bool](Invoke-ComRetry { $Entity.Closed }); $details.bulges = @()
      for ($index = 0; $index -lt $details.vertices.Count; $index += 1) { $details.bulges += [double](Invoke-ComRetry { $Entity.GetBulge($index) }) }
    }
  }
  return [ordered]@{
    objectName = $objectName
    handle = [string](Invoke-ComRetry { $Entity.Handle })
    layer = [string](Invoke-ComRetry { $Entity.Layer })
    color = [int](Invoke-ComRetry { $Entity.Color })
    lineweight = [int](Invoke-ComRetry { $Entity.Lineweight })
    linetype = [string](Invoke-ComRetry { $Entity.Linetype })
    transparency = [string](Invoke-ComRetry { $Entity.EntityTransparency })
    details = $details
  }
}

function Get-LayerStates {
  param($Document, [string]$Layer)
  $states = @(); $count = [int](Invoke-ComRetry { $Document.ModelSpace.Count })
  for ($index = 0; $index -lt $count; $index += 1) {
    $entity = Invoke-ComRetry { $Document.ModelSpace.Item($index) }
    if ([string](Invoke-ComRetry { $entity.Layer }) -ne $Layer) { continue }
    try { $states += Get-EntityState $entity } catch { if ($_.Exception.Message -notmatch 'null|erased') { throw } }
  }
  return @($states)
}

function New-Line {
  param($Document, [string]$Layer, [double]$StartX, [double]$StartY, [double]$EndX, [double]$EndY)
  [double[]]$start = @($StartX, $StartY, 0); [double[]]$end = @($EndX, $EndY, 0)
  $entity = Invoke-ComRetry { $Document.ModelSpace.AddLine($start, $end) }; Invoke-ComRetry { $entity.Layer = $Layer; $entity.Color = 1; $entity.Lineweight = 50 } | Out-Null
  return $entity
}

function New-Ray {
  param($Document, [string]$Layer, [double]$BaseX, [double]$BaseY, [double]$SecondX, [double]$SecondY)
  [double[]]$base = @($BaseX, $BaseY, 0); [double[]]$second = @($SecondX, $SecondY, 0)
  $entity = Invoke-ComRetry { $Document.ModelSpace.AddRay($base, $second) }; Invoke-ComRetry { $entity.Layer = $Layer; $entity.Color = 1; $entity.Lineweight = 50 } | Out-Null
  return $entity
}

function New-Xline {
  param($Document, [string]$Layer, [double]$BaseX, [double]$BaseY, [double]$SecondX, [double]$SecondY)
  [double[]]$base = @($BaseX, $BaseY, 0); [double[]]$second = @($SecondX, $SecondY, 0)
  $entity = Invoke-ComRetry { $Document.ModelSpace.AddXline($base, $second) }; Invoke-ComRetry { $entity.Layer = $Layer; $entity.Color = 1; $entity.Lineweight = 50 } | Out-Null
  return $entity
}

function New-Polyline {
  param($Document, [string]$Layer, [double[]]$Coordinates, [bool]$Closed = $false)
  $entity = Invoke-ComRetry { $Document.ModelSpace.AddLightWeightPolyline($Coordinates) }; Invoke-ComRetry { $entity.Layer = $Layer; $entity.Color = 1; $entity.Lineweight = 50; $entity.Closed = $Closed } | Out-Null
  return $entity
}

function Invoke-ChamferPair {
  param($Document, $First, [double]$FirstX, [double]$FirstY, $Second, [double]$SecondX, [double]$SecondY, [string]$Method, [double]$FirstDistance, [double]$SecondDistanceOrAngle, [bool]$Trim = $true)
  $firstHandle = [string](Invoke-ComRetry { $First.Handle }); $secondHandle = [string](Invoke-ComRetry { $Second.Handle }); $trimMode = if ($Trim) { 1 } else { 0 }
  $firstSelection = "(list (handent `"$firstHandle`") (list $FirstX $FirstY 0.0))"
  $secondSelection = "(list (handent `"$secondHandle`") (list $SecondX $SecondY 0.0))"
  $marker = [Guid]::NewGuid().ToString('N')
  $firstValue = Format-InvariantNumber $FirstDistance; $secondValue = Format-InvariantNumber $SecondDistanceOrAngle
  $setting = if ($Method -eq 'angle') { "(setvar `"CHAMMODE`" 1) (setvar `"CHAMFERC`" $firstValue) (setvar `"CHAMFERD`" (* pi $([string]::Format([Globalization.CultureInfo]::InvariantCulture, '{0:R}', ($SecondDistanceOrAngle / 180.0)))))" } else { "(setvar `"CHAMMODE`" 0) (setvar `"CHAMFERA`" $firstValue) (setvar `"CHAMFERB`" $secondValue)" }
  $lisp = "(progn $setting (setvar `"TRIMMODE`" $trimMode) (command `"_.CHAMFER`" $firstSelection $secondSelection) (setvar `"USERS1`" `"$marker`") (princ))`n"
  Write-Host "[F-025] pair-settings method=$Method mode=$([int](Invoke-ComRetry { $Document.GetVariable('CHAMMODE') })) beforeA=$([double](Invoke-ComRetry { $Document.GetVariable('CHAMFERA') })) beforeB=$([double](Invoke-ComRetry { $Document.GetVariable('CHAMFERB') }))"
  Invoke-ComRetry { $Document.SendCommand($lisp) } | Out-Null; Wait-AcadCommandMarker $Document $marker; Invoke-ComRetry { $Document.Regen(1) } | Out-Null; Start-Sleep -Milliseconds 300
  Write-Host "[F-025] pair-after method=$Method mode=$([int](Invoke-ComRetry { $Document.GetVariable('CHAMMODE') })) A=$([double](Invoke-ComRetry { $Document.GetVariable('CHAMFERA') })) B=$([double](Invoke-ComRetry { $Document.GetVariable('CHAMFERB') })) C=$([double](Invoke-ComRetry { $Document.GetVariable('CHAMFERC') })) D=$([double](Invoke-ComRetry { $Document.GetVariable('CHAMFERD') })) trim=$([int](Invoke-ComRetry { $Document.GetVariable('TRIMMODE') }))"
}

function Invoke-ChamferMultiple {
  param($Document, [object[]]$Pairs, [double]$FirstDistance, [double]$SecondDistance, [bool]$Trim = $true, [bool]$UndoLast = $false)
  $trimMode = if ($Trim) { 1 } else { 0 }; $selections = @(); $marker = [Guid]::NewGuid().ToString('N')
  foreach ($pair in $Pairs) {
    $firstHandle = [string](Invoke-ComRetry { $pair.first.Handle }); $secondHandle = [string](Invoke-ComRetry { $pair.second.Handle })
    $selections += "(list (handent `"$firstHandle`") (list $($pair.firstX) $($pair.firstY) 0.0))"
    $selections += "(list (handent `"$secondHandle`") (list $($pair.secondX) $($pair.secondY) 0.0))"
  }
  $firstValue = Format-InvariantNumber $FirstDistance; $secondValue = Format-InvariantNumber $SecondDistance
  $ending = if ($UndoLast) { ' "_Undo" ""' } else { ' ""' }
  $lisp = "(progn (setvar `"CHAMMODE`" 0) (setvar `"CHAMFERA`" $firstValue) (setvar `"CHAMFERB`" $secondValue) (setvar `"TRIMMODE`" $trimMode) (command `"_.CHAMFER`" `"_Multiple`" $($selections -join ' ')$ending) (setvar `"USERS1`" `"$marker`") (princ))`n"
  Invoke-ComRetry { $Document.SendCommand($lisp) } | Out-Null; Wait-AcadCommandMarker $Document $marker; Invoke-ComRetry { $Document.Regen(1) } | Out-Null; Start-Sleep -Milliseconds 300
}

function Invoke-ChamferPolyline {
  param($Document, $Polyline, [double]$FirstDistance, [double]$SecondDistance, [bool]$Trim = $true)
  $handle = [string](Invoke-ComRetry { $Polyline.Handle }); $trimMode = if ($Trim) { 1 } else { 0 }; $marker = [Guid]::NewGuid().ToString('N')
  $firstValue = Format-InvariantNumber $FirstDistance; $secondValue = Format-InvariantNumber $SecondDistance
  $lisp = "(progn (setvar `"CHAMMODE`" 0) (setvar `"CHAMFERA`" $firstValue) (setvar `"CHAMFERB`" $secondValue) (setvar `"TRIMMODE`" $trimMode) (command `"_.CHAMFER`" `"_Polyline`" (handent `"$handle`")) (setvar `"USERS1`" `"$marker`") (princ))`n"
  Invoke-ComRetry { $Document.SendCommand($lisp) } | Out-Null; Wait-AcadCommandMarker $Document $marker; Invoke-ComRetry { $Document.Regen(1) } | Out-Null; Start-Sleep -Milliseconds 300
}

function Stop-InputHelper {
  param($Process, [string]$Label)
  if ($null -eq $Process) { return }
  $processId = [int]$Process.Id; $Process.Refresh()
  if (-not $Process.HasExited) {
    Stop-Process -Id $processId -Force -ErrorAction Stop
    if (-not $Process.WaitForExit(5000)) { throw "$Label PID $processId did not terminate after Stop-Process." }
  }
  if (Get-Process -Id $processId -ErrorAction SilentlyContinue) { throw "$Label PID $processId remains alive after cleanup." }
}

function Invoke-ChamferPhysicalPair {
  param(
    $Acad, $Document, [int]$ProcessId, [string]$HelperPath,
    [double]$FirstX, [double]$FirstY, [double]$SecondX, [double]$SecondY,
    [double]$ViewMinX, [double]$ViewMinY, [double]$ViewMaxX, [double]$ViewMaxY,
    [double]$FirstDistance, [double]$SecondDistance, [bool]$Trim = $true, [bool]$ShiftSecond = $false
  )
  [double[]]$lower = @($ViewMinX, $ViewMinY, 0); [double[]]$upper = @($ViewMaxX, $ViewMaxY, 0)
  Invoke-ComRetry { $Acad.ZoomWindow($lower, $upper) } | Out-Null; Start-Sleep -Milliseconds 500
  $screenSize = @((Invoke-NonNullCom { $Document.GetVariable('SCREENSIZE') } 'SCREENSIZE') | ForEach-Object { [int][Math]::Round([double]$_) })
  $viewportHandle = [F025WindowProcess]::FindModelViewport([IntPtr][int64](Invoke-ComRetry { $Acad.HWND }), $screenSize[0], $screenSize[1])
  if ($viewportHandle -eq [IntPtr]::Zero) { throw 'F-025 could not find the AutoCAD DXGI model viewport.' }
  $firstScreen = Get-ModelScreenPoint $Document $viewportHandle $FirstX $FirstY; $secondScreen = Get-ModelScreenPoint $Document $viewportHandle $SecondX $SecondY
  Write-Host "[F-025] physical-pair-screen first=$($firstScreen.x),$($firstScreen.y) second=$($secondScreen.x),$($secondScreen.y)"
  $trimMode = if ($Trim) { 1 } else { 0 }
  Invoke-ComRetry { $Document.SetVariable('CHAMMODE', 0); $Document.SetVariable('CHAMFERA', $FirstDistance); $Document.SetVariable('CHAMFERB', $SecondDistance); $Document.SetVariable('TRIMMODE', $trimMode) } | Out-Null
  $helpers = @(); $ownedWindow = [string][int64](Invoke-ComRetry { $Acad.HWND })
  try {
    foreach ($pick in @(
      [ordered]@{ action = 'Click'; point = $firstScreen; delay = 1000 },
      [ordered]@{ action = if ($ShiftSecond) { 'ShiftClick' } else { 'Click' }; point = $secondScreen; delay = 2500 },
      [ordered]@{ action = 'Escape'; point = [ordered]@{ x = -1; y = -1 }; delay = 6000 }
    )) {
      $helpers += [ordered]@{ action = $pick.action; process = (Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$HelperPath,'-MainWindowHandle',$ownedWindow,'-ExpectedProcessId',([string]$ProcessId),'-Action',$pick.action,'-ScreenX',([string]$pick.point.x),'-ScreenY',([string]$pick.point.y),'-DelayMilliseconds',([string]$pick.delay)) -WindowStyle Hidden -PassThru) }
    }
    Write-Host '[F-025] physical-pair-helpers-started'
    Invoke-ComRetry { $Document.SendCommand("_.CHAMFER`n") } | Out-Null
    Write-Host '[F-025] physical-pair-command-returned'
    foreach ($helper in $helpers) {
      if (-not $helper.process.WaitForExit(15000)) { throw 'F-025 physical click helper did not exit.' }
      if ($helper.process.ExitCode -ne 0) { throw "F-025 physical click helper exited $($helper.process.ExitCode)." }
      Write-Host "[F-025] physical-pair-$($helper.action)-complete"
    }
  } finally {
    foreach ($helper in $helpers) { Stop-InputHelper $helper.process 'F-025 physical click helper' }
  }
  Write-Host '[F-025] physical-pair-waiting-idle'
  Wait-AcadIdle $Document 15; Invoke-ComRetry { $Document.Regen(1) } | Out-Null; Start-Sleep -Milliseconds 300
  Write-Host '[F-025] physical-pair-idle'
  return [ordered]@{ first = $firstScreen; second = $secondScreen; shiftSecond = $ShiftSecond }
}

function Invoke-ChamferRejectedPair {
  param($Acad, $Document, [int]$ProcessId, [string]$HelperPath, $First, [double]$FirstX, [double]$FirstY, $Second, [double]$SecondX, [double]$SecondY)
  $firstHandle = [string](Invoke-ComRetry { $First.Handle }); $secondHandle = [string](Invoke-ComRetry { $Second.Handle })
  $firstSelection = "(list (handent `"$firstHandle`") (list $FirstX $FirstY 0.0))"; $secondSelection = "(list (handent `"$secondHandle`") (list $SecondX $SecondY 0.0))"
  $lisp = "(progn (setvar `"CHAMMODE`" 0) (setvar `"CHAMFERA`" 10.0) (setvar `"CHAMFERB`" 10.0) (setvar `"TRIMMODE`" 1) (command `"_.CHAMFER`" $firstSelection $secondSelection) (princ))`n"
  $ownedWindowHandle = [string][int64](Invoke-ComRetry { $Acad.HWND }); $helpers = @()
  try {
    foreach ($delay in @(1000, 3000)) {
      $helpers += Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$HelperPath,'-MainWindowHandle',$ownedWindowHandle,'-ExpectedProcessId',([string]$ProcessId),'-Action','Escape','-DelayMilliseconds',([string]$delay)) -WindowStyle Hidden -PassThru
    }
    Invoke-ComRetry { $Document.SendCommand($lisp) } | Out-Null
    $exitCodes = @()
    foreach ($helper in $helpers) {
      if (-not $helper.WaitForExit(15000)) { throw 'F-025 rejected-pair Escape watchdog did not exit.' }
      $exitCodes += $helper.ExitCode
    }
    if (@($exitCodes | Where-Object { $_ -eq 0 }).Count -eq 0) {
      try {
        Wait-AcadIdle $Document 5
        Write-Host "[F-025] rejected-pair command was already idle after Escape watchdog failures: $($exitCodes -join ',')"
      } catch {
        throw "F-025 rejected-pair Escape watchdogs both failed and AutoCAD remained active: $($exitCodes -join ','). $($_.Exception.Message)"
      }
    }
  } finally {
    $errors = @()
    foreach ($helper in $helpers) { try { Stop-InputHelper $helper 'F-025 rejected-pair Escape watchdog' } catch { $errors += $_.Exception.Message } }
    if ($errors.Count -gt 0) { throw "F-025 rejected-pair Escape cleanup failed: $($errors -join '; ')." }
  }
  Wait-AcadIdle $Document; Invoke-ComRetry { $Document.Regen(1) } | Out-Null; Start-Sleep -Milliseconds 300
}

function Test-Near { param([double]$Actual, [double]$Expected, [double]$Tolerance = 0.000001); return [Math]::Abs($Actual - $Expected) -le $Tolerance }
function Test-Point { param($Actual, $Expected); return $null -ne $Actual -and $Actual.Count -ge 2 -and (Test-Near $Actual[0] $Expected[0]) -and (Test-Near $Actual[1] $Expected[1]) }
function Test-LineState { param($Entity, $ExpectedStart, $ExpectedEnd); return $Entity.objectName -eq 'AcDbLine' -and (Test-Point $Entity.details.start $ExpectedStart) -and (Test-Point $Entity.details.end $ExpectedEnd) }
function Test-Vertices { param($Actual, $Expected); if ($Actual.Count -ne $Expected.Count) { return $false }; for ($index = 0; $index -lt $Expected.Count; $index += 1) { if (-not (Test-Point $Actual[$index] $Expected[$index])) { return $false } }; return $true }

$acad = $null; $scratch = $null; $result = $null; $automationProcessId = 0; $owned = $false; $ownedIdentity = $null
$preExistingProcessIds = @(Get-Process -Name 'acad' -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.Id })
try {
  $acad = New-Object -ComObject AutoCAD.Application.24.3
  [uint32]$resolvedProcessId = 0; [void][F025WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry { $acad.HWND }), [ref]$resolvedProcessId)
  $automationProcessId = [int]$resolvedProcessId; $owned = $automationProcessId -gt 0 -and $preExistingProcessIds -notcontains $automationProcessId
  if (-not $owned) { throw 'F-025 refuses to use a pre-existing AutoCAD process.' }
  $ownedIdentity = Write-OwnedPidSidecar $automationProcessId; $installedUpdateIdentity = Get-InstalledAutoCadUpdateIdentity; Invoke-ComRetry { $acad.Visible = $true } | Out-Null
  Write-Stage 'owned-process-ready'
  if ([int](Invoke-ComRetry { $acad.Documents.Count }) -gt 0) {
    $candidate = Invoke-ComRetry { $acad.ActiveDocument }; $candidateFullName = [string](Invoke-ComRetry { $candidate.FullName }); $candidateCount = [int](Invoke-ComRetry { $candidate.ModelSpace.Count })
    if ($candidateFullName -or $candidateCount -ne 0) { throw 'F-025 refuses a saved or nonblank automation document.' }
    $scratch = $candidate
  } else { $scratch = Invoke-ComRetry { $acad.Documents.Add() } }
  Invoke-ComRetry { $scratch.Activate(); $scratch.SetVariable('CMDECHO', 0); $scratch.SetVariable('FILEDIA', 0) } | Out-Null; Wait-AcadIdle $scratch
  Write-Stage 'blank-document-ready'

  foreach ($name in @(
    'F025_DISTANCE','F025_ANGLE','F025_POLY','F025_POLY_NOTRIM','F025_POLY_SHORT','F025_POLY_OVERLAP','F025_POLY_OVERLAP_NOTRIM','F025_POLY_SHORT_NOTRIM','F025_POLY_ZERO','F025_ZERO','F025_PARALLEL',
    'F025_RAY','F025_RAY_FORWARD','F025_XLINE_LINE','F025_RAY_NOTRIM','F025_ADJACENT','F025_SEPARATED','F025_OPEN_CLOSE',
    'F025_SEAM_FORWARD','F025_SEAM_REVERSE','F025_PAIR_ZERO','F025_PAIR_ZERO_SEAM','F025_PAIR_TOO_SHORT',
    'F025_SHIFT','F025_MULTIPLE','F025_COMMAND_UNDO','F025_GLOBAL_UNDO_REDO','F025_CURRENT_SRC','F025_CURRENT_OUT',
    'F025_CROSS_A','F025_CROSS_B','F025_CROSS_OUT','F025_SAME_PROP','F025_CROSS_REVERSE_A','F025_CROSS_REVERSE_B','F025_CROSS_REVERSE_OUT','F025_LOCKED','F025_OFF','F025_FROZEN'
  )) { Invoke-ComRetry { $scratch.Layers.Add($name) } | Out-Null }
  $d1 = New-Line $scratch 'F025_DISTANCE' -100 0 0 0; $d2 = New-Line $scratch 'F025_DISTANCE' 0 0 0 100
  Write-Stage 'distance-before'
  Invoke-ChamferPair $scratch $d1 -50 0 $d2 0 50 'distance' 10 20 $true
  Write-Stage 'distance-after'

  $a1 = New-Line $scratch 'F025_ANGLE' 200 0 300 0; $a2 = New-Line $scratch 'F025_ANGLE' 300 0 300 100
  Write-Stage 'angle-before'
  Invoke-ChamferPair $scratch $a1 250 0 $a2 300 50 'angle' 10 45 $false
  Write-Stage 'angle-after'

  $poly = New-Polyline $scratch 'F025_POLY' ([double[]]@(0,200,100,200,100,300,0,300)) $true
  Write-Stage 'polyline-before'
  Invoke-ChamferPolyline $scratch $poly 10 20 $true
  Write-Stage 'polyline-after'

  $polyNoTrim = New-Polyline $scratch 'F025_POLY_NOTRIM' ([double[]]@(300,200,400,200,400,300,300,300)) $true
  Invoke-ChamferPolyline $scratch $polyNoTrim 10 20 $false
  $polyShort = New-Polyline $scratch 'F025_POLY_SHORT' ([double[]]@(500,200,505,200,505,205,500,205)) $true
  Invoke-ChamferPolyline $scratch $polyShort 10 10 $true
  $polyOverlap = New-Polyline $scratch 'F025_POLY_OVERLAP' ([double[]]@(600,200,625,200,625,225,600,225)) $true
  Invoke-ChamferPolyline $scratch $polyOverlap 20 20 $true
  $polyOverlapNoTrim = New-Polyline $scratch 'F025_POLY_OVERLAP_NOTRIM' ([double[]]@(700,200,725,200,725,225,700,225)) $true
  Invoke-ChamferPolyline $scratch $polyOverlapNoTrim 20 20 $false
  $polyShortNoTrim = New-Polyline $scratch 'F025_POLY_SHORT_NOTRIM' ([double[]]@(800,200,805,200,805,205,800,205)) $true
  Invoke-ChamferPolyline $scratch $polyShortNoTrim 10 10 $false
  $polyZero = New-Polyline $scratch 'F025_POLY_ZERO' ([double[]]@(900,200,1000,200,1000,300,900,300)) $true
  $polyZeroBefore = Get-EntityState $polyZero
  Invoke-ChamferPolyline $scratch $polyZero 0 0 $true

  $z1 = New-Line $scratch 'F025_ZERO' -100 400 -10 400; $z2 = New-Line $scratch 'F025_ZERO' 0 410 0 500
  Write-Stage 'zero-before'
  Invoke-ChamferPair $scratch $z1 -50 400 $z2 0 450 'distance' 0 0 $true
  Write-Stage 'zero-after'

  $p1 = New-Line $scratch 'F025_PARALLEL' 200 400 300 400; $p2 = New-Line $scratch 'F025_PARALLEL' 200 420 300 420
  $parallelBefore = @(Get-LayerStates $scratch 'F025_PARALLEL')
  Write-Stage 'parallel-before'
  Invoke-ChamferRejectedPair $acad $scratch $automationProcessId $EscapeHelperPath $p1 250 400 $p2 250 420
  Write-Stage 'parallel-after'

  $ray = New-Ray $scratch 'F025_RAY' -100 600 0 600; $xline = New-Xline $scratch 'F025_RAY' 0 600 0 700
  Write-Stage 'ray-xline-before'
  Invoke-ChamferPair $scratch $ray -50 600 $xline 0 650 'distance' 10 20 $true
  Write-Stage 'ray-xline-after'

  $rayForward = New-Ray $scratch 'F025_RAY_FORWARD' 0 800 100 800; $xlineForward = New-Xline $scratch 'F025_RAY_FORWARD' 100 800 100 900
  Invoke-ChamferPair $scratch $rayForward 150 800 $xlineForward 100 850 'distance' 10 20 $true

  $xlineFirst = New-Xline $scratch 'F025_XLINE_LINE' -100 1000 0 1000; $lineSecond = New-Line $scratch 'F025_XLINE_LINE' 0 1000 0 1100
  Invoke-ChamferPair $scratch $xlineFirst -50 1000 $lineSecond 0 1050 'distance' 10 20 $true

  $rayNoTrim = New-Ray $scratch 'F025_RAY_NOTRIM' -100 1200 0 1200; $xlineNoTrim = New-Xline $scratch 'F025_RAY_NOTRIM' 0 1200 0 1300
  Invoke-ChamferPair $scratch $rayNoTrim -50 1200 $xlineNoTrim 0 1250 'distance' 10 20 $false

  Write-Stage 'polyline-segment-pairs-start'
  $adjacent = New-Polyline $scratch 'F025_ADJACENT' ([double[]]@(0,1400,100,1400,100,1500,0,1500)) $false
  $adjacentInput = Invoke-ChamferPhysicalPair $acad $scratch $automationProcessId $EscapeHelperPath 100 1420 80 1500 -20 1380 120 1520 10 20 $true $false
  $separated = New-Polyline $scratch 'F025_SEPARATED' ([double[]]@(200,1400,280,1400,300,1420,300,1500)) $false
  $separatedInput = Invoke-ChamferPhysicalPair $acad $scratch $automationProcessId $EscapeHelperPath 250 1400 300 1460 180 1380 320 1520 10 20 $true $false
  $openClose = New-Polyline $scratch 'F025_OPEN_CLOSE' ([double[]]@(400,1450,400,1400,500,1400,450,1450)) $false
  $openCloseInput = Invoke-ChamferPhysicalPair $acad $scratch $automationProcessId $EscapeHelperPath 400 1420 470 1430 380 1380 520 1520 10 10 $true $false
  $seamForward = New-Polyline $scratch 'F025_SEAM_FORWARD' ([double[]]@(600,1400,700,1400,700,1500,600,1500)) $true
  $seamForwardInput = Invoke-ChamferPhysicalPair $acad $scratch $automationProcessId $EscapeHelperPath 600 1420 620 1400 580 1380 720 1520 10 20 $true $false
  $seamReverse = New-Polyline $scratch 'F025_SEAM_REVERSE' ([double[]]@(800,1400,900,1400,900,1500,800,1500)) $true
  $seamReverseInput = Invoke-ChamferPhysicalPair $acad $scratch $automationProcessId $EscapeHelperPath 820 1400 800 1420 780 1380 920 1520 10 20 $true $false

  $pairZero = New-Polyline $scratch 'F025_PAIR_ZERO' ([double[]]@(0,3400,100,3400,100,3500,0,3500)) $true
  $pairZeroBefore = Get-EntityState $pairZero
  $pairZeroInput = Invoke-ChamferPhysicalPair $acad $scratch $automationProcessId $EscapeHelperPath 50 3400 100 3450 -20 3380 120 3520 0 0 $true $false
  $pairZeroSeam = New-Polyline $scratch 'F025_PAIR_ZERO_SEAM' ([double[]]@(200,3400,300,3400,300,3500,200,3500)) $true
  $pairZeroSeamBefore = Get-EntityState $pairZeroSeam
  $pairZeroSeamInput = Invoke-ChamferPhysicalPair $acad $scratch $automationProcessId $EscapeHelperPath 200 3450 250 3400 180 3380 320 3520 0 0 $true $false
  $pairTooShort = New-Polyline $scratch 'F025_PAIR_TOO_SHORT' ([double[]]@(400,3400,405,3400,405,3405,400,3405)) $true
  $pairTooShortBefore = Get-EntityState $pairTooShort
  $pairTooShortInput = Invoke-ChamferPhysicalPair $acad $scratch $automationProcessId $EscapeHelperPath 402.5 3400 405 3402.5 390 3390 415 3415 10 10 $true $false

  Write-Stage 'physical-shift-start'
  $shiftFirst = New-Line $scratch 'F025_SHIFT' 0 1600 90 1600; $shiftSecond = New-Line $scratch 'F025_SHIFT' 100 1610 100 1700
  $shiftInput = Invoke-ChamferPhysicalPair $acad $scratch $automationProcessId $EscapeHelperPath 80 1600 100 1630 -20 1580 120 1720 10 20 $true $true
  $shiftDistanceAAfter = [double](Invoke-ComRetry { $scratch.GetVariable('CHAMFERA') }); $shiftDistanceBAfter = [double](Invoke-ComRetry { $scratch.GetVariable('CHAMFERB') })

  Write-Stage 'multiple-undo-start'
  $multiplePairs = @(
    [ordered]@{ first = (New-Line $scratch 'F025_MULTIPLE' 0 1800 100 1800); firstX = 80; firstY = 1800; second = (New-Line $scratch 'F025_MULTIPLE' 100 1800 100 1900); secondX = 100; secondY = 1820 },
    [ordered]@{ first = (New-Line $scratch 'F025_MULTIPLE' 200 1800 300 1800); firstX = 280; firstY = 1800; second = (New-Line $scratch 'F025_MULTIPLE' 300 1800 300 1900); secondX = 300; secondY = 1820 }
  )
  Invoke-ChamferMultiple $scratch $multiplePairs 10 20 $true $false
  $commandUndoPairs = @(
    [ordered]@{ first = (New-Line $scratch 'F025_COMMAND_UNDO' 0 2000 100 2000); firstX = 80; firstY = 2000; second = (New-Line $scratch 'F025_COMMAND_UNDO' 100 2000 100 2100); secondX = 100; secondY = 2020 },
    [ordered]@{ first = (New-Line $scratch 'F025_COMMAND_UNDO' 200 2000 300 2000); firstX = 280; firstY = 2000; second = (New-Line $scratch 'F025_COMMAND_UNDO' 300 2000 300 2100); secondX = 300; secondY = 2020 }
  )
  Invoke-ChamferMultiple $scratch $commandUndoPairs 10 20 $true $true
  $globalPairs = @(
    [ordered]@{ first = (New-Line $scratch 'F025_GLOBAL_UNDO_REDO' 0 2200 100 2200); firstX = 80; firstY = 2200; second = (New-Line $scratch 'F025_GLOBAL_UNDO_REDO' 100 2200 100 2300); secondX = 100; secondY = 2220 },
    [ordered]@{ first = (New-Line $scratch 'F025_GLOBAL_UNDO_REDO' 200 2200 300 2200); firstX = 280; firstY = 2200; second = (New-Line $scratch 'F025_GLOBAL_UNDO_REDO' 300 2200 300 2300); secondX = 300; secondY = 2220 }
  )
  Invoke-ComRetry { $scratch.StartUndoMark() } | Out-Null
  try { Invoke-ChamferMultiple $scratch $globalPairs 10 20 $true $false }
  finally { Invoke-ComRetry { $scratch.EndUndoMark() } | Out-Null }
  $globalCommitted = @(Get-LayerStates $scratch 'F025_GLOBAL_UNDO_REDO')
  Invoke-ComRetry { $scratch.SendCommand("_.UNDO`n1`n") } | Out-Null; Start-Sleep -Milliseconds 500; Wait-AcadIdle $scratch; $globalUndone = @(Get-LayerStates $scratch 'F025_GLOBAL_UNDO_REDO')
  Invoke-ComRetry { $scratch.SendCommand("_.REDO`n") } | Out-Null; Start-Sleep -Milliseconds 500; Wait-AcadIdle $scratch; $globalRedone = @(Get-LayerStates $scratch 'F025_GLOBAL_UNDO_REDO')
  $globalCommittedTypes = @($globalCommitted | ForEach-Object { $_.objectName }) -join ','
  $globalUndoneTypes = @($globalUndone | ForEach-Object { $_.objectName }) -join ','
  $globalRedoneTypes = @($globalRedone | ForEach-Object { $_.objectName }) -join ','
  Write-Host "[F-025] global-undo-redo committed=$($globalCommitted.Count)[$globalCommittedTypes] undone=$($globalUndone.Count)[$globalUndoneTypes] redone=$($globalRedone.Count)[$globalRedoneTypes]"

  Write-Stage 'output-layer-start'
  $currentFirst = New-Line $scratch 'F025_CURRENT_SRC' 0 2400 100 2400; $currentSecond = New-Line $scratch 'F025_CURRENT_SRC' 100 2400 100 2500
  Invoke-ComRetry { $scratch.SetVariable('CLAYER', 'F025_CURRENT_OUT') } | Out-Null
  Invoke-ChamferPair $scratch $currentFirst 80 2400 $currentSecond 100 2420 'distance' 10 20 $false
  Invoke-ComRetry { $scratch.SetVariable('CLAYER', '0') } | Out-Null
  $crossFirst = New-Line $scratch 'F025_CROSS_A' 0 2600 100 2600; $crossSecond = New-Line $scratch 'F025_CROSS_B' 100 2600 100 2700
  Invoke-ComRetry { $crossFirst.Color = 2; $crossFirst.Lineweight = 50; $crossFirst.Linetype = 'Continuous'; $crossFirst.EntityTransparency = '50' } | Out-Null
  Invoke-ComRetry { $crossSecond.Color = 3; $crossSecond.Lineweight = 35; $crossSecond.Linetype = 'ByLayer'; $crossSecond.EntityTransparency = '25' } | Out-Null
  Invoke-ComRetry { $scratch.SetVariable('CLAYER', 'F025_CROSS_OUT') } | Out-Null
  Invoke-ChamferPair $scratch $crossFirst 80 2600 $crossSecond 100 2620 'distance' 10 20 $false
  Invoke-ComRetry { $scratch.SetVariable('CLAYER', '0') } | Out-Null
  $samePropertyFirst = New-Line $scratch 'F025_SAME_PROP' 0 3000 100 3000; $samePropertySecond = New-Line $scratch 'F025_SAME_PROP' 100 3000 100 3100
  Invoke-ComRetry { $samePropertyFirst.Color = 2; $samePropertyFirst.Lineweight = 50; $samePropertyFirst.Linetype = 'Continuous'; $samePropertyFirst.EntityTransparency = '50' } | Out-Null
  Invoke-ComRetry { $samePropertySecond.Color = 3; $samePropertySecond.Lineweight = 35; $samePropertySecond.Linetype = 'ByLayer'; $samePropertySecond.EntityTransparency = '25' } | Out-Null
  Invoke-ChamferPair $scratch $samePropertyFirst 80 3000 $samePropertySecond 100 3020 'distance' 10 20 $false
  $crossReverseFirst = New-Line $scratch 'F025_CROSS_REVERSE_A' 0 3200 100 3200; $crossReverseSecond = New-Line $scratch 'F025_CROSS_REVERSE_B' 100 3200 100 3300
  Invoke-ComRetry { $crossReverseFirst.Color = 4; $crossReverseFirst.Lineweight = 40; $crossReverseFirst.Linetype = 'ByLayer'; $crossReverseFirst.EntityTransparency = '40' } | Out-Null
  Invoke-ComRetry { $crossReverseSecond.Color = 5; $crossReverseSecond.Lineweight = 25; $crossReverseSecond.Linetype = 'Continuous'; $crossReverseSecond.EntityTransparency = '15' } | Out-Null
  Invoke-ComRetry { $scratch.SetVariable('CLAYER', 'F025_CROSS_REVERSE_OUT') } | Out-Null
  Invoke-ChamferPair $scratch $crossReverseFirst 80 3200 $crossReverseSecond 100 3220 'distance' 10 20 $false
  Invoke-ComRetry { $scratch.SetVariable('CLAYER', '0') } | Out-Null

  Write-Stage 'layer-states-start'
  $lockedFirst = New-Line $scratch 'F025_LOCKED' 0 2800 100 2800; $lockedSecond = New-Line $scratch 'F025_LOCKED' 100 2800 100 2900
  $lockedLayer = Invoke-ComRetry { $scratch.Layers.Item('F025_LOCKED') }; Invoke-ComRetry { $lockedLayer.Lock = $true } | Out-Null
  Invoke-ChamferRejectedPair $acad $scratch $automationProcessId $EscapeHelperPath $lockedFirst 80 2800 $lockedSecond 100 2820
  Invoke-ComRetry { $lockedLayer.Lock = $false } | Out-Null
  $offFirst = New-Line $scratch 'F025_OFF' 200 2800 300 2800; $offSecond = New-Line $scratch 'F025_OFF' 300 2800 300 2900
  $offLayer = Invoke-ComRetry { $scratch.Layers.Item('F025_OFF') }; Invoke-ComRetry { $offLayer.LayerOn = $false } | Out-Null
  Invoke-ChamferRejectedPair $acad $scratch $automationProcessId $EscapeHelperPath $offFirst 280 2800 $offSecond 300 2820
  Invoke-ComRetry { $offLayer.LayerOn = $true } | Out-Null
  $frozenFirst = New-Line $scratch 'F025_FROZEN' 400 2800 500 2800; $frozenSecond = New-Line $scratch 'F025_FROZEN' 500 2800 500 2900
  $frozenLayer = Invoke-ComRetry { $scratch.Layers.Item('F025_FROZEN') }; Invoke-ComRetry { $frozenLayer.Freeze = $true } | Out-Null
  Invoke-ChamferRejectedPair $acad $scratch $automationProcessId $EscapeHelperPath $frozenFirst 480 2800 $frozenSecond 500 2820
  Invoke-ComRetry { $frozenLayer.Freeze = $false } | Out-Null

  Invoke-ComRetry { $scratch.Regen(1); $scratch.SaveAs($DxfOutputPath, 65) } -TimeoutSeconds 90 | Out-Null; Wait-AcadIdle $scratch
  Write-Stage 'dxf-saved'
  $observations = [ordered]@{
    distance = @(Get-LayerStates $scratch 'F025_DISTANCE')
    angleNoTrim = @(Get-LayerStates $scratch 'F025_ANGLE')
    polyline = @(Get-LayerStates $scratch 'F025_POLY')
    polylineNoTrim = @(Get-LayerStates $scratch 'F025_POLY_NOTRIM')
    polylineShort = @(Get-LayerStates $scratch 'F025_POLY_SHORT')
    polylineOverlap = @(Get-LayerStates $scratch 'F025_POLY_OVERLAP')
    polylineOverlapNoTrim = @(Get-LayerStates $scratch 'F025_POLY_OVERLAP_NOTRIM')
    polylineShortNoTrim = @(Get-LayerStates $scratch 'F025_POLY_SHORT_NOTRIM')
    polylineZero = [ordered]@{ before = $polyZeroBefore; entities = @(Get-LayerStates $scratch 'F025_POLY_ZERO') }
    zero = @(Get-LayerStates $scratch 'F025_ZERO')
    parallelBefore = $parallelBefore
    parallelAfter = @(Get-LayerStates $scratch 'F025_PARALLEL')
    rayXline = @(Get-LayerStates $scratch 'F025_RAY')
    rayForward = @(Get-LayerStates $scratch 'F025_RAY_FORWARD')
    xlineLine = @(Get-LayerStates $scratch 'F025_XLINE_LINE')
    rayNoTrim = @(Get-LayerStates $scratch 'F025_RAY_NOTRIM')
    adjacent = [ordered]@{ entities = @(Get-LayerStates $scratch 'F025_ADJACENT'); input = $adjacentInput }
    separated = [ordered]@{ entities = @(Get-LayerStates $scratch 'F025_SEPARATED'); input = $separatedInput }
    openClose = [ordered]@{ entities = @(Get-LayerStates $scratch 'F025_OPEN_CLOSE'); input = $openCloseInput }
    seamForward = [ordered]@{ entities = @(Get-LayerStates $scratch 'F025_SEAM_FORWARD'); input = $seamForwardInput }
    seamReverse = [ordered]@{ entities = @(Get-LayerStates $scratch 'F025_SEAM_REVERSE'); input = $seamReverseInput }
    pairZero = [ordered]@{ before = $pairZeroBefore; entities = @(Get-LayerStates $scratch 'F025_PAIR_ZERO'); input = $pairZeroInput }
    pairZeroSeam = [ordered]@{ before = $pairZeroSeamBefore; entities = @(Get-LayerStates $scratch 'F025_PAIR_ZERO_SEAM'); input = $pairZeroSeamInput }
    pairTooShort = [ordered]@{ before = $pairTooShortBefore; entities = @(Get-LayerStates $scratch 'F025_PAIR_TOO_SHORT'); input = $pairTooShortInput }
    physicalShift = [ordered]@{ entities = @(Get-LayerStates $scratch 'F025_SHIFT'); input = $shiftInput; distanceAAfter = $shiftDistanceAAfter; distanceBAfter = $shiftDistanceBAfter }
    multiple = @(Get-LayerStates $scratch 'F025_MULTIPLE')
    commandUndo = @(Get-LayerStates $scratch 'F025_COMMAND_UNDO')
    globalUndoRedo = [ordered]@{ committed = $globalCommitted; undone = $globalUndone; redone = $globalRedone }
    sameSourceLayer = [ordered]@{ source = @(Get-LayerStates $scratch 'F025_CURRENT_SRC'); current = @(Get-LayerStates $scratch 'F025_CURRENT_OUT') }
    crossLayer = [ordered]@{ first = @(Get-LayerStates $scratch 'F025_CROSS_A'); second = @(Get-LayerStates $scratch 'F025_CROSS_B'); current = @(Get-LayerStates $scratch 'F025_CROSS_OUT') }
    sameLayerProperties = @(Get-LayerStates $scratch 'F025_SAME_PROP')
    crossLayerReverse = [ordered]@{ first = @(Get-LayerStates $scratch 'F025_CROSS_REVERSE_A'); second = @(Get-LayerStates $scratch 'F025_CROSS_REVERSE_B'); current = @(Get-LayerStates $scratch 'F025_CROSS_REVERSE_OUT') }
    lockedLayer = @(Get-LayerStates $scratch 'F025_LOCKED')
    offLayer = @(Get-LayerStates $scratch 'F025_OFF')
    frozenLayer = @(Get-LayerStates $scratch 'F025_FROZEN')
  }
  $basicChecks = [ordered]@{
    distanceExact = ($observations.distance.Count -eq 3 -and @($observations.distance | Where-Object { Test-LineState $_ @(-100,0) @(-10,0) }).Count -eq 1 -and @($observations.distance | Where-Object { Test-LineState $_ @(0,20) @(0,100) }).Count -eq 1 -and @($observations.distance | Where-Object { Test-LineState $_ @(-10,0) @(0,20) }).Count -eq 1)
    angleNoTrimExact = ($observations.angleNoTrim.Count -eq 3 -and @($observations.angleNoTrim | Where-Object { Test-LineState $_ @(200,0) @(300,0) }).Count -eq 1 -and @($observations.angleNoTrim | Where-Object { Test-LineState $_ @(300,0) @(300,100) }).Count -eq 1 -and @($observations.angleNoTrim | Where-Object { Test-LineState $_ @(290,0) @(300,10) }).Count -eq 1)
    polylineExact = ($observations.polyline.Count -eq 1 -and $observations.polyline[0].objectName -eq 'AcDbPolyline' -and (Test-Vertices $observations.polyline[0].details.vertices @(@(20,200),@(90,200),@(100,220),@(100,290),@(80,300),@(10,300),@(0,280),@(0,210))) -and @($observations.polyline[0].details.bulges | Where-Object { -not (Test-Near $_ 0) }).Count -eq 0)
    polylineOverlapExact = ($observations.polylineOverlap.Count -eq 1 -and $observations.polylineOverlap[0].objectName -eq 'AcDbPolyline' -and (Test-Vertices $observations.polylineOverlap[0].details.vertices @(@(600,200),@(605,200),@(625,220),@(625,225),@(620,225),@(600,205))))
    polylineOverlapNoTrimExact = (
      $observations.polylineOverlapNoTrim.Count -eq 5 -and
      @($observations.polylineOverlapNoTrim | Where-Object { $_.objectName -eq 'AcDbPolyline' -and (Test-Vertices $_.details.vertices @(@(700,200),@(725,200),@(725,225),@(700,225))) }).Count -eq 1 -and
      @($observations.polylineOverlapNoTrim | Where-Object { Test-LineState $_ @(700,220) @(720,200) }).Count -eq 1 -and
      @($observations.polylineOverlapNoTrim | Where-Object { Test-LineState $_ @(720,225) @(700,205) }).Count -eq 1 -and
      @($observations.polylineOverlapNoTrim | Where-Object { Test-LineState $_ @(725,205) @(705,225) }).Count -eq 1 -and
      @($observations.polylineOverlapNoTrim | Where-Object { Test-LineState $_ @(705,200) @(725,220) }).Count -eq 1
    )
    polylineShortNoTrimExact = (
      $observations.polylineShortNoTrim.Count -eq 5 -and
      @($observations.polylineShortNoTrim | Where-Object { $_.objectName -eq 'AcDbPolyline' -and (Test-Vertices $_.details.vertices @(@(800,200),@(805,200),@(805,205),@(800,205))) }).Count -eq 1 -and
      @($observations.polylineShortNoTrim | Where-Object { Test-LineState $_ @(800,210) @(810,200) }).Count -eq 1 -and
      @($observations.polylineShortNoTrim | Where-Object { Test-LineState $_ @(810,205) @(800,195) }).Count -eq 1 -and
      @($observations.polylineShortNoTrim | Where-Object { Test-LineState $_ @(805,195) @(795,205) }).Count -eq 1 -and
      @($observations.polylineShortNoTrim | Where-Object { Test-LineState $_ @(795,200) @(805,210) }).Count -eq 1
    )
    polylineZeroIdentity = (
      $observations.polylineZero.entities.Count -eq 1 -and
      ($observations.polylineZero.before | ConvertTo-Json -Compress -Depth 8) -eq ($observations.polylineZero.entities[0] | ConvertTo-Json -Compress -Depth 8) -and
      (Test-Vertices $observations.polylineZero.entities[0].details.vertices @(@(900,200),@(1000,200),@(1000,300),@(900,300)))
    )
    zeroSharpExact = ($observations.zero.Count -eq 2 -and @($observations.zero | Where-Object { Test-LineState $_ @(-100,400) @(0,400) }).Count -eq 1 -and @($observations.zero | Where-Object { Test-LineState $_ @(0,400) @(0,500) }).Count -eq 1)
    parallelUnchanged = ($observations.parallelAfter | ConvertTo-Json -Compress -Depth 8) -eq ($parallelBefore | ConvertTo-Json -Compress -Depth 8)
    rayXlineTrimLeavesChamferOnly = $observations.rayXline.Count -eq 1 -and (Test-LineState $observations.rayXline[0] @(-10,600) @(0,620))
    polylineNoTrim = $observations.polylineNoTrim.Count -eq 5
    polylineShortSkipped = $observations.polylineShort.Count -eq 1
    adjacentPolyline = (
      $observations.adjacent.input.shiftSecond -eq $false -and
      $observations.adjacent.entities.Count -eq 1 -and $observations.adjacent.entities[0].objectName -eq 'AcDbPolyline' -and
      -not $observations.adjacent.entities[0].details.closed -and
      (Test-Vertices $observations.adjacent.entities[0].details.vertices @(@(0,1400),@(100,1400),@(100,1490),@(80,1500),@(0,1500)))
    )
    separatedPolyline = (
      $observations.separated.input.shiftSecond -eq $false -and
      $observations.separated.entities.Count -eq 1 -and $observations.separated.entities[0].objectName -eq 'AcDbPolyline' -and
      -not $observations.separated.entities[0].details.closed -and
      (Test-Vertices $observations.separated.entities[0].details.vertices @(@(200,1400),@(290,1400),@(300,1420),@(300,1500)))
    )
    openStartEndClosed = (
      $observations.openClose.input.shiftSecond -eq $false -and
      $observations.openClose.entities.Count -eq 1 -and $observations.openClose.entities[0].objectName -eq 'AcDbPolyline' -and
      $observations.openClose.entities[0].details.closed -and
      (Test-Vertices $observations.openClose.entities[0].details.vertices @(@(400,1490),@(400,1400),@(500,1400),@(407.0710678118655,1492.9289321881345)))
    )
    closedSeamBothOrders = (
      $observations.seamForward.input.shiftSecond -eq $false -and $observations.seamReverse.input.shiftSecond -eq $false -and
      $observations.seamForward.entities.Count -eq 1 -and $observations.seamForward.entities[0].details.closed -and
      (Test-Vertices $observations.seamForward.entities[0].details.vertices @(@(620,1400),@(700,1400),@(700,1500),@(600,1500),@(600,1410))) -and
      $observations.seamReverse.entities.Count -eq 1 -and $observations.seamReverse.entities[0].details.closed -and
      (Test-Vertices $observations.seamReverse.entities[0].details.vertices @(@(810,1400),@(900,1400),@(900,1500),@(800,1500),@(800,1420)))
    )
    samePolylineZeroIdentity = (
      $observations.pairZero.input.shiftSecond -eq $false -and $observations.pairZeroSeam.input.shiftSecond -eq $false -and
      $observations.pairZero.entities.Count -eq 1 -and $observations.pairZeroSeam.entities.Count -eq 1 -and
      ($observations.pairZero.before | ConvertTo-Json -Compress -Depth 8) -eq ($observations.pairZero.entities[0] | ConvertTo-Json -Compress -Depth 8) -and
      ($observations.pairZeroSeam.before | ConvertTo-Json -Compress -Depth 8) -eq ($observations.pairZeroSeam.entities[0] | ConvertTo-Json -Compress -Depth 8) -and
      (Test-Vertices $observations.pairZero.entities[0].details.vertices @(@(0,3400),@(100,3400),@(100,3500),@(0,3500))) -and
      (Test-Vertices $observations.pairZeroSeam.entities[0].details.vertices @(@(200,3400),@(300,3400),@(300,3500),@(200,3500)))
    )
    selectedPolylineDistanceTooLargeUnchanged = (
      $observations.pairTooShort.input.shiftSecond -eq $false -and
      $observations.pairTooShort.entities.Count -eq 1 -and
      ($observations.pairTooShort.before | ConvertTo-Json -Compress -Depth 8) -eq ($observations.pairTooShort.entities[0] | ConvertTo-Json -Compress -Depth 8) -and
      (Test-Vertices $observations.pairTooShort.entities[0].details.vertices @(@(400,3400),@(405,3400),@(405,3405),@(400,3405)))
    )
    physicalShiftSharpCorner = (
      $observations.physicalShift.input.shiftSecond -eq $true -and
      $observations.physicalShift.entities.Count -eq 2 -and
      @($observations.physicalShift.entities | Where-Object { Test-LineState $_ @(0,1600) @(100,1600) }).Count -eq 1 -and
      @($observations.physicalShift.entities | Where-Object { Test-LineState $_ @(100,1600) @(100,1700) }).Count -eq 1 -and
      (Test-Near $observations.physicalShift.distanceAAfter 10) -and (Test-Near $observations.physicalShift.distanceBAfter 20)
    )
    multiple = $observations.multiple.Count -eq 6
    commandUndo = $observations.commandUndo.Count -eq 5
    globalUndoRedo = (
      $observations.globalUndoRedo.committed.Count -eq 6 -and
      @($observations.globalUndoRedo.committed | Where-Object { Test-LineState $_ @(0,2200) @(90,2200) }).Count -eq 1 -and
      @($observations.globalUndoRedo.committed | Where-Object { Test-LineState $_ @(100,2220) @(100,2300) }).Count -eq 1 -and
      @($observations.globalUndoRedo.committed | Where-Object { Test-LineState $_ @(90,2200) @(100,2220) }).Count -eq 1 -and
      @($observations.globalUndoRedo.committed | Where-Object { Test-LineState $_ @(200,2200) @(290,2200) }).Count -eq 1 -and
      @($observations.globalUndoRedo.committed | Where-Object { Test-LineState $_ @(300,2220) @(300,2300) }).Count -eq 1 -and
      @($observations.globalUndoRedo.committed | Where-Object { Test-LineState $_ @(290,2200) @(300,2220) }).Count -eq 1 -and
      $observations.globalUndoRedo.undone.Count -eq 4 -and
      @($observations.globalUndoRedo.undone | Where-Object { Test-LineState $_ @(0,2200) @(100,2200) }).Count -eq 1 -and
      @($observations.globalUndoRedo.undone | Where-Object { Test-LineState $_ @(100,2200) @(100,2300) }).Count -eq 1 -and
      @($observations.globalUndoRedo.undone | Where-Object { Test-LineState $_ @(200,2200) @(300,2200) }).Count -eq 1 -and
      @($observations.globalUndoRedo.undone | Where-Object { Test-LineState $_ @(300,2200) @(300,2300) }).Count -eq 1 -and
      $observations.globalUndoRedo.redone.Count -eq 6 -and
      @($observations.globalUndoRedo.redone | Where-Object { Test-LineState $_ @(0,2200) @(90,2200) }).Count -eq 1 -and
      @($observations.globalUndoRedo.redone | Where-Object { Test-LineState $_ @(100,2220) @(100,2300) }).Count -eq 1 -and
      @($observations.globalUndoRedo.redone | Where-Object { Test-LineState $_ @(90,2200) @(100,2220) }).Count -eq 1 -and
      @($observations.globalUndoRedo.redone | Where-Object { Test-LineState $_ @(200,2200) @(290,2200) }).Count -eq 1 -and
      @($observations.globalUndoRedo.redone | Where-Object { Test-LineState $_ @(300,2220) @(300,2300) }).Count -eq 1 -and
      @($observations.globalUndoRedo.redone | Where-Object { Test-LineState $_ @(290,2200) @(300,2220) }).Count -eq 1
    )
    sameSourceLayerOutput = $observations.sameSourceLayer.source.Count -eq 3 -and $observations.sameSourceLayer.current.Count -eq 0
    crossLayerCurrentOutput = (
      $observations.crossLayer.first.Count -eq 1 -and $observations.crossLayer.second.Count -eq 1 -and $observations.crossLayer.current.Count -eq 1 -and
      $observations.crossLayer.current[0].color -eq 256 -and $observations.crossLayer.current[0].lineweight -eq 35 -and
      $observations.crossLayer.current[0].linetype -eq 'ByLayer' -and $observations.crossLayer.current[0].transparency -eq '25'
    )
    secondSelectionProperties = (
      $observations.sameLayerProperties.Count -eq 3 -and
      @($observations.sameLayerProperties | Where-Object { $_.color -eq 256 -and $_.lineweight -eq 35 -and $_.linetype -eq 'ByLayer' -and $_.transparency -eq '25' -and (Test-LineState $_ @(90,3000) @(100,3020)) }).Count -eq 1 -and
      $observations.crossLayerReverse.current.Count -eq 1 -and $observations.crossLayerReverse.current[0].color -eq 256 -and
      $observations.crossLayerReverse.current[0].lineweight -eq 25 -and $observations.crossLayerReverse.current[0].linetype -eq 'ByLayer' -and
      $observations.crossLayerReverse.current[0].transparency -eq '15'
    )
    lockedLayerRejected = $observations.lockedLayer.Count -eq 2
    offLayerExplicitHandleEdited = $observations.offLayer.Count -eq 3
    frozenLayerExplicitHandleEdited = $observations.frozenLayer.Count -eq 3
  }
  $result = [ordered]@{
    schemaVersion = 1; rowId = 'F-025'; benchmark = 'AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation'; engine = 'Autodesk AutoCAD 2024 desktop COM'; engineVersion = [string](Invoke-ComRetry { $acad.Version })
    automationProcessId = $automationProcessId; automationProcessOwned = $owned; installedUpdateIdentity = $installedUpdateIdentity
    automationProcessIdentity = [ordered]@{ processId = $ownedIdentity.processId; executableName = $ownedIdentity.executableName; executableSha256 = $ownedIdentity.executableSha256; fileVersion = $ownedIdentity.fileVersion; productVersion = $ownedIdentity.productVersion; startTimeSha256 = $ownedIdentity.startTimeSha256 }
    observations = $observations; checks = $basicChecks; dxfOutputSha256 = Get-FileSha256 $DxfOutputPath; cmdNamesAfter = [string](Invoke-ComRetry { $scratch.GetVariable('CMDNAMES') }); userDocument = [ordered]@{ isolatedOwnedProcess = $owned; blankRestored = $true }
    status = if (@($basicChecks.Values | Where-Object { $_ -ne $true }).Count -eq 0) { 'PASS' } else { 'FAIL' }
  }
} finally {
  if ($scratch) { try { Invoke-ComRetry { $scratch.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
  if ($owned -and $acad) { try { Invoke-ComRetry { $acad.Quit() } -TimeoutSeconds 10 | Out-Null } catch {} }
}

if (-not $result) { throw 'F-025 AutoCAD matrix produced no result.' }
$result | ConvertTo-Json -Depth 14
if ($result.status -ne 'PASS') { exit 1 }
