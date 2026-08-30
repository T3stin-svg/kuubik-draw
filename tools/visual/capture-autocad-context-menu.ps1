param(
  [Parameter(Mandatory = $true)][string]$OutputPng,
  [Parameter(Mandatory = $true)][string]$OutputJson
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class VisualContextMenuProcess {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int width, int height, bool repaint);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetClassName(IntPtr hWnd, StringBuilder className, int maximumCount);
  public static string GetClass(IntPtr hWnd) {
    var text = new StringBuilder(512);
    GetClassName(hWnd, text, text.Capacity);
    return text.ToString();
  }
}
'@

function Invoke-ComRetry {
  param([Parameter(Mandatory = $true)][scriptblock]$Action, [int]$TimeoutSeconds = 30)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    try { return (& $Action) } catch {
      if ([DateTime]::UtcNow -ge $deadline) { throw }
      Start-Sleep -Milliseconds 150
    }
  } while ($true)
}

function Wait-AcadIdle {
  param([Parameter(Mandatory = $true)]$Document, [int]$TimeoutSeconds = 30)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 100
    try {
      $commandNames = [string]$Document.GetVariable('CMDNAMES')
      $commandActive = [int]$Document.GetVariable('CMDACTIVE')
      if ([string]::IsNullOrWhiteSpace($commandNames) -and $commandActive -eq 0) { return }
    } catch {}
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'AutoCAD did not return idle during the visual context-menu audit.'
}

function Send-AcadCommand {
  param([Parameter(Mandatory = $true)]$Document, [Parameter(Mandatory = $true)][string]$Command)
  Invoke-ComRetry { $Document.SendCommand($Command) } | Out-Null
  Wait-AcadIdle $Document
}

