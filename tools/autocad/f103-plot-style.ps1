param(
  [Parameter(Mandatory = $true)][string]$TempDwgPath,
  [Parameter(Mandatory = $true)][string]$PdfDirectory,
  [Parameter(Mandatory = $true)][string]$PidPath,
  [Parameter(Mandatory = $true)][string]$OwnershipToken
)

$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class F103WindowProcess {
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@

function Invoke-ComRetry {
  param([Parameter(Mandatory = $true)][scriptblock]$Action, [int]$TimeoutSeconds = 20)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    try { return (& $Action) } catch {
      if ([DateTime]::UtcNow -ge $deadline) { throw }
      Start-Sleep -Milliseconds 150
    }
  } while ($true)
}

function Wait-AcadIdle {
  param([Parameter(Mandatory = $true)]$Document, [int]$TimeoutSeconds = 30)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 100
    try {
      if ([string]::IsNullOrWhiteSpace([string]$Document.GetVariable('CMDNAMES')) -and [int]$Document.GetVariable('CMDACTIVE') -eq 0) { return }
    } catch {}
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'AutoCAD did not return idle for F-103.'
}

function Get-Sha256 {
  param([Parameter(Mandatory = $true)][string]$Path)
  $stream = [IO.File]::OpenRead($Path)
  try {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
  } finally { $stream.Dispose() }
}

function Set-IsoA4Landscape {
  param([Parameter(Mandatory = $true)]$Layout)
  $mediaNames = @(Invoke-ComRetry { @($Layout.GetCanonicalMediaNames()) })
  $media = @($mediaNames | Where-Object {
    [string]$_ -match '(?i)A4' -and [string]$_ -match '210' -and [string]$_ -match '297'
  } | Sort-Object { [string]$_ -match '(?i)full.?bleed' } | Select-Object -First 1)
  if ($media.Count -ne 1) { throw 'DWG To PDF.pc3 did not expose ISO A4.' }
  Invoke-ComRetry { $Layout.CanonicalMediaName = [string]$media[0]; $Layout.PlotRotation = 0 } | Out-Null
  [double]$width = 0; [double]$height = 0
  Invoke-ComRetry { $Layout.GetPaperSize([ref]$width, [ref]$height) } | Out-Null
  if ($width -lt $height) { Invoke-ComRetry { $Layout.PlotRotation = 1 } | Out-Null }
  return [string]$media[0]
}

function Get-EntitySnapshot {
  param([Parameter(Mandatory = $true)]$Entity)
  $transparency = $null
  $trueColor = $null
  try { $transparency = [string](Invoke-ComRetry { $Entity.EntityTransparency }) } catch { $transparency = 'UNAVAILABLE' }
  try {
    $color = Invoke-ComRetry { $Entity.TrueColor }
    $trueColor = [ordered]@{
      method = [int](Invoke-ComRetry { $color.ColorMethod })
      red = [int](Invoke-ComRetry { $color.Red })
      green = [int](Invoke-ComRetry { $color.Green })
      blue = [int](Invoke-ComRetry { $color.Blue })
    }
  } catch { $trueColor = [ordered]@{ method = -1; red = -1; green = -1; blue = -1 } }
  return [ordered]@{
    handle = [string](Invoke-ComRetry { $Entity.Handle })
    layer = [string](Invoke-ComRetry { $Entity.Layer })
    colorIndex = [int](Invoke-ComRetry { $Entity.Color })
    lineweight = [int](Invoke-ComRetry { $Entity.Lineweight })
    transparency = $transparency
    trueColor = $trueColor
  }
}

function Get-LayoutSnapshot {
  param([Parameter(Mandatory = $true)]$Layout, [Parameter(Mandatory = $true)]$Document)
  return [ordered]@{
    configName = [string](Invoke-ComRetry { $Layout.ConfigName })
    canonicalMediaName = [string](Invoke-ComRetry { $Layout.CanonicalMediaName })
    plotType = [int](Invoke-ComRetry { $Layout.PlotType })
    plotWithPlotStyles = [bool](Invoke-ComRetry { $Layout.PlotWithPlotStyles })
    styleSheet = [string](Invoke-ComRetry { $Layout.StyleSheet })
    plotWithLineweights = [bool](Invoke-ComRetry { $Layout.PlotWithLineweights })
    plotTransparency = [bool](Invoke-F103PlotTransparency $Document '?')
    plotTransparencyOverride = [int](Invoke-ComRetry { $Document.GetVariable('PLOTTRANSPARENCYOVERRIDE') })
    showPlotStyles = [bool](Invoke-ComRetry { $Layout.ShowPlotStyles })
  }
}

