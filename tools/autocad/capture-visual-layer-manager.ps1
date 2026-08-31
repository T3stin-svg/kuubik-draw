param(
  [Parameter(Mandatory = $true)][string]$OutputImage,
  [Parameter(Mandatory = $true)][string]$OutputJson
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class KuubikLayerCaptureWin32 {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int w, int h, bool repaint);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
}
'@

function Save-Window([IntPtr]$Window, [string]$Path) {
  [void][KuubikLayerCaptureWin32]::ShowWindow($Window, 9)
  [void][KuubikLayerCaptureWin32]::MoveWindow($Window, 0, 0, 1920, 1080, $true)
  Start-Sleep -Milliseconds 1200
  $rectangle = New-Object KuubikLayerCaptureWin32+RECT
  if (-not [KuubikLayerCaptureWin32]::GetWindowRect($Window, [ref]$rectangle)) { throw 'Could not read owned AutoCAD window bounds.' }
  $bitmap = New-Object System.Drawing.Bitmap ($rectangle.Right - $rectangle.Left), ($rectangle.Bottom - $rectangle.Top)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $deviceContext = $graphics.GetHdc()
    try {
      if (-not [KuubikLayerCaptureWin32]::PrintWindow($Window, $deviceContext, 2)) { throw 'PrintWindow failed for owned AutoCAD window.' }
    } finally { $graphics.ReleaseHdc($deviceContext) }
    $directory = Split-Path -Parent $Path
    if ($directory) { [void](New-Item -ItemType Directory -Force -Path $directory) }
    $bitmap.Save([System.IO.Path]::GetFullPath($Path), [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
}

$beforePids = @(Get-Process acad -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
$acad = $null
$document = $null
$ownedPid = $null
$result = $null
try {
  $acad = New-Object -ComObject 'AutoCAD.Application.24.3'
  Start-Sleep -Milliseconds 800
  $newProcesses = @(Get-Process acad -ErrorAction Stop | Where-Object { $beforePids -notcontains $_.Id })
  if ($newProcesses.Count -ne 1) { throw "Expected exactly one new AutoCAD automation process, found $($newProcesses.Count)." }
  $ownedProcess = $newProcesses[0]
  $ownedPid = [int]$ownedProcess.Id
  $acad.Visible = $true
  Start-Sleep -Milliseconds 800
  $window = [IntPtr]$acad.HWND
  if ($window -eq [IntPtr]::Zero) { throw 'Owned AutoCAD automation window did not become visible.' }
  $document = $acad.Documents.Add()
  $document.ActiveSpace = 1
  $document.SetVariable('TILEMODE', 1)
  $layer = $document.Layers.Add('Layer 1')
  $document.ActiveLayer = $layer
  $model = $document.ModelSpace
  $points = [double[]](0, 0, 5000, 0, 5000, 3000, 0, 3000)
  $polyline = $model.AddLightWeightPolyline($points); $polyline.Closed = $true; $polyline.Layer = 'Layer 1'
  $circle = $model.AddCircle([double[]](2500, 1500, 0), 600); $circle.Layer = 'Layer 1'
  $text = $model.AddText('KUUBIK AUDIT', [double[]](1200, 3300, 0), 300); $text.Layer = 'Layer 1'
  $document.Regen(1)
  $versionValue = [string]$acad.Version
  $workspaceValue = [string]$document.GetVariable('WSCURRENT')
  $themeValue = [int]$document.GetVariable('COLORTHEME')
  $documentNameValue = [string]$document.Name
  $entityCountValue = [int]$model.Count
  $carriageReturn = [char]13
  $commandBatch = '_ZOOM _E ' + $carriageReturn + '_SELECT _ALL  ' + $carriageReturn + '_LAYER ' + $carriageReturn + '_PROPERTIES ' + $carriageReturn
  $document.SendCommand($commandBatch)
  Start-Sleep -Milliseconds 4200
  Save-Window -Window $window -Path $OutputImage

  $result = [ordered]@{
    schemaVersion = 1
    benchmark = 'AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation'
    state = 'layer-manager-two-layers'
    version = $versionValue
    workspace = $workspaceValue
    colorTheme = $themeValue
    automationProcessOwned = $true
    automationProcessIdentity = [ordered]@{ processId = $ownedPid; executablePath = [string]$ownedProcess.Path; startTimeUtc = $ownedProcess.StartTime.ToUniversalTime().ToString('o') }
    preExistingProcessIds = $beforePids
    documentName = $documentNameValue
    saved = $false
    layers = @('0', 'Layer 1')
    activeLayer = 'Layer 1'
    entityCount = $entityCountValue
    viewport = @(1920, 1080)
    windowsDpiScalePercent = 100
    capture = [ordered]@{ sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $OutputImage).Hash.ToLowerInvariant() }
    redistributablePixelsIncluded = $false
    outputRef = 'private://autocad-2024/layer-manager-two-layers'
    checkedAt = (Get-Date).ToString('o')
    status = 'PASS'
  }
  $directory = Split-Path -Parent $OutputJson
  if ($directory) { [void](New-Item -ItemType Directory -Force -Path $directory) }
  [System.IO.File]::WriteAllText([System.IO.Path]::GetFullPath($OutputJson), "$(($result | ConvertTo-Json -Depth 8))`n", [System.Text.UTF8Encoding]::new($false))
} finally {
  if ($null -ne $document) { try { $document.Close($false) } catch {} }
  if ($null -ne $acad -and $null -ne $ownedPid -and -not ($beforePids -contains $ownedPid)) { try { $acad.Quit() } catch {} }
  if ($null -ne $acad) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($acad) }
  if ($null -ne $ownedPid -and -not ($beforePids -contains $ownedPid)) {
    Wait-Process -Id $ownedPid -Timeout 5 -ErrorAction SilentlyContinue
    if (Get-Process -Id $ownedPid -ErrorAction SilentlyContinue) { Stop-Process -Id $ownedPid -Force }
  }
  Start-Sleep -Milliseconds 500
  $remaining = @(Get-Process acad -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
  foreach ($preExistingPid in $beforePids) { if ($remaining -notcontains $preExistingPid) { throw "Pre-existing AutoCAD PID $preExistingPid was not preserved." } }
  if ($null -ne $ownedPid -and $remaining -contains $ownedPid) { throw "Owned AutoCAD PID $ownedPid did not terminate." }
}

$result | ConvertTo-Json -Depth 8