function Get-Sha256 {
  param([Parameter(Mandatory = $true)][string]$Path)
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Test-OwnedProcessIdentity {
  param([int]$ProcessId, [string]$ExecutablePath, [DateTime]$StartTime)
  $candidate = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if (-not $candidate) { return $false }
  return [IO.Path]::GetFullPath([string]$candidate.Path) -eq $ExecutablePath -and
    $candidate.StartTime.ToUniversalTime() -eq $StartTime.ToUniversalTime()
}

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$pngPath = [IO.Path]::GetFullPath($OutputPng)
$jsonPath = [IO.Path]::GetFullPath($OutputJson)
foreach ($path in @($pngPath, $jsonPath)) {
  if ($path.StartsWith($repoRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Private AutoCAD reference pixels and process reports must not be written into the public repository.'
  }
  $parent = Split-Path -Parent $path
  if (-not (Test-Path -LiteralPath $parent -PathType Container)) { throw "Output parent does not exist: $parent" }
}

$screen = [Windows.Forms.Screen]::PrimaryScreen.Bounds
if ($screen.Width -lt 1920 -or $screen.Height -lt 1080) { throw "Primary display is only $($screen.Width)x$($screen.Height); 1920x1080 is required." }

$preExistingProcessIds = @(Get-Process -Name 'acad' -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.Id })
$acad = $null
$scratch = $null
$automationProcessId = 0
$ownedExecutablePath = $null
$ownedStartTime = $null
$mainOriginal = $null
$result = $null
try {
  $acad = New-Object -ComObject AutoCAD.Application.24.3
  Invoke-ComRetry { $acad.Visible = $true; $acad.WindowState = 3 } | Out-Null
  $mainHwnd = [int64](Invoke-ComRetry { $acad.HWND })
  [uint32]$resolvedProcessId = 0
  [void][VisualContextMenuProcess]::GetWindowThreadProcessId([IntPtr]$mainHwnd, [ref]$resolvedProcessId)
  $automationProcessId = [int]$resolvedProcessId
  if ($automationProcessId -le 0 -or $preExistingProcessIds -contains $automationProcessId) {
    throw 'Visual context-menu audit refuses to use a pre-existing AutoCAD process.'
  }
  $ownedProcess = Get-Process -Id $automationProcessId -ErrorAction Stop
  $ownedExecutablePath = [IO.Path]::GetFullPath([string]$ownedProcess.Path)
  $ownedStartTime = $ownedProcess.StartTime
  if ([IO.Path]::GetFileName($ownedExecutablePath) -ine 'acad.exe') { throw "Visual audit PID $automationProcessId is not acad.exe." }

  $mainOriginal = New-Object VisualContextMenuProcess+RECT
  if (-not [VisualContextMenuProcess]::GetWindowRect([IntPtr]$mainHwnd, [ref]$mainOriginal)) { throw 'Could not read owned AutoCAD main-window bounds.' }
  [void][VisualContextMenuProcess]::ShowWindow([IntPtr]$mainHwnd, 9)
  if (-not [VisualContextMenuProcess]::MoveWindow([IntPtr]$mainHwnd, 0, 0, 1920, 1080, $true)) { throw 'Could not set owned AutoCAD to 1920x1080.' }

  $scratch = Invoke-ComRetry { $acad.Documents.Add() }
  if ([string](Invoke-ComRetry { $scratch.FullName }) -or [int](Invoke-ComRetry { $scratch.ModelSpace.Count }) -ne 0) {
    throw 'Visual context-menu audit refuses a saved or non-blank drawing.'
  }
  Invoke-ComRetry { $scratch.Activate() } | Out-Null
  Wait-AcadIdle $scratch
  Invoke-ComRetry { $scratch.SetVariable('SHORTCUTMENU', 11) } | Out-Null
  Send-AcadCommand $scratch "_.RECTANG`n0,0`n1000,600`n"
  Send-AcadCommand $scratch "_.ZOOM`n_Extents`n"
  Start-Sleep -Milliseconds 600

  if (-not [VisualContextMenuProcess]::SetForegroundWindow([IntPtr]$mainHwnd)) { throw 'Could not foreground the owned AutoCAD window.' }
  $anchor = New-Object VisualContextMenuProcess+POINT
  $anchor.X = 1600
  $anchor.Y = 600
  if (-not [VisualContextMenuProcess]::SetCursorPos($anchor.X, $anchor.Y)) { throw 'Could not position the context-menu audit pointer.' }
  [VisualContextMenuProcess]::mouse_event(0x0008, 0, 0, 0, [UIntPtr]::Zero)
  [VisualContextMenuProcess]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 900

  $menuHwnd = [VisualContextMenuProcess]::WindowFromPoint($anchor)
  $menuClass = [VisualContextMenuProcess]::GetClass($menuHwnd)
  if ($menuClass -ne '#32768') { throw "AutoCAD context-menu popup was not resolved at the pointer; class=$menuClass hwnd=$menuHwnd." }
  [uint32]$menuProcessId = 0
  [void][VisualContextMenuProcess]::GetWindowThreadProcessId($menuHwnd, [ref]$menuProcessId)
  if ([int]$menuProcessId -ne $automationProcessId) { throw "Resolved popup belongs to PID $menuProcessId, not owned AutoCAD PID $automationProcessId." }
  $menuRect = New-Object VisualContextMenuProcess+RECT
  if (-not [VisualContextMenuProcess]::GetWindowRect($menuHwnd, [ref]$menuRect)) { throw 'Could not measure the owned AutoCAD popup menu.' }
  $menuWidth = $menuRect.Right - $menuRect.Left
  $menuHeight = $menuRect.Bottom - $menuRect.Top
  if ($menuWidth -le 0 -or $menuHeight -le 0) { throw "Invalid AutoCAD popup geometry ${menuWidth}x${menuHeight}." }

  $bitmap = New-Object Drawing.Bitmap(1920, 1080, [Drawing.Imaging.PixelFormat]::Format24bppRgb)
  try {
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try { $graphics.CopyFromScreen(0, 0, 0, 0, $bitmap.Size, [Drawing.CopyPixelOperation]::SourceCopy) }
    finally { $graphics.Dispose() }
    $bitmap.Save($pngPath, [Drawing.Imaging.ImageFormat]::Png)
  } finally { $bitmap.Dispose() }

  $shell = New-Object -ComObject WScript.Shell
  $shell.SendKeys('{ESC}')
  Start-Sleep -Milliseconds 250
  Wait-AcadIdle $scratch
  $result = [ordered]@{
    schemaVersion = 1
    benchmark = 'AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation'
    state = 'drawing-context-menu'
    engineVersion = [string](Invoke-ComRetry { $acad.Version })
    workspace = [string](Invoke-ComRetry { $scratch.GetVariable('WSCURRENT') })
    colorTheme = [int](Invoke-ComRetry { $scratch.GetVariable('COLORTHEME') })
    shortcutMenu = [int](Invoke-ComRetry { $scratch.GetVariable('SHORTCUTMENU') })
    automationProcessOwned = $true
    automationProcessIdentity = [ordered]@{ processId=$automationProcessId; executablePath=$ownedExecutablePath; startTimeUtc=$ownedStartTime.ToUniversalTime().ToString('o') }
    mainWindow = [ordered]@{ x=0; y=0; width=1920; height=1080 }
    pointer = [ordered]@{ x=$anchor.X; y=$anchor.Y }
    popup = [ordered]@{ x=$menuRect.Left; y=$menuRect.Top; width=$menuWidth; height=$menuHeight; className=$menuClass; processId=[int]$menuProcessId }
    windowDpi = [int][VisualContextMenuProcess]::GetDpiForWindow([IntPtr]$mainHwnd)
    capture = [ordered]@{ width=1920; height=1080; sha256=(Get-Sha256 $pngPath) }
    redistributablePixelsIncluded = $false
    outputRef = 'private://autocad-2024/drawing-context-menu'
    checkedAt = [DateTimeOffset]::Now.ToString('o')
  }
} finally {
  if ($mainOriginal -and $mainHwnd) {
    $originalWidth = $mainOriginal.Right - $mainOriginal.Left
    $originalHeight = $mainOriginal.Bottom - $mainOriginal.Top
    [void][VisualContextMenuProcess]::MoveWindow([IntPtr]$mainHwnd, $mainOriginal.Left, $mainOriginal.Top, $originalWidth, $originalHeight, $true)
  }
  if ($scratch) { try { Invoke-ComRetry { $scratch.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
  if ($acad) { try { Invoke-ComRetry { $acad.Quit() } -TimeoutSeconds 10 | Out-Null } catch {} }
  if ($automationProcessId -gt 0 -and $ownedExecutablePath -and $ownedStartTime) {
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while ((Get-Process -Id $automationProcessId -ErrorAction SilentlyContinue) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 200 }
    if (Test-OwnedProcessIdentity $automationProcessId $ownedExecutablePath $ownedStartTime) {
      Stop-Process -Id $automationProcessId -Force
      Start-Sleep -Milliseconds 300
    }
  }
}

if (-not $result) { throw 'Visual AutoCAD context-menu audit produced no result.' }
$postExistingProcessIds = @(Get-Process -Name 'acad' -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.Id } | Sort-Object)
$result['preExistingProcessIds'] = @($preExistingProcessIds | Sort-Object)
$result['postExistingProcessIds'] = $postExistingProcessIds
$result['processSetRestored'] = (@($preExistingProcessIds | Sort-Object) -join ',') -eq ($postExistingProcessIds -join ',')
$result['automationProcessTerminated'] = -not [bool](Get-Process -Id $automationProcessId -ErrorAction SilentlyContinue)
$result['status'] = if ($result.processSetRestored -and $result.automationProcessTerminated -and $result.popup.className -eq '#32768') { 'PASS' } else { 'FAIL' }
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $jsonPath -Encoding utf8
$result | ConvertTo-Json -Depth 8
if ($result.status -ne 'PASS') { exit 1 }