function Invoke-F103PlotTransparency {
  param(
    [Parameter(Mandatory = $true)]$Document,
    [Parameter(Mandatory = $true)][ValidateSet('0', '1', '?')][string]$Request
  )
  Invoke-ComRetry { $Document.SetVariable('USERS2', $Request); $Document.SendCommand("KDF103PLOTTRANSPARENCY`n") } | Out-Null
  Wait-AcadIdle $Document
  $value = [string](Invoke-ComRetry { $Document.GetVariable('USERS3') })
  if ($value -notin @('0', '1')) { throw "F-103 managed PlotTransparency command returned '$value'." }
  if ($Request -ne '?' -and $value -ne $Request) { throw "F-103 failed to set native PlotTransparency to $Request." }
  return $value -eq '1'
}

function Invoke-PlotProfile {
  param(
    [Parameter(Mandatory = $true)]$Document,
    [Parameter(Mandatory = $true)]$Layout,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][bool]$UsePlotStyles,
    [Parameter(Mandatory = $true)][AllowEmptyString()][string]$StyleSheet,
    [Parameter(Mandatory = $true)][bool]$Lineweights,
    [Parameter(Mandatory = $true)][bool]$Transparency,
    [Parameter(Mandatory = $true)][string]$OutputPath
  )
  # Autodesk defines 1 = honor the persisted Page Setup PlotTransparency flag.
  [int16]$transparencyOverride = 1
  Invoke-ComRetry {
    $Layout.PlotWithPlotStyles = $UsePlotStyles
    if ($StyleSheet) { $Layout.StyleSheet = $StyleSheet }
    $Layout.PlotWithLineweights = $Lineweights
    $Document.SetVariable('PLOTTRANSPARENCYOVERRIDE', $transparencyOverride)
    $Layout.ShowPlotStyles = $UsePlotStyles
    $Document.Regen(1)
  } | Out-Null
  [void](Invoke-F103PlotTransparency $Document $(if ($Transparency) { '1' } else { '0' }))
  $snapshot = Get-LayoutSnapshot $Layout $Document
  $plotSucceeded = [bool](Invoke-ComRetry { $Document.Plot.PlotToFile($OutputPath) } -TimeoutSeconds 60)
  if (-not $plotSucceeded -or -not (Test-Path -LiteralPath $OutputPath)) { throw "AutoCAD did not create the $Name F-103 PDF." }
  $info = Get-Item -LiteralPath $OutputPath
  return [ordered]@{
    name = $Name; layout = $snapshot
    pdf = [ordered]@{ bytes = [long]$info.Length; sha256 = Get-Sha256 $OutputPath; retained = $false }
  }
}

