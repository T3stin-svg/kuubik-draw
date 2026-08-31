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
  if ($reference.Width -ne 1920 -or $reference.Height -ne 1080) { throw 'Top-chrome comparison requires a 1920x1080 AutoCAD reference.' }
  $zones = Get-Content -Raw -LiteralPath $KuubikZonesJson | ConvertFrom-Json
  $state = Get-Content -Raw -LiteralPath $KuubikStateJson | ConvertFrom-Json
  $waveName = Split-Path -Leaf (Split-Path -Parent $KuubikStateJson)
  if (@($zones.viewport)[0] -ne 1920 -or @($zones.viewport)[1] -ne 1080) { throw 'Top-chrome comparison requires a 1920x1080 Kuubik read-back.' }

  $expectedZones = [ordered]@{
    titlebar = [ordered]@{ y = 0; height = 30 }
    ribbonTabs = [ordered]@{ y = 30; height = 22 }
    ribbon = [ordered]@{ y = 52; height = 99 }
    documentTabs = [ordered]@{ y = 151; height = 30 }
  }
  $actualZones = [ordered]@{
    titlebar = $zones.zones.titlebar
    ribbonTabs = $zones.zones.'ribbon-tabs'
    ribbon = $zones.zones.ribbon
    documentTabs = $zones.zones.'document-tabs'
  }
  foreach ($name in @('titlebar', 'ribbonTabs', 'ribbon', 'documentTabs')) {
    Assert-Close ([double]$actualZones[$name].y) ([double]$expectedZones[$name].y) 1 $name
    Assert-Close ([double]$actualZones[$name].height) ([double]$expectedZones[$name].height) 1 "$name height"
  }

  $chrome = $state.states.topChrome
  Assert-Close ([double]$chrome.title.applicationMark.x) 15 1 'Application mark x'
  Assert-Close ([double]$chrome.title.applicationMark.width) 24 1 'Application mark width'
  Assert-Close ([double]$chrome.title.workspace.x) 574 2 'Workspace x'
  Assert-Close ([double]$chrome.title.workspace.width) 180 2 'Workspace width'
  Assert-Close ([double]$chrome.ribbonTabs.home.x) 0 1 'Home tab x'
  Assert-Close ([double]$chrome.ribbonTabs.home.right) 55 1 'Home tab right'
  Assert-Close ([double]$chrome.documentTabs.drawing.x) 90 1 'Drawing tab x'
  Assert-Close ([double]$chrome.documentTabs.drawing.right) 185 2 'Drawing tab right'

  $surface = [ordered]@{
    titlebar = [ordered]@{ autoCad = Get-RgbHex $reference.GetPixel(1700, 29); kuubik = [string]$chrome.title.backgroundColor }
    ribbonTabs = [ordered]@{ autoCad = Get-RgbHex $reference.GetPixel(1700, 30); kuubik = '#222933' }
    ribbon = [ordered]@{ autoCad = Get-RgbHex $reference.GetPixel(1700, 52); kuubik = [string]$state.states.ribbon.panels.draw.backgroundColor }
    documentTabs = [ordered]@{ autoCad = Get-RgbHex $reference.GetPixel(1700, 151); kuubik = '#222933' }
  }
  if ($surface.titlebar.autoCad -ne '#222933' -or $surface.titlebar.kuubik -ne 'rgb(34, 41, 51)' -or
      $surface.ribbonTabs.autoCad -ne '#222933' -or $surface.ribbon.autoCad -ne '#3b4453' -or
      $surface.ribbon.kuubik -ne 'rgb(59, 68, 83)' -or $surface.documentTabs.autoCad -ne '#222933') {
    throw 'AutoCAD and Kuubik top-chrome surfaces do not match.'
  }

  $result = [ordered]@{
    reference = [ordered]@{
      product = 'AutoCAD 2024.1.2'
      workspace = 'Drafting & Annotation'
      ref = 'private://autocad-2024/idle'
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
    expectedZones = $expectedZones
    actualZones = $actualZones
    surfaces = $surface
    measuredControls = [ordered]@{
      applicationMark = $chrome.title.applicationMark
      quickAccess = $chrome.title.quickAccess
      workspace = $chrome.title.workspace
      displayControls = $chrome.title.displayControls
      homeTab = $chrome.ribbonTabs.home
      drawingTab = $chrome.documentTabs.drawing
    }
    tolerancePx = 2
    scope = 'Top application chrome zone heights, surfaces, active Home/drawing tab bounds and title controls only; this does not authorize a five-category score increase.'
    status = 'PASS'
  }
  $directory = Split-Path -Parent $OutputJson
  if ($directory) { [void](New-Item -ItemType Directory -Force -Path $directory) }
  $json = $result | ConvertTo-Json -Depth 10
  [System.IO.File]::WriteAllText([System.IO.Path]::GetFullPath($OutputJson), "$json`n", [System.Text.UTF8Encoding]::new($false))
} finally {
  $reference.Dispose()
}
