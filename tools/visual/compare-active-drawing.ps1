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
  return (($Pixel.R + $Pixel.G + $Pixel.B) / 3) -lt 80
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
  if ($count -eq 0) { throw "No dark fixture pixels found in region $Left,$Top,$Right,$Bottom." }
  return [ordered]@{ left = $minX; top = $minY; right = $maxX; bottom = $maxY; width = $maxX - $minX + 1; height = $maxY - $minY + 1; darkPixels = $count }
}

function Get-DarkSpanOnRow([System.Drawing.Bitmap]$Image, [int]$Y, [int]$Left, [int]$Right) {
  $hits = for ($x = $Left; $x -le $Right; $x += 1) { if (Test-DarkPixel $Image.GetPixel($x, $Y)) { $x } }
  if (@($hits).Count -eq 0) { throw "No dark fixture pixels found on row $Y." }
  return [ordered]@{ left = [int]$hits[0]; right = [int]$hits[-1]; count = @($hits).Count }
}

$expectedSha = $ExpectedReferenceSha256.ToLowerInvariant()
$actualReferenceSha = Get-ImageSha256 $ReferenceImage
if ($actualReferenceSha -ne $expectedSha) { throw 'Private AutoCAD reference SHA-256 mismatch.' }

$reference = [System.Drawing.Bitmap]::FromFile((Resolve-Path -LiteralPath $ReferenceImage))
$kuubik = [System.Drawing.Bitmap]::FromFile((Resolve-Path -LiteralPath $KuubikImage))
try {
  if ($reference.Width -ne 1920 -or $reference.Height -ne 1080 -or $kuubik.Width -ne 1920 -or $kuubik.Height -ne 1080) {
    throw 'Active-drawing comparison requires two 1920x1080 captures.'
  }
  $state = Get-Content -Raw -LiteralPath $KuubikStateJson | ConvertFrom-Json
  if (@($state.viewport)[0] -ne 1920 -or @($state.viewport)[1] -ne 1080) { throw 'Kuubik state read-back viewport is not 1920x1080.' }
  $fixture = $state.states.activeFixture
  if ((@($fixture.entityKinds) -join ',') -ne 'circle,polyline,text') { throw 'Active fixture must contain exactly CIRCLE, closed POLYLINE and TEXT.' }
  if ((@($fixture.handles) -join ',') -ne 'B1,B2,B3' -or @($fixture.selectedHandles).Count -ne 0) { throw 'Active fixture handles or empty selection do not match.' }
  if ([string]$fixture.previewCommand -ne 'LINE' -or [int]$fixture.entityCount -ne 3) { throw 'LINE command or active fixture entity count is not live.' }
  if (-not $fixture.polyline.closed -or @($fixture.polyline.vertices).Count -ne 4) { throw 'Active fixture POLYLINE is not the closed four-vertex boundary.' }

  $expectedFixture = [ordered]@{
    polyline = [ordered]@{ topLeft = [ordered]@{ x = 785; y = 195 }; bottomRight = [ordered]@{ x = 1812; y = 811 } }
    circle = [ordered]@{ center = [ordered]@{ x = 1298; y = 503 }; radiusPx = 123.5 }
    text = [ordered]@{ value = 'KUUBIK AUDIT'; insertion = [ordered]@{ x = 1032; y = 134 }; heightPx = 75 }
    crosshair = [ordered]@{ centerX = 846.5; centerY = 984.5; width = 23; height = 23 }
  }
  Assert-Close ([double]$fixture.polyline.vertices[0].x) $expectedFixture.polyline.topLeft.x 1 'Active POLYLINE left'
  Assert-Close ([double]$fixture.polyline.vertices[0].y) $expectedFixture.polyline.topLeft.y 1 'Active POLYLINE top'
  Assert-Close ([double]$fixture.polyline.vertices[2].x) $expectedFixture.polyline.bottomRight.x 1 'Active POLYLINE right'
  Assert-Close ([double]$fixture.polyline.vertices[2].y) $expectedFixture.polyline.bottomRight.y 1 'Active POLYLINE bottom'
  Assert-Close ([double]$fixture.circle.center.x) $expectedFixture.circle.center.x 1 'Active CIRCLE center x'
  Assert-Close ([double]$fixture.circle.center.y) $expectedFixture.circle.center.y 1 'Active CIRCLE center y'
  Assert-Close ([double]$fixture.circle.radiusPx) $expectedFixture.circle.radiusPx 1 'Active CIRCLE radius'
  if ([string]$fixture.text.value -ne $expectedFixture.text.value) { throw 'Active TEXT content differs from the AutoCAD fixture.' }
  Assert-Close ([double]$fixture.text.insertion.x) $expectedFixture.text.insertion.x 1 'Active TEXT insertion x'
  Assert-Close ([double]$fixture.text.insertion.y) $expectedFixture.text.insertion.y 1 'Active TEXT insertion y'
  Assert-Close ([double]$fixture.text.heightPx) $expectedFixture.text.heightPx 1 'Active TEXT height'
  foreach ($key in @('centerX', 'centerY', 'width', 'height')) { Assert-Close ([double]$fixture.crosshair.$key) ([double]$expectedFixture.crosshair.$key) 1 "Active crosshair $key" }

  $display = $state.states.activeModelDisplayReadback
  if (@($display.verticalGridRuns).Count -ne 121 -or @($display.horizontalGridRuns).Count -ne 84) { throw 'Measured Kuubik grid density is not the pinned active reference density.' }
  $firstGridCenters = @($display.verticalGridRuns | Select-Object -First 10 | ForEach-Object { [math]::Floor((([double]$_[0] + [double]$_[1]) / 2) + 0.5) })
  if (($firstGridCenters -join ',') -ne '682,692,703,713,723,733,744,754,764,775') { throw 'Measured Kuubik grid phase differs from the AutoCAD reference.' }

  $activeUi = $state.states.ribbon.active
  if ([string]$activeUi.color -ne 'rgb(255, 255, 255)' -or [string]$activeUi.backgroundColor -ne 'rgb(23, 111, 159)' -or [string]$activeUi.borderColor -ne 'rgb(104, 180, 223)') {
    throw 'Active LINE ribbon feedback is outside the measured Kuubik/AutoCAD interaction-state contract.'
  }
  $commandLine = $state.states.bottomChrome.commandLine
  if ([double]$commandLine.width -ne 0 -or [double]$commandLine.height -ne 0) { throw 'Active LINE capture must keep the Ctrl+9 command line hidden like the pinned AutoCAD state.' }

  $referencePixels = [ordered]@{
    text = Get-DarkBounds $reference 950 220 1700 350
    circle = Get-DarkBounds $reference 1100 520 1500 850
    rectangleTop = Get-DarkSpanOnRow $reference 376 750 1840
    rectangleBottom = Get-DarkSpanOnRow $reference 992 750 1840
  }
  $kuubikPixels = [ordered]@{
    text = Get-DarkBounds $kuubik 950 220 1700 350
    circle = Get-DarkBounds $kuubik 1100 520 1500 850
    rectangleTop = Get-DarkSpanOnRow $kuubik 376 750 1840
    rectangleBottom = Get-DarkSpanOnRow $kuubik 992 750 1840
  }
  foreach ($shape in @('text', 'circle')) {
    foreach ($key in @('left', 'top', 'right', 'bottom')) { Assert-Close ([double]$kuubikPixels.$shape.$key) ([double]$referencePixels.$shape.$key) 2 "$shape pixel $key" }
  }
  foreach ($key in @('left', 'right')) { Assert-Close ([double]$kuubikPixels.rectangleTop.$key) ([double]$referencePixels.rectangleTop.$key) 2 "rectangleTop pixel $key" }
  # AutoCAD's active cursor/pickbox overlaps the lower-left corner in the
  # private reference, so the independently projected browser geometry gates
  # that corner while the unobstructed lower-right pixel remains comparable.
  Assert-Close ([double]$kuubikPixels.rectangleBottom.right) ([double]$referencePixels.rectangleBottom.right) 2 'rectangleBottom pixel right'

  $waveName = Split-Path -Leaf (Split-Path -Parent $KuubikStateJson)
  $result = [ordered]@{
    reference = [ordered]@{
      product = 'AutoCAD 2024.1.2'; workspace = 'Drafting & Annotation'; ref = 'private://autocad-2024/line-active'
      sha256 = $actualReferenceSha; redistributablePixelsIncluded = $false
    }
    kuubik = [ordered]@{
      stateArtifact = "evidence/artifacts/$waveName/visual-shell-states.json"
      screenshot = "evidence/artifacts/$waveName/visual-shell-active-command.png"
      screenshotSha256 = Get-ImageSha256 $KuubikImage
    }
    viewport = @(1920, 1080); browserZoomPercent = 100; windowsDpiScalePercent = 100
    expectedFixture = $expectedFixture; actualFixture = $fixture
    referencePixels = $referencePixels; kuubikPixels = $kuubikPixels
    grid = [ordered]@{ verticalRuns = @($display.verticalGridRuns).Count; horizontalRuns = @($display.horizontalGridRuns).Count; firstVerticalCenters = $firstGridCenters }
    activeUi = [ordered]@{ ribbon = $activeUi; commandLine = $commandLine }
    tolerancePx = 2
    scope = 'Active LINE state: owned TEXT/POLYLINE/CIRCLE fixture, light-model grid and UCS phase, object ink, cursor placement, active ribbon feedback, hidden Ctrl+9 command line and live browser/document read-back. This does not independently raise the five-category visual score.'
    status = 'PASS'
  }
  $directory = Split-Path -Parent $OutputJson
  if ($directory) { [void](New-Item -ItemType Directory -Force -Path $directory) }
  [System.IO.File]::WriteAllText([System.IO.Path]::GetFullPath($OutputJson), "$(($result | ConvertTo-Json -Depth 14))`n", [System.Text.UTF8Encoding]::new($false))
} finally {
  $reference.Dispose(); $kuubik.Dispose()
}
