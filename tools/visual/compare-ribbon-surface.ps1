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

$expectedSha = $ExpectedReferenceSha256.ToLowerInvariant()
$actualReferenceSha = Get-ImageSha256 $ReferenceImage
if ($actualReferenceSha -ne $expectedSha) { throw 'Private AutoCAD reference SHA-256 mismatch.' }

$reference = [System.Drawing.Bitmap]::FromFile((Resolve-Path -LiteralPath $ReferenceImage))
try {
  if ($reference.Width -ne 1920 -or $reference.Height -ne 1080) { throw 'Ribbon comparison requires a 1920x1080 AutoCAD reference.' }
  $state = Get-Content -Raw -LiteralPath $KuubikStateJson | ConvertFrom-Json
  $waveName = Split-Path -Leaf (Split-Path -Parent $KuubikStateJson)
  if (@($state.viewport)[0] -ne 1920 -or @($state.viewport)[1] -ne 1080) { throw 'Ribbon comparison requires a 1920x1080 Kuubik read-back.' }

  $expectedPanels = @(
    [ordered]@{ name = 'draw'; x = 0; width = 225; right = 225 },
    [ordered]@{ name = 'modify'; x = 225; width = 250; right = 475 },
    [ordered]@{ name = 'annotation'; x = 475; width = 189; right = 664 },
    [ordered]@{ name = 'layers'; x = 664; width = 273; right = 937 },
    [ordered]@{ name = 'block'; x = 937; width = 161; right = 1098 },
    [ordered]@{ name = 'properties'; x = 1098; width = 262; right = 1360 },
    [ordered]@{ name = 'groups'; x = 1360; width = 72; right = 1432 },
    [ordered]@{ name = 'utilities'; x = 1432; width = 97; right = 1529 },
    [ordered]@{ name = 'clipboard'; x = 1529; width = 91; right = 1620 },
    [ordered]@{ name = 'view'; x = 1620; width = 53; right = 1673 }
  )
  $panels = $state.states.ribbon.panels
  $comparisons = foreach ($expectedPanel in $expectedPanels) {
    $actual = $panels.($expectedPanel.name)
    if ($null -eq $actual) { throw "Kuubik ribbon panel missing: $($expectedPanel.name)." }
    $delta = [math]::Round([double]$actual.right - [double]$expectedPanel.right, 3)
    if ([math]::Abs($delta) -gt 2) { throw "Ribbon panel $($expectedPanel.name) exceeds the fixed +/-2 px boundary tolerance." }
    [ordered]@{
      name = $expectedPanel.name
      autoCad = [ordered]@{ x = $expectedPanel.x; width = $expectedPanel.width; right = $expectedPanel.right }
      kuubik = [ordered]@{ x = [double]$actual.x; width = [double]$actual.width; right = [double]$actual.right }
      rightDeltaPx = $delta
    }
  }

  $referenceSurface = Get-RgbHex $reference.GetPixel(1800, 60)
  $kuubikSurface = [string]$panels.draw.backgroundColor
  if ($referenceSurface -ne '#3b4453' -or $kuubikSurface -ne 'rgb(59, 68, 83)') { throw 'AutoCAD and Kuubik ribbon surfaces do not match.' }

  $boundarySamples = foreach ($x in @(225, 475, 664, 937, 1098, 1360, 1432, 1529, 1620)) {
    $pixel = $reference.GetPixel($x, 100)
    [ordered]@{ x = $x; color = Get-RgbHex $pixel }
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
      artifact = "evidence/artifacts/$waveName/visual-shell-states.json"
      screenshot = "evidence/artifacts/$waveName/visual-shell-empty-workspace.png"
    }
    viewport = @(1920, 1080)
    browserZoomPercent = 100
    windowsDpiScalePercent = 100
    surface = [ordered]@{ autoCad = $referenceSurface; kuubik = $kuubikSurface }
    autoCadBoundarySamples = @($boundarySamples)
    panels = @($comparisons)
    commandPanel = $state.states.ribbon.commandPanel
    tolerancePx = 2
    scope = 'Home ribbon surface and ten measured panel boundaries only; command controls remain a Kuubik extension and this does not authorize a five-category score increase.'
    status = 'PASS'
  }
  $directory = Split-Path -Parent $OutputJson
  if ($directory) { [void](New-Item -ItemType Directory -Force -Path $directory) }
  $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputJson -Encoding utf8
} finally {
  $reference.Dispose()
}
