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

function Assert-Close([double]$Actual, [double]$Expected, [double]$Tolerance, [string]$Label) {
  if ([math]::Abs($Actual - $Expected) -gt $Tolerance) {
    throw "$Label differs by more than the fixed +/-$Tolerance px tolerance."
  }
}

function Test-DarkPixel([System.Drawing.Color]$Pixel) {
  return (($Pixel.R + $Pixel.G + $Pixel.B) / 3) -lt 60
}

function Get-DarkBounds([System.Drawing.Bitmap]$Image, [int]$Left, [int]$Top, [int]$Right, [int]$Bottom) {
  $minX = [int]::MaxValue; $minY = [int]::MaxValue; $maxX = -1; $maxY = -1; $count = 0
  for ($y = $Top; $y -le $Bottom; $y += 1) {
    for ($x = $Left; $x -le $Right; $x += 1) {
      if (-not (Test-DarkPixel $Image.GetPixel($x, $y))) { continue }
      $count += 1
      if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x }
      if ($y -lt $minY) { $minY = $y }; if ($y -gt $maxY) { $maxY = $y }
    }
  }
  if ($count -eq 0) { throw "No dark pixels found in layout region $Left,$Top,$Right,$Bottom." }
  return [ordered]@{ left = $minX; top = $minY; right = $maxX; bottom = $maxY; darkPixels = $count }
}