$preExistingProcessIds = @(Get-Process -Name 'acad' -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.Id })
$acad = $null; $scratch = $null; $reopened = $null; $result = $null; $automationProcessId = 0; $owned = $false
$originalBackgroundPlot = $null; $originalPlotTransparencyOverride = $null; $originalSecureLoad = $null; $settingsRestored = $false
$tempDwg = [IO.Path]::GetFullPath($TempDwgPath); $pdfRoot = [IO.Path]::GetFullPath($PdfDirectory); $pidFile = [IO.Path]::GetFullPath($PidPath)
$pdfPaths = [ordered]@{
  color = [IO.Path]::Combine($pdfRoot, 'color.pdf')
  monochrome = [IO.Path]::Combine($pdfRoot, 'monochrome.pdf')
  grayscale = [IO.Path]::Combine($pdfRoot, 'grayscale.pdf')
  noLineweights = [IO.Path]::Combine($pdfRoot, 'no-lineweights.pdf')
  transparent = [IO.Path]::Combine($pdfRoot, 'transparent.pdf')
}
try {
  [IO.Directory]::CreateDirectory($pdfRoot) | Out-Null
  $pluginSource = [IO.Path]::Combine($PSScriptRoot, 'F103PlotTransparency.cs')
  $pluginAssembly = [IO.Path]::Combine($pdfRoot, 'F103PlotTransparency.dll')
  $autoCadRoot = 'C:\Program Files\Autodesk\AutoCAD 2024'
  if (-not (Test-Path -LiteralPath $pluginSource)) { throw 'F-103 managed PlotTransparency source is missing.' }
  Add-Type -Path $pluginSource -ReferencedAssemblies @(
    [IO.Path]::Combine($autoCadRoot, 'acdbmgd.dll'),
    [IO.Path]::Combine($autoCadRoot, 'acmgd.dll'),
    [IO.Path]::Combine($autoCadRoot, 'accoremgd.dll')
  ) -OutputAssembly $pluginAssembly -ErrorAction Stop
  $acad = Invoke-ComRetry { New-Object -ComObject AutoCAD.Application.24.3 } -TimeoutSeconds 30
  Invoke-ComRetry { $acad.Visible = $true; $acad.WindowState = 3 } | Out-Null
  [uint32]$resolvedProcessId = 0
  [void][F103WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry { $acad.HWND }), [ref]$resolvedProcessId)
  $automationProcessId = [int]$resolvedProcessId
  $owned = $automationProcessId -gt 0 -and $preExistingProcessIds -notcontains $automationProcessId
  if (-not $owned) { throw 'F-103 refuses to use a pre-existing AutoCAD process.' }
  [ordered]@{ schemaVersion = 1; processId = $automationProcessId; owned = $true; token = $OwnershipToken } | ConvertTo-Json -Compress | Set-Content -LiteralPath $pidFile -Encoding ascii
  $engineVersion = [string](Invoke-ComRetry { $acad.Version })

  $scratch = if ([int](Invoke-ComRetry { $acad.Documents.Count }) -gt 0) { Invoke-ComRetry { $acad.ActiveDocument } } else { Invoke-ComRetry { $acad.Documents.Add() } }
  if ([string](Invoke-ComRetry { $scratch.FullName }) -or [int](Invoke-ComRetry { $scratch.ModelSpace.Count }) -ne 0) { throw 'F-103 refuses a saved or non-blank drawing.' }
  Invoke-ComRetry { $scratch.Activate() } | Out-Null
  $originalBackgroundPlot = [int](Invoke-ComRetry { $scratch.GetVariable('BACKGROUNDPLOT') })
  $originalPlotTransparencyOverride = [int](Invoke-ComRetry { $scratch.GetVariable('PLOTTRANSPARENCYOVERRIDE') })
  $originalSecureLoad = [int](Invoke-ComRetry { $scratch.GetVariable('SECURELOAD') })
  # Never weaken AutoCAD's executable-loading policy. The licensed runner must
  # already permit this owned test plug-in; timeout cannot strand SECURELOAD=0.
  Invoke-ComRetry { $scratch.SetVariable('BACKGROUNDPLOT', [int16]0) } | Out-Null
  Wait-AcadIdle $scratch
  $papers = @(Invoke-ComRetry { @($scratch.Layouts | Where-Object { [string]$_.Name -ne 'Model' } | Sort-Object TabOrder) } -TimeoutSeconds 30)
  if ($papers.Count -lt 1) { throw 'F-103 QNEW did not provide a paper layout.' }
  $paper = $papers[0]
  foreach ($extra in @($papers | Select-Object -Skip 1)) { Invoke-ComRetry { $extra.Delete() } | Out-Null }
  Invoke-ComRetry {
    $paper.Name = 'F103 PLOT STYLE'; $paper.ConfigName = 'DWG To PDF.pc3'; $paper.RefreshPlotDeviceInfo(); $paper.PaperUnits = 1
    $scratch.ActiveLayout = $paper; $scratch.ActiveSpace = 0; $scratch.MSpace = $false
  } | Out-Null
  $pluginLispPath = $pluginAssembly.Replace('\', '/')
  Invoke-ComRetry { $scratch.SendCommand("(command `"_.NETLOAD`" `"$pluginLispPath`")`n") } | Out-Null
  Wait-AcadIdle $scratch
  [void](Invoke-F103PlotTransparency $scratch '?')
  $media = Set-IsoA4Landscape $paper
  Invoke-ComRetry {
    $paper.PlotType = 1; $paper.CenterPlot = $false; $paper.UseStandardScale = $false; $paper.SetCustomScale(1.0, 1.0); $paper.PlotOrigin = [double[]]@(0, 0); $paper.PlotType = 5
  } | Out-Null

  $byLayer = Invoke-ComRetry { $scratch.Layers.Add('F103_BYLAYER') }
  Invoke-ComRetry { $byLayer.Color = 1; $byLayer.Lineweight = 70 } | Out-Null
  $boundaryLayer = Invoke-ComRetry { $scratch.Layers.Add('F103_BOUNDARY') }
  Invoke-ComRetry { $boundaryLayer.Plottable = $false } | Out-Null

  $byLayerLine = Invoke-ComRetry { $scratch.PaperSpace.AddLine([double[]]@(20, 30, 0), [double[]]@(190, 30, 0)) }
  Invoke-ComRetry { $byLayerLine.Layer = 'F103_BYLAYER'; $byLayerLine.Color = 256; $byLayerLine.Lineweight = -1 } | Out-Null
  $explicitLine = Invoke-ComRetry { $scratch.PaperSpace.AddLine([double[]]@(20, 45, 0), [double[]]@(190, 45, 0)) }
  Invoke-ComRetry { $explicitLine.Color = 3; $explicitLine.Lineweight = 35 } | Out-Null
  $trueColorLine = Invoke-ComRetry { $scratch.PaperSpace.AddLine([double[]]@(20, 60, 0), [double[]]@(190, 60, 0)) }
  $trueColor = Invoke-ComRetry { $acad.GetInterfaceObject('AutoCAD.AcCmColor.24') }
  Invoke-ComRetry { $trueColor.SetRGB(10, 100, 220); $trueColorLine.TrueColor = $trueColor; $trueColorLine.Lineweight = 0 } | Out-Null
  $boundary = Invoke-ComRetry { $scratch.PaperSpace.AddLightWeightPolyline([double[]]@(50, 70, 150, 70, 150, 130, 50, 130)) }
  Invoke-ComRetry { $boundary.Closed = $true; $boundary.Layer = 'F103_BOUNDARY' } | Out-Null
  $boundaryHandle = [string](Invoke-ComRetry { $boundary.Handle })
  $hatchLisp = "(progn (vl-load-com) (setq f103:ps (vla-get-PaperSpace (vla-get-ActiveDocument (vlax-get-acad-object)))) (setq f103:h (vla-AddHatch f103:ps 0 `"SOLID`" :vlax-false 0)) (setq f103:loop (vlax-make-safearray vlax-vbObject '(0 . 0))) (vlax-safearray-put-element f103:loop 0 (vlax-ename->vla-object (handent `"$boundaryHandle`"))) (vla-AppendOuterLoop f103:h f103:loop) (vla-Evaluate f103:h) (setvar `"USERS1`" (vla-get-Handle f103:h)) (princ))`n"
  Invoke-ComRetry { $scratch.SendCommand($hatchLisp) } | Out-Null
  Wait-AcadIdle $scratch
  $hatchHandle = [string](Invoke-ComRetry { $scratch.GetVariable('USERS1') })
  $hatch = Invoke-ComRetry { $scratch.HandleToObject($hatchHandle) }
  Invoke-ComRetry { $hatch.Color = 1; $hatch.Lineweight = 25; $hatch.EntityTransparency = '40'; $hatch.Evaluate() } | Out-Null
  Invoke-ComRetry { $scratch.Regen(1) } | Out-Null
  $handles = [ordered]@{
    byLayerLine = [string](Invoke-ComRetry { $byLayerLine.Handle })
    explicitLine = [string](Invoke-ComRetry { $explicitLine.Handle })
    trueColorLine = [string](Invoke-ComRetry { $trueColorLine.Handle })
    hatch = $hatchHandle
  }

  $plotStyleNames = @(Invoke-ComRetry { @($paper.GetPlotStyleTableNames()) })
  $monochromeName = [string](@($plotStyleNames | Where-Object { [string]$_ -ieq 'monochrome.ctb' } | Select-Object -First 1)[0])
  $grayscaleName = [string](@($plotStyleNames | Where-Object { [string]$_ -ieq 'grayscale.ctb' } | Select-Object -First 1)[0])
  if (-not $monochromeName -or -not $grayscaleName) { throw 'F-103 requires installed monochrome.ctb and grayscale.ctb.' }

  $profiles = [ordered]@{}
  $profiles.color = Invoke-PlotProfile $scratch $paper 'color' $false '' $true $false $pdfPaths.color
  $profiles.monochrome = Invoke-PlotProfile $scratch $paper 'monochrome' $true $monochromeName $true $false $pdfPaths.monochrome
  $profiles.grayscale = Invoke-PlotProfile $scratch $paper 'grayscale' $true $grayscaleName $true $false $pdfPaths.grayscale
  $profiles.noLineweights = Invoke-PlotProfile $scratch $paper 'noLineweights' $false '' $false $false $pdfPaths.noLineweights
  $profiles.transparent = Invoke-PlotProfile $scratch $paper 'transparent' $false '' $true $true $pdfPaths.transparent

  Invoke-ComRetry {
    [int16]$plotTransparencyByPageSetup = 1
    $paper.PlotWithPlotStyles = $true; $paper.StyleSheet = $monochromeName; $paper.PlotWithLineweights = $true; $scratch.SetVariable('PLOTTRANSPARENCYOVERRIDE', $plotTransparencyByPageSetup); $paper.ShowPlotStyles = $true
    $scratch.Regen(1); $scratch.SaveAs($tempDwg, 64)
  } | Out-Null
  $objectsBefore = [ordered]@{
    byLayerLine = Get-EntitySnapshot (Invoke-ComRetry { $scratch.HandleToObject($handles.byLayerLine) })
    explicitLine = Get-EntitySnapshot (Invoke-ComRetry { $scratch.HandleToObject($handles.explicitLine) })
    trueColorLine = Get-EntitySnapshot (Invoke-ComRetry { $scratch.HandleToObject($handles.trueColorLine) })
    hatch = Get-EntitySnapshot (Invoke-ComRetry { $scratch.HandleToObject($handles.hatch) })
  }
  $savedLayout = Get-LayoutSnapshot $paper $scratch
  Invoke-ComRetry { $scratch.Close($false) } | Out-Null; $scratch = $null
  $dwgInfo = Get-Item -LiteralPath $tempDwg; $dwgSha256 = Get-Sha256 $tempDwg

  $reopened = Invoke-ComRetry { $acad.Documents.Open($tempDwg) }
  Invoke-ComRetry { $reopened.Activate() } | Out-Null; Wait-AcadIdle $reopened
  $paper = Invoke-ComRetry { $reopened.Layouts.Item('F103 PLOT STYLE') }
  $objectsAfter = [ordered]@{
    byLayerLine = Get-EntitySnapshot (Invoke-ComRetry { $reopened.HandleToObject($handles.byLayerLine) })
    explicitLine = Get-EntitySnapshot (Invoke-ComRetry { $reopened.HandleToObject($handles.explicitLine) })
    trueColorLine = Get-EntitySnapshot (Invoke-ComRetry { $reopened.HandleToObject($handles.trueColorLine) })
    hatch = Get-EntitySnapshot (Invoke-ComRetry { $reopened.HandleToObject($handles.hatch) })
  }
  $reopenedLayout = Get-LayoutSnapshot $paper $reopened

  $checks = [ordered]@{
    ownedBlankScratch = $owned
    plotStyleTablesAvailable = $monochromeName -ieq 'monochrome.ctb' -and $grayscaleName -ieq 'grayscale.ctb'
    byLayerLine = $objectsBefore.byLayerLine.layer -eq 'F103_BYLAYER' -and $objectsBefore.byLayerLine.colorIndex -eq 256 -and $objectsBefore.byLayerLine.lineweight -eq -1
    explicitLine = $objectsBefore.explicitLine.colorIndex -eq 3 -and $objectsBefore.explicitLine.lineweight -eq 35
    trueColorAndExplicitZero =
      $objectsBefore.trueColorLine.lineweight -eq 0 -and
      $objectsBefore.trueColorLine.trueColor.red -eq 10 -and
      $objectsBefore.trueColorLine.trueColor.green -eq 100 -and
      $objectsBefore.trueColorLine.trueColor.blue -eq 220
    fortyPercentTransparency = $objectsBefore.hatch.transparency -match '40'
    colorProfile = -not $profiles.color.layout.plotWithPlotStyles -and $profiles.color.layout.plotWithLineweights -and -not $profiles.color.layout.plotTransparency -and $profiles.color.layout.plotTransparencyOverride -eq 1
    monochromeProfile = $profiles.monochrome.layout.plotWithPlotStyles -and $profiles.monochrome.layout.styleSheet -ieq 'monochrome.ctb' -and -not $profiles.monochrome.layout.plotTransparency
    grayscaleProfile = $profiles.grayscale.layout.plotWithPlotStyles -and $profiles.grayscale.layout.styleSheet -ieq 'grayscale.ctb' -and -not $profiles.grayscale.layout.plotTransparency
    lineweightToggle = -not $profiles.noLineweights.layout.plotWithLineweights -and -not $profiles.noLineweights.layout.plotTransparency
    transparencyToggle = $profiles.transparent.layout.plotTransparency -and $profiles.transparent.layout.plotTransparencyOverride -eq 1
    allPdfOutputs = @($profiles.Values | Where-Object { $_.pdf.bytes -le 0 -or $_.pdf.sha256 -notmatch '^[a-f0-9]{64}$' }).Count -eq 0
    dwgReopen = $dwgInfo.Length -gt 0 -and $dwgSha256 -match '^[a-f0-9]{64}$'
    layoutPersisted = $reopenedLayout.styleSheet -ieq $savedLayout.styleSheet -and $reopenedLayout.plotWithLineweights -eq $savedLayout.plotWithLineweights -and $reopenedLayout.plotTransparency -eq $savedLayout.plotTransparency
    objectAppearancePersisted = ($objectsBefore | ConvertTo-Json -Depth 6 -Compress) -eq ($objectsAfter | ConvertTo-Json -Depth 6 -Compress)
  }
  $status = if (@($checks.Values | Where-Object { $_ -ne $true }).Count -eq 0) { 'PASS' } else { 'FAIL' }
  $result = [ordered]@{
    schemaVersion = 1; rowId = 'F-103'; benchmark = 'AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation'
    engine = 'Autodesk AutoCAD 2024 desktop COM/native PlotToFile'; engineVersion = $engineVersion
    automationProcessId = $automationProcessId; automationProcessOwned = $owned; media = $media
    plotStyleTables = $plotStyleNames; handles = $handles; objectsBefore = $objectsBefore; objectsAfter = $objectsAfter
    profiles = $profiles; savedLayout = $savedLayout; reopenedLayout = $reopenedLayout; checks = $checks
    dwg = [ordered]@{ bytes = [long]$dwgInfo.Length; sha256 = $dwgSha256; saveAsType = 64; retained = $false }
    status = $status
  }
} catch {
  Write-Error ("F-103 failure at {0}: {1}" -f $_.InvocationInfo.PositionMessage, $_.Exception.Message); throw
} finally {
  $restoreDocument = if ($reopened) { $reopened } elseif ($scratch) { $scratch } elseif ($acad) {
    try { if ([int](Invoke-ComRetry { $acad.Documents.Count }) -gt 0) { Invoke-ComRetry { $acad.ActiveDocument } } } catch { $null }
  }
  if ($restoreDocument -and $null -ne $originalBackgroundPlot -and $null -ne $originalPlotTransparencyOverride -and $null -ne $originalSecureLoad) {
    try {
      Invoke-ComRetry {
        $restoreDocument.SetVariable('BACKGROUNDPLOT', [int16]$originalBackgroundPlot)
        $restoreDocument.SetVariable('PLOTTRANSPARENCYOVERRIDE', [int16]$originalPlotTransparencyOverride)
      } | Out-Null
      $settingsRestored =
        [int](Invoke-ComRetry { $restoreDocument.GetVariable('BACKGROUNDPLOT') }) -eq $originalBackgroundPlot -and
        [int](Invoke-ComRetry { $restoreDocument.GetVariable('PLOTTRANSPARENCYOVERRIDE') }) -eq $originalPlotTransparencyOverride -and
        [int](Invoke-ComRetry { $restoreDocument.GetVariable('SECURELOAD') }) -eq $originalSecureLoad
    } catch { $settingsRestored = $false }
  }
  if ($reopened) { try { Invoke-ComRetry { $reopened.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
  if ($scratch) { try { Invoke-ComRetry { $scratch.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
  if (Test-Path -LiteralPath $tempDwg) { Remove-Item -LiteralPath $tempDwg -Force }
}
if (-not $result) { throw 'F-103 AutoCAD matrix produced no result.' }
$result.userDocument = [ordered]@{ isolatedOwnedProcess = $owned; blankRestored = $owned }
$result.userSettings = [ordered]@{
  original = [ordered]@{ backgroundPlot = $originalBackgroundPlot; plotTransparencyOverride = $originalPlotTransparencyOverride; secureLoad = $originalSecureLoad }
  restored = $settingsRestored
}
$result.checks.userSettingsRestored = $settingsRestored
$result.status = if (@($result.checks.Values | Where-Object { $_ -ne $true }).Count -eq 0) { 'PASS' } else { 'FAIL' }
$finalStatus = $result.status; $result | ConvertTo-Json -Depth 14
if ($finalStatus -ne 'PASS') { exit 1 }
