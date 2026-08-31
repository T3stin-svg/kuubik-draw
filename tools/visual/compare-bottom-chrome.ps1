param(
  [Parameter(Mandatory = $true)][string]$ReferenceImage,
  [Parameter(Mandatory = $true)][string]$KuubikZonesJson,
  [Parameter(Mandatory = $true)][string]$KuubikStateJson,
  [Parameter(Mandatory = $true)][string]$ExpectedReferenceSha256,
  [Parameter(Mandatory = $true)][string]$OutputJson
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Get-ImageSha256([string]$Path) {
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Get-RgbHex([System.Drawing.Color]$Pixel) {
  return '#{0:x2}{1:x2}{2:x2}' -f $Pixel.R, $Pixel.G, $Pixel.B
}

function Assert-Close([double]$Actual, [double]$Expected, [double]$Tolerance, [string]$Label) {
  if ([math]::Abs($Actual - $Expected) -gt $Tolerance) {
    throw "$Label differs by more than the fixed +/-$Tolerance px tolerance."
  }
}

$expectedSha = $ExpectedReferenceSha256.ToLowerInvariant()
$actualReferenceSha = Get-ImageSha256 $ReferenceImage
if ($actualReferenceSha -ne $expectedSha) { throw 'Private AutoCAD reference SHA-256 mismatch.' }

$reference = [System.Drawing.Bitmap]::FromFile((Resolve-Path -LiteralPath $ReferenceImage))
try {
  if ($reference.Width -ne 1920 -or $reference.Height -ne 1080) { throw 'Bottom-chrome comparison requires a 1920x1080 AutoCAD reference.' }
  $zones = Get-Content -Raw -LiteralPath $KuubikZonesJson | ConvertFrom-Json
  $state = Get-Content -Raw -LiteralPath $KuubikStateJson | ConvertFrom-Json
  $waveName = Split-Path -Leaf (Split-Path -Parent $KuubikStateJson)
  if (@($zones.viewport)[0] -ne 1920 -or @($zones.viewport)[1] -ne 1080) { throw 'Bottom-chrome comparison requires a 1920x1080 Kuubik read-back.' }

  $layoutStatus = $state.states.bottomChrome.layoutStatus
  $statusbar = $state.states.bottomChrome.statusbar
  Assert-Close ([double]$layoutStatus.y) 1043 1 'Layout/status zone y'
  Assert-Close ([double]$layoutStatus.height) 37 1 'Layout/status zone height'
  Assert-Close ([double]$layoutStatus.width) 1920 1 'Layout/status zone width'
  Assert-Close ([double]$statusbar.y) 1047 1 'Status controls y'
  Assert-Close ([double]$statusbar.height) 32 1 'Status controls height'
  Assert-Close ([double]$statusbar.bottom) 1079 1 'Status controls bottom'

  $surface = [ordered]@{
    separator = [ordered]@{ autoCad = Get-RgbHex $reference.GetPixel(1200, 1043); kuubik = [string]$layoutStatus.borderTopColor; thicknessPx = 4 }
    content = [ordered]@{ autoCad = Get-RgbHex $reference.GetPixel(1200, 1047); kuubik = [string]$layoutStatus.backgroundColor; heightPx = 32 }
    accent = [ordered]@{ autoCad = Get-RgbHex $reference.GetPixel(1200, 1079); kuubik = [string]$layoutStatus.borderBottomColor; thicknessPx = 1 }
  }
  if ($surface.separator.autoCad -ne '#3b4453' -or $surface.separator.kuubik -ne 'rgb(59, 68, 83)' -or
      $surface.content.autoCad -ne '#222933' -or $surface.content.kuubik -ne 'rgb(34, 41, 51)' -or
      $surface.accent.autoCad -ne '#0696d7' -or $surface.accent.kuubik -ne 'rgb(6, 150, 215)') {
    throw 'AutoCAD and Kuubik bottom-chrome surfaces do not match.'
  }

  $controls = $state.states.statusControls
  if ($controls.grid.disabled -or $controls.grid.pressed -ne 'true' -or $controls.grid.backgroundColor -ne 'rgb(23, 106, 153)') {
    throw 'GRID control must expose its active enabled state.'
  }
  foreach ($name in @('ortho', 'osnap', 'otrack', 'dyn')) {
    if (-not $controls.$name.disabled -or $null -ne $controls.$name.pressed -or $controls.$name.color -ne 'rgb(120, 130, 139)') {
      throw "$name must expose an honest disabled state."
    }
  }

  $result = [ordered]@{
    reference = [ordered]@{
      product = 'AutoCAD 2024.1.2'
      workspace = 'Drafting & Annotation'
      ref = 'private://autocad-2024/line-active'
      sha256 = $actualReferenceSha
      redistributablePixelsIncluded = $false
    }
    kuubik = [ordered]@{
      zonesArtifact = "evidence/artifacts/$waveName/visual-shell-zones.json"
      stateArtifact = "evidence/artifacts/$waveName/visual-shell-states.json"
      screenshot = "evidence/artifacts/$waveName/visual-shell-empty-workspace.png"
    }
    viewport = @(1920, 1080)
    browserZoomPercent = 100
    windowsDpiScalePercent = 100
    expectedGeometry = [ordered]@{
      layoutStatus = [ordered]@{ x = 0; y = 1043; width = 1920; height = 37 }
      statusbar = [ordered]@{ y = 1047; height = 32; bottom = 1079 }
    }
    actualGeometry = [ordered]@{
      layoutStatus = $layoutStatus
      statusbar = $statusbar
    }
    surfaces = $surface
    statusControls = $controls
    tolerancePx = 1
    scope = 'Shared Model/Layout and status-bar zone geometry, surfaces, accent and implemented control states only; the floating command line and five-category score remain separately gated.'
    status = 'PASS'
  }
  $directory = Split-Path -Parent $OutputJson
  if ($directory) { [void](New-Item -ItemType Directory -Force -Path $directory) }
  $json = $result | ConvertTo-Json -Depth 10
  [System.IO.File]::WriteAllText([System.IO.Path]::GetFullPath($OutputJson), "$json`n", [System.Text.UTF8Encoding]::new($false))
} finally {
  $reference.Dispose()
}
