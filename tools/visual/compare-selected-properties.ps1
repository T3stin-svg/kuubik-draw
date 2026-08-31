param(
  [Parameter(Mandatory = $true)][string]$ReferenceImage,
  [Parameter(Mandatory = $true)][string]$KuubikImage,
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
$kuubik = [System.Drawing.Bitmap]::FromFile((Resolve-Path -LiteralPath $KuubikImage))
try {
  if ($reference.Width -ne 1920 -or $reference.Height -ne 1080) { throw 'Selected-properties comparison requires a 1920x1080 AutoCAD reference.' }
  if ($kuubik.Width -ne 1920 -or $kuubik.Height -ne 1080) { throw 'Selected-properties comparison requires a 1920x1080 Kuubik screenshot.' }
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

  $fixture = $state.states.selectedFixture
  if ((@($fixture.entityKinds) -join ',') -ne 'circle,polyline,text') { throw 'Selected fixture must contain exactly CIRCLE, closed POLYLINE and TEXT.' }
  if ((@($fixture.handles) -join ',') -ne 'A1,A2,A3' -or (@($fixture.selectedHandles) -join ',') -ne 'A1,A2,A3') {
    throw 'Selected fixture handles and live selection do not match.'
  }
  if (-not $fixture.polyline.closed -or @($fixture.polyline.vertices).Count -ne 4) { throw 'Selected fixture outer POLYLINE is not a closed four-vertex boundary.' }
  $expectedFixture = [ordered]@{
    canvasTop = 181
    polyline = [ordered]@{
      topLeft = [ordered]@{ x = 785; y = 195 }
      bottomRight = [ordered]@{ x = 1812; y = 811 }
    }
    circle = [ordered]@{ center = [ordered]@{ x = 1298; y = 503 }; radiusPx = 123.5 }
    text = [ordered]@{ value = 'KUUBIK AUDIT'; insertion = [ordered]@{ x = 1032; y = 134 }; heightPx = 75 }
  }
  Assert-Close ([double]$fixture.polyline.vertices[0].x) $expectedFixture.polyline.topLeft.x 1 'Selected POLYLINE left'
  Assert-Close ([double]$fixture.polyline.vertices[0].y) $expectedFixture.polyline.topLeft.y 1 'Selected POLYLINE top'
  Assert-Close ([double]$fixture.polyline.vertices[2].x) $expectedFixture.polyline.bottomRight.x 1 'Selected POLYLINE right'
  Assert-Close ([double]$fixture.polyline.vertices[2].y) $expectedFixture.polyline.bottomRight.y 1 'Selected POLYLINE bottom'
  Assert-Close ([double]$fixture.circle.center.x) $expectedFixture.circle.center.x 1 'Selected CIRCLE center x'
  Assert-Close ([double]$fixture.circle.center.y) $expectedFixture.circle.center.y 1 'Selected CIRCLE center y'
  Assert-Close ([double]$fixture.circle.radiusPx) $expectedFixture.circle.radiusPx 1 'Selected CIRCLE radius'
  if ([string]$fixture.text.value -ne $expectedFixture.text.value) { throw 'Selected TEXT value does not match the owned AutoCAD fixture.' }
  Assert-Close ([double]$fixture.text.insertion.x) $expectedFixture.text.insertion.x 1 'Selected TEXT insertion x'
  Assert-Close ([double]$fixture.text.insertion.y) $expectedFixture.text.insertion.y 1 'Selected TEXT insertion y'
  Assert-Close ([double]$fixture.text.heightPx) $expectedFixture.text.heightPx 1 'Selected TEXT height'
  if ([int]$state.states.staleMovePreviewPixels -ne 0) { throw 'Idle mixed selection rendered a stale MOVE preview.' }

  $viewIndicator = $state.states.modelNavigation.viewIndicatorGeometry
  $expectedViewIndicator = [ordered]@{
    x = 1794; y = 228; width = 76; height = 155
    face = [ordered]@{
      top = '38px'; left = '12px'; width = '52px'; height = '52px'
      backgroundColor = 'rgba(86, 96, 105, 0.12)'
      borderColor = 'rgba(122, 130, 137, 0.46)'
      transform = 'none'
    }
  }
  foreach ($propertyName in @('x', 'y', 'width', 'height')) {
    Assert-Close ([double]$viewIndicator.$propertyName) ([double]$expectedViewIndicator[$propertyName]) 1 "View indicator $propertyName"
  }
  foreach ($propertyName in $expectedViewIndicator.face.Keys) {
    if ([string]$viewIndicator.face.$propertyName -ne [string]$expectedViewIndicator.face[$propertyName]) {
      throw "View indicator face $propertyName differs from the measured AutoCAD Top-view treatment."
    }
  }

  $paletteIconography = @($state.states.paletteIconography)
  if ($paletteIconography.Count -ne 20 -or @($paletteIconography | Where-Object { [int]$_.pathCount -lt 1 }).Count -ne 0) {
    throw 'Layer Manager and Properties must expose 20 non-empty original vector icons in the measured two-layer state.'
  }
  $expectedPaletteGroups = [ordered]@{ toolbar = @(6, 16); 'filter-rail' = @(2, 13); 'layer-row' = @(9, 13); 'properties-tools' = @(3, 15) }
  foreach ($surface in $expectedPaletteGroups.Keys) {
    $expectedCount = [int]$expectedPaletteGroups[$surface][0]
    $expectedSize = [double]$expectedPaletteGroups[$surface][1]
    $matches = @($paletteIconography | Where-Object { $_.surface -eq $surface -and [double]$_.width -eq $expectedSize -and [double]$_.height -eq $expectedSize })
    if ($matches.Count -ne $expectedCount) { throw "Palette icon group $surface is outside its measured count/size contract." }
  }

  $gripCenters = @(
    @(785, 376), @(1298, 376), @(1812, 376),
    @(785, 684), @(1298, 684), @(1812, 684),
    @(785, 992), @(1298, 992), @(1812, 992),
    @(1175, 684), @(1422, 684), @(1298, 561), @(1298, 808),
    @(1032, 315)
  )
  $gripReadback = foreach ($point in $gripCenters) {
    $referenceColor = Get-RgbHex $reference.GetPixel([int]$point[0], [int]$point[1])
    $kuubikColor = Get-RgbHex $kuubik.GetPixel([int]$point[0], [int]$point[1])
    if ($referenceColor -ne '#007fff' -or $kuubikColor -ne '#007fff') {
      throw "Selected grip fill mismatch at $($point -join ','): AutoCAD=$referenceColor Kuubik=$kuubikColor."
    }
    [ordered]@{ x = [int]$point[0]; y = [int]$point[1]; autoCad = $referenceColor; kuubik = $kuubikColor }
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
      screenshotSha256 = Get-ImageSha256 $KuubikImage
    }
    viewport = @(1920, 1080)
    browserZoomPercent = 100
    windowsDpiScalePercent = 100
    expectedGeometry = $expectedGeometry
    actualGeometry = $geometry
    surfaces = $surfaceSamples
    expectedFixture = $expectedFixture
    actualFixture = $fixture
    staleMovePreviewPixels = [int]$state.states.staleMovePreviewPixels
    selectionFeedback = [ordered]@{
      expectedSelectionColor = '#0478ec'
      expectedGripFill = '#007fff'
      expectedGripStroke = '#283747'
      gripCenters = @($gripReadback)
    }
    expectedViewIndicator = $expectedViewIndicator
    actualViewIndicator = $viewIndicator
    paletteIconography = $paletteIconography
    paletteIconSource = 'original-kuubik-inline-svg'
    tolerancePx = 1
    scope = 'Selected-object TEXT/POLYLINE/CIRCLE fixture, projected geometry, Properties and Layer Properties Manager split, density, repeated rows and sampled palette surfaces; the five-category visual score remains separately gated.'
    status = 'PASS'
  }
  $directory = Split-Path -Parent $OutputJson
  if ($directory) { [void](New-Item -ItemType Directory -Force -Path $directory) }
  $json = $result | ConvertTo-Json -Depth 12
  [System.IO.File]::WriteAllText([System.IO.Path]::GetFullPath($OutputJson), "$json`n", [System.Text.UTF8Encoding]::new($false))
} finally {
  $reference.Dispose()
  $kuubik.Dispose()
}
