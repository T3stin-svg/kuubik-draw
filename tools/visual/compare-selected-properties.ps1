param(
  [Parameter(Mandatory = $true)][string]$ReferenceImage,
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
  if ($reference.Width -ne 1920 -or $reference.Height -ne 1080) { throw 'Selected-properties comparison requires a 1920x1080 AutoCAD reference.' }
  $state = Get-Content -Raw -LiteralPath $KuubikStateJson | ConvertFrom-Json
  $waveName = Split-Path -Leaf (Split-Path -Parent $KuubikStateJson)
  if (@($state.viewport)[0] -ne 1920 -or @($state.viewport)[1] -ne 1080) { throw 'Selected-properties comparison requires a 1920x1080 Kuubik read-back.' }

  $selected = $state.states.selectedProperties
  if (-not $selected.visible) { throw 'Kuubik selected-properties state was not visible.' }
  $geometry = $selected.geometry
  $expectedGeometry = [ordered]@{
    palette = [ordered]@{ x = 0; y = 181; width = 680; height = 862; bottom = 1043 }
    layerManager = [ordered]@{ y = 181; height = 513; bottom = 694 }
    propertiesHeader = [ordered]@{ y = 694; height = 20; bottom = 714 }
    selectionSummary = [ordered]@{ y = 727; height = 22; bottom = 749 }
    generalHeader = [ordered]@{ y = 753; height = 20; bottom = 773 }
    threeDHeader = [ordered]@{ y = 944; height = 20; bottom = 964 }
    materialRow = [ordered]@{ y = 964; height = 19; bottom = 983 }
    plotStyleHeader = [ordered]@{ y = 983; height = 20; bottom = 1003 }
    viewHeader = [ordered]@{ y = 1003; height = 20; bottom = 1023 }
    dataHeader = [ordered]@{ y = 1023; height = 20; bottom = 1043 }
  }
  foreach ($zoneName in $expectedGeometry.Keys) {
    foreach ($propertyName in $expectedGeometry[$zoneName].Keys) {
      Assert-Close ([double]$geometry.$zoneName.$propertyName) ([double]$expectedGeometry[$zoneName][$propertyName]) 1 "$zoneName.$propertyName"
    }
  }
  if (@($geometry.generalRows).Count -ne 9) { throw 'AutoCAD General palette density requires exactly nine measured rows.' }
  foreach ($row in @($geometry.generalRows)) { Assert-Close ([double]$row.height) 19 1 'General property-row height' }

  $surfaceSamples = [ordered]@{
    layerHeader = [ordered]@{ point = @(300, 195); autoCad = Get-RgbHex $reference.GetPixel(300, 195); kuubik = [string]$geometry.surfaces.layerHeader }
    layerCurrent = [ordered]@{ point = @(300, 225); autoCad = Get-RgbHex $reference.GetPixel(300, 225); kuubik = [string]$geometry.surfaces.layerCurrent }
    layerToolbar = [ordered]@{ point = @(300, 248); autoCad = Get-RgbHex $reference.GetPixel(300, 248); kuubik = [string]$geometry.surfaces.layerToolbar }
    layerRail = [ordered]@{ point = @(100, 400); autoCad = Get-RgbHex $reference.GetPixel(100, 400); kuubik = [string]$geometry.surfaces.layerRail }
    layerGrid = [ordered]@{ point = @(300, 400); autoCad = Get-RgbHex $reference.GetPixel(300, 400); kuubik = [string]$geometry.surfaces.layerGrid }
    layerGridHeader = [ordered]@{ point = @(300, 270); autoCad = Get-RgbHex $reference.GetPixel(300, 270); kuubik = [string]$geometry.surfaces.layerGridHeader }
    layerActiveRow = [ordered]@{ point = @(300, 292); autoCad = Get-RgbHex $reference.GetPixel(300, 292); kuubik = [string]$geometry.surfaces.layerActiveRow }
    layerSummary = [ordered]@{ point = @(300, 675); autoCad = Get-RgbHex $reference.GetPixel(300, 675); kuubik = [string]$geometry.surfaces.layerSummary }
    propertiesHeader = [ordered]@{ point = @(300, 705); autoCad = Get-RgbHex $reference.GetPixel(300, 705); kuubik = [string]$geometry.surfaces.propertiesHeader }
    selectionSummary = [ordered]@{ point = @(300, 738); autoCad = Get-RgbHex $reference.GetPixel(300, 738); kuubik = [string]$geometry.surfaces.selectionSummary }
    sectionHeader = [ordered]@{ point = @(300, 763); autoCad = Get-RgbHex $reference.GetPixel(300, 763); kuubik = [string]$geometry.surfaces.sectionHeader }
    propertyName = [ordered]@{ point = @(100, 782); autoCad = Get-RgbHex $reference.GetPixel(100, 782); kuubik = [string]$geometry.surfaces.palette }
    propertyValue = [ordered]@{ point = @(500, 782); autoCad = Get-RgbHex $reference.GetPixel(500, 782); kuubik = [string]$geometry.surfaces.propertyValue }
  }
  $expectedCss = @{ '#2e3440' = 'rgb(46, 52, 64)'; '#3b4453' = 'rgb(59, 68, 83)'; '#454f61' = 'rgb(69, 79, 97)'; '#7487a5' = 'rgb(116, 135, 165)'; '#4e5a6e' = 'rgb(78, 90, 110)' }
  foreach ($sample in $surfaceSamples.Values) {
    if (-not $expectedCss.ContainsKey($sample.autoCad) -or $expectedCss[$sample.autoCad] -ne $sample.kuubik) {
      throw "AutoCAD and Kuubik selected-properties surface mismatch at $($sample.point -join ',')."
    }
  }

  $result = [ordered]@{
    reference = [ordered]@{
      product = 'AutoCAD 2024.1.2'
      workspace = 'Drafting & Annotation'
      ref = 'private://autocad-2024/selected-properties'
      sha256 = $actualReferenceSha
      redistributablePixelsIncluded = $false
    }
    kuubik = [ordered]@{
      stateArtifact = "evidence/artifacts/$waveName/visual-shell-states.json"
      screenshot = "evidence/artifacts/$waveName/visual-shell-selected-properties.png"
    }
    viewport = @(1920, 1080)
    browserZoomPercent = 100
    windowsDpiScalePercent = 100
    expectedGeometry = $expectedGeometry
    actualGeometry = $geometry
    surfaces = $surfaceSamples
    tolerancePx = 1
    scope = 'Selected-object Properties and Layer Properties Manager split, density, repeated row geometry and sampled palette surfaces only; entity fixture completeness and five-category visual score remain separately gated.'
    status = 'PASS'
  }
  $directory = Split-Path -Parent $OutputJson
  if ($directory) { [void](New-Item -ItemType Directory -Force -Path $directory) }
  $json = $result | ConvertTo-Json -Depth 12
  [System.IO.File]::WriteAllText([System.IO.Path]::GetFullPath($OutputJson), "$json`n", [System.Text.UTF8Encoding]::new($false))
} finally {
  $reference.Dispose()
}
