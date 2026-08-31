param(
  [Parameter(Mandatory = $true)][string]$ReferenceImage,
  [Parameter(Mandatory = $true)][string]$KuubikImage,
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

function Get-DarkRuns([System.Drawing.Bitmap]$Bitmap, [ValidateSet('x', 'y')][string]$Axis, [int]$Fixed, [int]$Start, [int]$End) {
  $hits = [System.Collections.Generic.List[int]]::new()
  for ($value = $Start; $value -le $End; $value += 1) {
    $pixel = if ($Axis -eq 'x') { $Bitmap.GetPixel($value, $Fixed) } else { $Bitmap.GetPixel($Fixed, $value) }
    if (([int]$pixel.R + [int]$pixel.G + [int]$pixel.B) / 3 -lt 248) { $hits.Add($value) }
  }
  $runs = [System.Collections.Generic.List[object]]::new()
  foreach ($value in $hits) {
    if ($runs.Count -gt 0 -and $value -le [int]$runs[$runs.Count - 1].end + 1) {
      $runs[$runs.Count - 1].end = $value
    } else {
      $runs.Add([ordered]@{ start = $value; end = $value; center = [double]$value })
    }
  }
  foreach ($run in $runs) { $run.center = ([double]$run.start + [double]$run.end) / 2 }
  return @($runs)
}

$expected = $ExpectedReferenceSha256.ToLowerInvariant()
$actualReferenceSha = Get-ImageSha256 $ReferenceImage
if ($actualReferenceSha -ne $expected) { throw "Private AutoCAD reference SHA-256 mismatch." }

$reference = [System.Drawing.Bitmap]::FromFile((Resolve-Path -LiteralPath $ReferenceImage))
$kuubik = [System.Drawing.Bitmap]::FromFile((Resolve-Path -LiteralPath $KuubikImage))
try {
  $waveName = Split-Path -Leaf (Split-Path -Parent $KuubikImage)
  if ($reference.Width -ne 1920 -or $reference.Height -ne 1080 -or $kuubik.Width -ne 1920 -or $kuubik.Height -ne 1080) {
    throw 'Light-model comparison requires paired 1920x1080 images.'
  }
  $referenceVertical = Get-DarkRuns $reference 'x' 400 680 1919
  $kuubikVertical = Get-DarkRuns $kuubik 'x' 400 680 1919
  $referenceHorizontal = Get-DarkRuns $reference 'y' 700 182 973
  $kuubikHorizontal = Get-DarkRuns $kuubik 'y' 700 182 973
  if ($referenceVertical.Count -ne $kuubikVertical.Count -or $referenceHorizontal.Count -ne $kuubikHorizontal.Count) {
    throw 'AutoCAD and Kuubik grid run counts differ.'
  }
  $verticalDelta = for ($index = 0; $index -lt $referenceVertical.Count; $index += 1) {
    [math]::Round([double]$kuubikVertical[$index].center - [double]$referenceVertical[$index].center, 3)
  }
  $horizontalDelta = for ($index = 0; $index -lt $referenceHorizontal.Count; $index += 1) {
    [math]::Round([double]$kuubikHorizontal[$index].center - [double]$referenceHorizontal[$index].center, 3)
  }
  if (@($verticalDelta + $horizontalDelta | Where-Object { [math]::Abs([double]$_) -gt 1 }).Count -gt 0) {
    throw 'AutoCAD and Kuubik grid centers exceed the fixed +/-1 px tolerance.'
  }
  $referenceBackground = Get-RgbHex $reference.GetPixel(700, 200)
  $kuubikBackground = Get-RgbHex $kuubik.GetPixel(700, 200)
  if ($referenceBackground -ne '#ffffff' -or $kuubikBackground -ne '#ffffff') { throw 'Paired model-space backgrounds are not white.' }

  $result = [ordered]@{
    reference = [ordered]@{
      product = 'AutoCAD 2024.1.2'
      workspace = 'Drafting & Annotation'
      ref = 'private://autocad-2024/idle'
      sha256 = $actualReferenceSha
      redistributablePixelsIncluded = $false
    }
    kuubik = [ordered]@{
      artifact = "evidence/artifacts/$waveName/visual-shell-empty-workspace.png"
      sha256 = Get-ImageSha256 $KuubikImage
    }
    viewport = @(1920, 1080)
    browserZoomPercent = 100
    windowsDpiScalePercent = 100
    sampledBackground = [ordered]@{ autoCad = $referenceBackground; kuubik = $kuubikBackground }
    verticalGridRuns = [ordered]@{ autoCad = $referenceVertical; kuubik = $kuubikVertical; deltaPx = @($verticalDelta) }
    horizontalGridRuns = [ordered]@{ autoCad = $referenceHorizontal; kuubik = $kuubikHorizontal; deltaPx = @($horizontalDelta) }
    tolerancePx = 1
    scope = 'Light model-space surface, configured GRIDUNIT alignment and sampled foreground colors only; this does not authorize a five-category score increase.'
    status = 'PASS'
  }
  $directory = Split-Path -Parent $OutputJson
  if ($directory) { [void](New-Item -ItemType Directory -Force -Path $directory) }
  $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputJson -Encoding utf8
} finally {
  $reference.Dispose()
  $kuubik.Dispose()
}
