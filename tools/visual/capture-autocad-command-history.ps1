param(
  [Parameter(Mandatory = $true)][string]$OutputPng,
  [Parameter(Mandatory = $true)][string]$OutputJson
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class VisualAuditWindowProcess {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")]
  public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int width, int height, bool repaint);
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll")]
  public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint flags);
  [DllImport("user32.dll")]
  public static extern uint GetDpiForWindow(IntPtr hWnd);
  private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")]
  private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")]
  private static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maximumCount);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern int GetClassName(IntPtr hWnd, StringBuilder className, int maximumCount);
  public static IntPtr[] GetVisibleTopLevelWindows(uint processId) {
    var windows = new List<IntPtr>();
    EnumWindows((window, ignored) => {
      uint candidateProcessId;
      GetWindowThreadProcessId(window, out candidateProcessId);
      if (candidateProcessId == processId && IsWindowVisible(window)) windows.Add(window);
      return true;
    }, IntPtr.Zero);
    return windows.ToArray();
  }
  public static string GetTitle(IntPtr hWnd) {
    var text = new StringBuilder(GetWindowTextLength(hWnd) + 1);
    GetWindowText(hWnd, text, text.Capacity);
    return text.ToString();
  }
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
  throw 'AutoCAD did not return idle during the visual command-history audit.'
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

function Save-WindowCapture {
  param([Parameter(Mandatory = $true)][int64]$Hwnd, [Parameter(Mandatory = $true)][string]$Path)
  $original = New-Object VisualAuditWindowProcess+RECT
  if (-not [VisualAuditWindowProcess]::GetWindowRect([IntPtr]$Hwnd, [ref]$original)) {
    throw 'Could not read the original owned AutoCAD TEXTSCR window bounds.'
  }
  $originalWidth = $original.Right - $original.Left
  $originalHeight = $original.Bottom - $original.Top
  [void][VisualAuditWindowProcess]::ShowWindow([IntPtr]$Hwnd, 9)
  if (-not [VisualAuditWindowProcess]::MoveWindow([IntPtr]$Hwnd, 0, 0, 1920, 1080, $true)) {
    throw 'Could not set the owned AutoCAD window to the fixed 1920x1080 audit size.'
  }
  try {
    Start-Sleep -Milliseconds 1200
    $rectangle = New-Object VisualAuditWindowProcess+RECT
    if (-not [VisualAuditWindowProcess]::GetWindowRect([IntPtr]$Hwnd, [ref]$rectangle)) {
      throw 'Could not read the owned AutoCAD window bounds.'
    }
    $width = $rectangle.Right - $rectangle.Left
    $height = $rectangle.Bottom - $rectangle.Top
    if ($width -ne 1920 -or $height -ne 1080) { throw "Unexpected AutoCAD capture size ${width}x${height}." }
    $bitmap = New-Object Drawing.Bitmap($width, $height, [Drawing.Imaging.PixelFormat]::Format24bppRgb)
    try {
      $graphics = [Drawing.Graphics]::FromImage($bitmap)
      try {
        $deviceContext = $graphics.GetHdc()
        try {
          if (-not [VisualAuditWindowProcess]::PrintWindow([IntPtr]$Hwnd, $deviceContext, 2)) {
            throw 'PrintWindow failed for the owned AutoCAD window.'
          }
        } finally { $graphics.ReleaseHdc($deviceContext) }
      } finally { $graphics.Dispose() }
      $bitmap.Save($Path, [Drawing.Imaging.ImageFormat]::Png)
    } finally { $bitmap.Dispose() }
    return [ordered]@{
      width = $width
      height = $height
      sha256 = Get-Sha256 $Path
      originalWindow = [ordered]@{ x=$original.Left; y=$original.Top; width=$originalWidth; height=$originalHeight }
    }
  } finally {
    [void][VisualAuditWindowProcess]::MoveWindow([IntPtr]$Hwnd, $original.Left, $original.Top, $originalWidth, $originalHeight, $true)
  }
}

