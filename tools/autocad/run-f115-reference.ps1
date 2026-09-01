param(
  [Parameter(Mandatory = $true)]
  [string]$PdfPath
)

$resolvedPdf = (Resolve-Path -LiteralPath $PdfPath).Path
$fileInfo = Get-Item -LiteralPath $resolvedPdf
$fileHash = (Get-FileHash -LiteralPath $resolvedPdf -Algorithm SHA256).Hash.ToLowerInvariant()
$acad = New-Object -ComObject AutoCAD.Application
$acad.Visible = $true
$document = $acad.ActiveDocument

if ($document.Name -ne 'Drawing1.dwg' -or $document.ModelSpace.Count -ne 0) {
  throw "F-115 refuses a non-empty or non-scratch AutoCAD document: $($document.Name), entities $($document.ModelSpace.Count)."
}

$commands = "_.-LAYER`n_M`nF115_PDF_REFERENCE`n`n_.-PDFATTACH`n$resolvedPdf`n2`n25,40`n0.5`n30`n"
$document.SendCommand($commands)
$deadline = [DateTime]::UtcNow.AddSeconds(10)
while ($document.ModelSpace.Count -eq 0 -and [DateTime]::UtcNow -lt $deadline) {
  Start-Sleep -Milliseconds 250
}
if ($document.ModelSpace.Count -ne 1) {
  throw "F-115 expected exactly one AutoCAD ModelSpace object, got $($document.ModelSpace.Count)."
}

$underlay = $document.ModelSpace.Item(0)
if ($underlay.ObjectName -ne 'AcDbPdfReference') {
  throw "F-115 expected AcDbPdfReference, got $($underlay.ObjectName)."
}
$initialFade = $underlay.Fade
$underlay.Fade = 25
$document.Regen(1)
$position = @($underlay.Position)

[pscustomobject]@{
  schemaVersion = 1
  rowId = 'F-115'
  application = [pscustomobject]@{
    version = $acad.Version
    caption = $acad.Caption
  }
  scratch = [pscustomobject]@{
    document = $document.Name
    saved = $false
    modelSpaceCount = $document.ModelSpace.Count
  }
  source = [pscustomobject]@{
    fileName = $fileInfo.Name
    byteLength = $fileInfo.Length
    sha256 = $fileHash
  }
  underlay = [pscustomobject]@{
    objectName = $underlay.ObjectName
    layer = $underlay.Layer
    file = $underlay.File
    page = [int]$underlay.ItemName
    position = $position
    scaleFactor = $underlay.ScaleFactor
    rotationRad = $underlay.Rotation
    clippingEnabled = $underlay.ClippingEnabled
    initialFade = $initialFade
    fadeReadback = $underlay.Fade
    contrast = $underlay.Contrast
    monochrome = $underlay.Monochrome
    axisAlignedWidth = $underlay.Width
    axisAlignedHeight = $underlay.Height
  }
} | ConvertTo-Json -Depth 8