$referenceSha = Get-ImageSha256 $ReferenceImage
if ($referenceSha -ne $ExpectedReferenceSha256.ToLowerInvariant()) { throw 'Private AutoCAD layout reference SHA-256 mismatch.' }
$reference = [System.Drawing.Bitmap]::FromFile((Resolve-Path -LiteralPath $ReferenceImage))
$kuubik = [System.Drawing.Bitmap]::FromFile((Resolve-Path -LiteralPath $KuubikImage))
try {
  if ($reference.Width -ne 1920 -or $reference.Height -ne 1080 -or $kuubik.Width -ne 1920 -or $kuubik.Height -ne 1080) {
    throw 'Layout comparison requires two 1920x1080 captures.'
  }
  $state = Get-Content -Raw -LiteralPath $KuubikStateJson | ConvertFrom-Json
  if (@($state.viewport)[0] -ne 1920 -or @($state.viewport)[1] -ne 1080) { throw 'Kuubik layout read-back viewport is not 1920x1080.' }
  $geometry = $state.states.layoutGeometry
  $expectedGeometry = [ordered]@{
    sheet = [ordered]@{ x = 727; y = 212; right = 1869; bottom = 1018 }
    printable = [ordered]@{ x = 803; y = 238; right = 1795; bottom = 990 }
    viewportFrame = [ordered]@{ x = 902; y = 314; right = 1695; bottom = 916 }
    layoutbar = [ordered]@{ y = 1043; height = 37 }
  }
  foreach ($zone in $expectedGeometry.Keys) {
    foreach ($property in $expectedGeometry[$zone].Keys) {
      $tolerance = if ($zone -eq 'layoutbar' -and $property -eq 'y') { 2 } else { 2 }
      Assert-Close ([double]$geometry.$zone.$property) ([double]$expectedGeometry[$zone][$property]) $tolerance "$zone.$property"
    }
  }

  $tabs = $state.states.layoutTabGeometry
  $expectedTabs = [ordered]@{
    menu = [ordered]@{ x = 8; y = 1047; width = 28; height = 32 }
    Model = [ordered]@{ x = 48; right = 112; width = 64; height = 32 }
    Layout1 = [ordered]@{ x = 112; right = 180; width = 68; height = 32 }
    Layout2 = [ordered]@{ x = 180; right = 244; width = 64; height = 32 }
    add = [ordered]@{ x = 244; right = 282; width = 38; height = 32 }
  }
  foreach ($property in $expectedTabs.menu.Keys) { Assert-Close ([double]$tabs.menu.$property) ([double]$expectedTabs.menu[$property]) 2 "layout menu $property" }
  foreach ($name in @('Model', 'Layout1', 'Layout2')) {
    foreach ($property in $expectedTabs[$name].Keys) { Assert-Close ([double]$tabs.tabs.$name.$property) ([double]$expectedTabs[$name][$property]) 2 "layout tab $name $property" }
  }
  foreach ($property in $expectedTabs.add.Keys) { Assert-Close ([double]$tabs.add.$property) ([double]$expectedTabs.add[$property]) 2 "layout add $property" }
  if (([string]$tabs.tabs.Layout1.backgroundColor -ne 'rgb(59, 68, 83)') -or
    ([string]$tabs.tabs.Model.backgroundColor -ne 'rgba(0, 0, 0, 0)') -or
    ([string]$tabs.tabs.Layout2.backgroundColor -ne 'rgba(0, 0, 0, 0)')) {
    throw 'Layout tab active/inactive surfaces differ from the measured AutoCAD reference.'
  }

  $readback = $state.states.layoutReadback
  if ((@($readback.entityKinds) -join ',') -ne 'circle,polyline,text') { throw 'Layout fixture must contain exactly CIRCLE, closed POLYLINE and TEXT.' }
  if ([double]$readback.paper.widthMm -ne 297 -or [double]$readback.paper.heightMm -ne 210) { throw 'Layout paper is not A4 landscape.' }
  if ([double]$readback.viewport.width -ne 206.5 -or [double]$readback.viewport.height -ne 157) { throw 'Layout viewport paper geometry changed.' }
  if ([int]$readback.canvas.width -ne 790 -or [int]$readback.canvas.height -ne 600) { throw 'Layout viewport canvas geometry changed.' }
  $fixture = $readback.projectedFixture
  if (-not $fixture.polyline.closed -or [string]$fixture.text.value -ne 'KUUBIK AUDIT') { throw 'Layout projected fixture is incomplete.' }
  $layoutTools = $state.states.layoutTools
  if (-not [bool]$layoutTools.compactByDefault -or -not [bool]$layoutTools.openStateVerified -or -not [bool]$layoutTools.pageSetupStillReachable) {
    throw 'Layout tools must prove compact, open and Page Setup reachable states.'
  }
  $canvasOrigin = [ordered]@{ x = [double]$geometry.viewportFrame.x + 1; y = [double]$geometry.viewportFrame.y + 1 }
  $actualFixture = [ordered]@{
    polyline = [ordered]@{
      topLeft = [ordered]@{ x = $canvasOrigin.x + [double]$fixture.polyline.vertices[0].x; y = $canvasOrigin.y + [double]$fixture.polyline.vertices[0].y }
      bottomRight = [ordered]@{ x = $canvasOrigin.x + [double]$fixture.polyline.vertices[2].x; y = $canvasOrigin.y + [double]$fixture.polyline.vertices[2].y }
    }
    circle = [ordered]@{ center = [ordered]@{ x = $canvasOrigin.x + [double]$fixture.circle.center.x; y = $canvasOrigin.y + [double]$fixture.circle.center.y }; radiusPx = [double]$fixture.circle.radiusPx }
    text = [ordered]@{ insertion = [ordered]@{ x = $canvasOrigin.x + [double]$fixture.text.insertion.x; y = $canvasOrigin.y + [double]$fixture.text.insertion.y }; heightPx = [double]$fixture.text.heightPx }
  }
  $expectedFixture = [ordered]@{
    polyline = [ordered]@{ topLeft = [ordered]@{ x = 903; y = 432 }; bottomRight = [ordered]@{ x = 1694; y = 905 } }
    circle = [ordered]@{ center = [ordered]@{ x = 1298; y = 668 }; radiusPx = 95 }
    text = [ordered]@{ insertion = [ordered]@{ x = 1094; y = 385 }; heightPx = 58 }
  }
  foreach ($corner in @('topLeft', 'bottomRight')) {
    foreach ($axis in @('x', 'y')) { Assert-Close ([double]$actualFixture.polyline.$corner.$axis) ([double]$expectedFixture.polyline.$corner.$axis) 2 "POLYLINE $corner $axis" }
  }
  foreach ($axis in @('x', 'y')) { Assert-Close ([double]$actualFixture.circle.center.$axis) ([double]$expectedFixture.circle.center.$axis) 2 "CIRCLE center $axis" }
  Assert-Close $actualFixture.circle.radiusPx $expectedFixture.circle.radiusPx 2 'CIRCLE radius'
  foreach ($axis in @('x', 'y')) { Assert-Close ([double]$actualFixture.text.insertion.$axis) ([double]$expectedFixture.text.insertion.$axis) 2 "TEXT insertion $axis" }
  Assert-Close $actualFixture.text.heightPx $expectedFixture.text.heightPx 2 'TEXT height'

  $referenceText = Get-DarkBounds $reference 1050 325 1600 400
  $kuubikText = Get-DarkBounds $kuubik 1050 325 1600 400
  foreach ($property in @('left', 'top', 'right', 'bottom')) {
    Assert-Close ([double]$kuubikText.$property) ([double]$referenceText.$property) 2 "TEXT pixel $property"
  }

  $waveName = Split-Path -Leaf (Split-Path -Parent $KuubikStateJson)
  $result = [ordered]@{
    reference = [ordered]@{ product = 'AutoCAD 2024.1.2'; workspace = 'Drafting & Annotation'; ref = 'private://autocad-2024/layout-paper-space'; sha256 = $referenceSha; redistributablePixelsIncluded = $false }
    kuubik = [ordered]@{ stateArtifact = "evidence/artifacts/$waveName/visual-shell-states.json"; screenshot = "evidence/artifacts/$waveName/visual-shell-layout-paper-space.png"; screenshotSha256 = Get-ImageSha256 $KuubikImage }
    viewport = @(1920, 1080); browserZoomPercent = 100; windowsDpiScalePercent = 100
    expectedGeometry = $expectedGeometry; actualGeometry = $geometry
    expectedTabs = $expectedTabs; actualTabs = $tabs
    expectedFixture = $expectedFixture; actualFixture = $actualFixture
    referenceTextPixels = $referenceText; kuubikTextPixels = $kuubikText
    layoutTools = $layoutTools
    tolerancePx = 2
    scope = 'Layout/paper-space state: sheet, printable boundary, viewport frame, Model/Layout tabs, owned DXF fixture projection, grid-bearing viewport render, compact/open Layout tools, Page Setup reachability and live IndexedDB read-back. This does not independently raise the five-category visual score.'
    status = 'PASS'
  }
  $directory = Split-Path -Parent $OutputJson
  if ($directory) { [void](New-Item -ItemType Directory -Force -Path $directory) }
  [System.IO.File]::WriteAllText([System.IO.Path]::GetFullPath($OutputJson), "$(($result | ConvertTo-Json -Depth 14))`n", [System.Text.UTF8Encoding]::new($false))
} finally {
  $reference.Dispose(); $kuubik.Dispose()
}