function Get-OwnedVisibleWindows {
  param([Parameter(Mandatory = $true)][uint32]$ProcessId)
  return @([VisualAuditWindowProcess]::GetVisibleTopLevelWindows($ProcessId) | ForEach-Object {
    $rectangle = New-Object VisualAuditWindowProcess+RECT
    [void][VisualAuditWindowProcess]::GetWindowRect($_, [ref]$rectangle)
    [ordered]@{
      hwnd = [int64]$_
      title = [VisualAuditWindowProcess]::GetTitle($_)
      className = [VisualAuditWindowProcess]::GetClass($_)
      width = $rectangle.Right - $rectangle.Left
      height = $rectangle.Bottom - $rectangle.Top
    }
  })
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

$preExistingProcessIds = @(Get-Process -Name 'acad' -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.Id })
$acad = $null
$scratch = $null
$automationProcessId = 0
$ownedExecutablePath = $null
$ownedStartTime = $null
$result = $null
try {
  $acad = New-Object -ComObject AutoCAD.Application.24.3
  Invoke-ComRetry { $acad.Visible = $true; $acad.WindowState = 3 } | Out-Null
  $hwnd = [int64](Invoke-ComRetry { $acad.HWND })
  [uint32]$resolvedProcessId = 0
  [void][VisualAuditWindowProcess]::GetWindowThreadProcessId([IntPtr]$hwnd, [ref]$resolvedProcessId)
  $automationProcessId = [int]$resolvedProcessId
  if ($automationProcessId -le 0 -or $preExistingProcessIds -contains $automationProcessId) {
    throw 'Visual audit refuses to use a pre-existing AutoCAD process.'
  }
  $ownedProcess = Get-Process -Id $automationProcessId -ErrorAction Stop
  $ownedExecutablePath = [IO.Path]::GetFullPath([string]$ownedProcess.Path)
  $ownedStartTime = $ownedProcess.StartTime
  if ([IO.Path]::GetFileName($ownedExecutablePath) -ine 'acad.exe') {
    throw "Visual audit PID $automationProcessId is not acad.exe."
  }

  $scratch = Invoke-ComRetry { $acad.Documents.Add() }
  if ([string](Invoke-ComRetry { $scratch.FullName }) -or [int](Invoke-ComRetry { $scratch.ModelSpace.Count }) -ne 0) {
    throw 'Visual audit refuses a saved or non-blank drawing.'
  }
  Invoke-ComRetry { $scratch.Activate() } | Out-Null
  Wait-AcadIdle $scratch
  Send-AcadCommand $scratch "_.COMMANDLINE`n"
  Send-AcadCommand $scratch "_.RECTANG`n0,0`n1000,600`n"
  Send-AcadCommand $scratch "_.CIRCLE`n500,300`n150`n"
  Send-AcadCommand $scratch "_.ZOOM`n_Extents`n"
  Send-AcadCommand $scratch "_.DIST`n0,0`n1000,600`n"
  Send-AcadCommand $scratch "_.TEXTSCR`n"
  Start-Sleep -Milliseconds 700

  $visibleWindows = @(Get-OwnedVisibleWindows -ProcessId ([uint32]$automationProcessId))
  $historyWindow = @($visibleWindows | Where-Object {
    $_.hwnd -ne $hwnd -and ($_.title -match '(?i)text|history|command' -or $_.className -match '(?i)text|history|command')
  } | Sort-Object { $_.width * $_.height } -Descending | Select-Object -First 1)
  if ($historyWindow.Count -ne 1) {
    throw "Owned AutoCAD TEXTSCR window was not uniquely resolved: $($visibleWindows | ConvertTo-Json -Depth 5 -Compress)"
  }
  $windowDpi = [int][VisualAuditWindowProcess]::GetDpiForWindow([IntPtr]$historyWindow[0].hwnd)
  if ($windowDpi -le 0) { throw 'Could not read the owned AutoCAD TEXTSCR window DPI.' }
  $capture = Save-WindowCapture -Hwnd $historyWindow[0].hwnd -Path $pngPath
  $result = [ordered]@{
    schemaVersion = 1
    benchmark = 'AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation'
    state = 'command-history-context'
    engineVersion = [string](Invoke-ComRetry { $acad.Version })
    workspace = [string](Invoke-ComRetry { $scratch.GetVariable('WSCURRENT') })
    colorTheme = [int](Invoke-ComRetry { $scratch.GetVariable('COLORTHEME') })
    commandNamesAfter = [string](Invoke-ComRetry { $scratch.GetVariable('CMDNAMES') })
    commandActiveAfter = [int](Invoke-ComRetry { $scratch.GetVariable('CMDACTIVE') })
    automationProcessOwned = $true
    automationProcessIdentity = [ordered]@{
      processId = $automationProcessId
      executablePath = $ownedExecutablePath
      startTimeUtc = $ownedStartTime.ToUniversalTime().ToString('o')
    }
    visibleOwnedWindows = $visibleWindows
    capturedWindow = $historyWindow[0]
    windowDpi = $windowDpi
    windowsDpiScalePercent = [int][Math]::Round(100 * $windowDpi / 96)
    capture = $capture
    redistributablePixelsIncluded = $false
    outputRef = 'private://autocad-2024/command-history-context'
    checkedAt = [DateTimeOffset]::Now.ToString('o')
  }
} finally {
  if ($scratch) { try { Invoke-ComRetry { $scratch.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
  if ($acad) { try { Invoke-ComRetry { $acad.Quit() } -TimeoutSeconds 10 | Out-Null } catch {} }
  if ($automationProcessId -gt 0 -and $ownedExecutablePath -and $ownedStartTime) {
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while ((Get-Process -Id $automationProcessId -ErrorAction SilentlyContinue) -and [DateTime]::UtcNow -lt $deadline) {
      Start-Sleep -Milliseconds 200
    }
    if (Test-OwnedProcessIdentity $automationProcessId $ownedExecutablePath $ownedStartTime) {
      Stop-Process -Id $automationProcessId -Force
      Start-Sleep -Milliseconds 300
    }
  }
}

if (-not $result) { throw 'Visual AutoCAD command-history audit produced no result.' }
$postExistingProcessIds = @(Get-Process -Name 'acad' -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.Id } | Sort-Object)
$result['processSetRestored'] = (@($preExistingProcessIds | Sort-Object) -join ',') -eq ($postExistingProcessIds -join ',')
$result['automationProcessTerminated'] = -not [bool](Get-Process -Id $automationProcessId -ErrorAction SilentlyContinue)
$result['status'] = if ($result.processSetRestored -and $result.automationProcessTerminated -and $result.commandNamesAfter -eq '' -and $result.commandActiveAfter -eq 0) { 'PASS' } else { 'FAIL' }
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $jsonPath -Encoding utf8
$result | ConvertTo-Json -Depth 8
if ($result.status -ne 'PASS') { exit 1 }
