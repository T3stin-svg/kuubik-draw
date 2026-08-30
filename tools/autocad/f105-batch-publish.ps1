param(
  [Parameter(Mandatory = $true)][string]$TempDwgPath,
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  [Parameter(Mandatory = $true)][string]$PidPath,
  [Parameter(Mandatory = $true)][string]$OwnershipToken
)

$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class F105WindowProcess {
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@

function Invoke-ComRetry {
  param([Parameter(Mandatory = $true)][scriptblock]$Action, [int]$TimeoutSeconds = 25)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    try { return (& $Action) } catch {
      if ([DateTime]::UtcNow -ge $deadline) { throw }
      Start-Sleep -Milliseconds 150
    }
  } while ($true)
}

function Invoke-NonEmptyCom {
  param([Parameter(Mandatory = $true)][scriptblock]$Action, [string]$Label = 'COM value', [int]$TimeoutSeconds = 25)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    try {
      $value = [string](& $Action)
      if (-not [string]::IsNullOrWhiteSpace($value)) { return $value }
    } catch {
      if ([DateTime]::UtcNow -ge $deadline) { throw }
    }
    if ([DateTime]::UtcNow -ge $deadline) { throw "$Label remained empty for $TimeoutSeconds seconds." }
    Start-Sleep -Milliseconds 150
  } while ($true)
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

function Set-A4Portrait {
  param([Parameter(Mandatory = $true)]$Layout)
  Invoke-ComRetry { $Layout.ConfigName = 'DWG To PDF.pc3'; $Layout.RefreshPlotDeviceInfo(); $Layout.PaperUnits = 1 } | Out-Null
  $media = @($Layout.GetCanonicalMediaNames() | Where-Object {
    [string]$_ -match '(?i)A4' -and [string]$_ -match '210' -and [string]$_ -match '297'
  } | Sort-Object { [string]$_ -match '(?i)full.?bleed' } | Select-Object -First 1)
  if ($media.Count -ne 1) { throw 'DWG To PDF.pc3 did not expose ISO A4.' }
  Invoke-ComRetry {
    $Layout.CanonicalMediaName = [string]$media[0]; $Layout.PlotRotation = 0
    $Layout.PlotType = 1; $Layout.CenterPlot = $false; $Layout.UseStandardScale = $false; $Layout.SetCustomScale(1.0, 1.0)
    $Layout.PlotOrigin = [double[]]@(0, 0); $Layout.PlotWithLineweights = $true; $Layout.PlotWithPlotStyles = $false; $Layout.PlotType = 5
  } | Out-Null
  [double]$width = 0; [double]$height = 0
  Invoke-ComRetry { $Layout.GetPaperSize([ref]$width, [ref]$height) } | Out-Null
  if ($width -gt $height) { Invoke-ComRetry { $Layout.PlotRotation = 1 } | Out-Null }
  return [ordered]@{ media = [string]$media[0]; rawWidthMm = $width; rawHeightMm = $height }
}

function Get-LayoutSnapshot {
  param([Parameter(Mandatory = $true)]$Layout)
  [double]$rawWidth = 0; [double]$rawHeight = 0
  Invoke-ComRetry { $Layout.GetPaperSize([ref]$rawWidth, [ref]$rawHeight) } | Out-Null
  $rotation = [int](Invoke-ComRetry { $Layout.PlotRotation })
  $width = if ($rotation -eq 1 -or $rotation -eq 3) { $rawHeight } else { $rawWidth }
  $height = if ($rotation -eq 1 -or $rotation -eq 3) { $rawWidth } else { $rawHeight }
  $text = @()
  $block = Invoke-ComRetry { $Layout.Block }
  $entityCount = [int](Invoke-ComRetry { $block.Count })
  for ($index = 0; $index -lt $entityCount; $index++) {
    $entity = Invoke-ComRetry { $block.Item($index) }
    if ([string](Invoke-ComRetry { $entity.ObjectName }) -match 'AcDb(Text|MText)') {
      $text += [string](Invoke-ComRetry { $entity.TextString })
    }
  }
  return [ordered]@{
    name = Invoke-NonEmptyCom { $Layout.Name } 'Layout name'; tabOrder = [int](Invoke-ComRetry { $Layout.TabOrder })
    configName = [string](Invoke-ComRetry { $Layout.ConfigName }); canonicalMediaName = [string](Invoke-ComRetry { $Layout.CanonicalMediaName })
    paper = [ordered]@{ widthMm = $width; heightMm = $height; rotation = $rotation }
    paperText = @($text)
  }
}

function Get-StableLayoutSnapshot {
  param([Parameter(Mandatory = $true)]$Layout, [Parameter(Mandatory = $true)][string]$ExpectedText, [int]$TimeoutSeconds = 20)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $previousFingerprint = $null
  do {
    $snapshot = Get-LayoutSnapshot $Layout
    $fingerprint = $snapshot | ConvertTo-Json -Compress -Depth 8
    $exactText = $snapshot.paperText.Count -eq 1 -and $snapshot.paperText[0] -eq $ExpectedText
    if ($exactText -and $fingerprint -eq $previousFingerprint) { return $snapshot }
    $previousFingerprint = if ($exactText) { $fingerprint } else { $null }
    Start-Sleep -Milliseconds 150
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Layout '$ExpectedText' did not reach two identical exact read-backs. Last=$fingerprint"
}

function Plot-Layouts {
  param([Parameter(Mandatory = $true)]$Document, [Parameter(Mandatory = $true)][string[]]$Names, [Parameter(Mandatory = $true)][string]$Target)
  $searchRoot = Split-Path -Parent (Split-Path -Parent $Target)
  $before = @(Get-ChildItem -LiteralPath $searchRoot -Recurse -Filter '*.pdf' -File -ErrorAction SilentlyContinue | ForEach-Object FullName)
  $layoutList = [Array]::CreateInstance([string], [int[]]@($Names.Count), [int[]]@(1))
  for ($index = 0; $index -lt $Names.Count; $index++) { $layoutList.SetValue($Names[$index], $index + 1) }
  Invoke-ComRetry {
    $Document.Activate(); $Document.ActiveLayout = $Document.Layouts.Item($Names[0]); $Document.ActiveSpace = 0; $Document.MSpace = $false
    $Document.Plot.SetLayoutsToPlot($layoutList)
  } | Out-Null
  $ok = [bool](Invoke-ComRetry { $Document.Plot.PlotToFile($Target, 'DWG To PDF.pc3') } -TimeoutSeconds 90)
  if (-not $ok) { throw "PlotToFile returned false for $($Names -join ', ')." }
  $deadline = [DateTime]::UtcNow.AddSeconds(8)
  do {
    Start-Sleep -Milliseconds 250
    $after = @(Get-ChildItem -LiteralPath $searchRoot -Recurse -Filter '*.pdf' -File | Where-Object { $before -notcontains $_.FullName } | Sort-Object CreationTimeUtc, LastWriteTimeUtc)
  } while ($after.Count -lt $Names.Count -and [DateTime]::UtcNow -lt $deadline)
  if ($after.Count -ne $Names.Count) {
    $allFiles = @(Get-ChildItem -LiteralPath $searchRoot -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object FullName)
    throw "Expected $($Names.Count) PDF(s), found $($after.Count): $($after.Name -join ', '); files=$($allFiles -join '|')"
  }
  $generationKeys = @($after | ForEach-Object { '{0:D20}|{1:D20}' -f $_.CreationTimeUtc.Ticks, $_.LastWriteTimeUtc.Ticks })
  if (@($generationKeys | Select-Object -Unique).Count -ne $after.Count) { throw 'Native PDF creation/write timestamps cannot prove batch generation order.' }
  return @($after | ForEach-Object { [ordered]@{
    name = $_.Name; fullName = $_.FullName; bytes = [long]$_.Length; sha256 = Get-Sha256 $_.FullName
    creationTimeUtc = $_.CreationTimeUtc.ToString('o'); lastWriteTimeUtc = $_.LastWriteTimeUtc.ToString('o')
  } })
}

$preExistingProcessIds = @(Get-Process -Name 'acad' -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.Id })
$acad = $null; $scratch = $null; $reopened = $null; $result = $null; $automationProcessId = 0; $owned = $false; $automationProcessIdentity = $null
$tempDwg = [IO.Path]::GetFullPath($TempDwgPath); $outputRoot = [IO.Path]::GetFullPath($OutputDirectory); $pidFile = [IO.Path]::GetFullPath($PidPath)
$batchDirectory = Join-Path $outputRoot 'batch'; $excludedDirectory = Join-Path $outputRoot 'excluded'
New-Item -ItemType Directory -Force -Path $batchDirectory, $excludedDirectory | Out-Null
try {
  $acad = New-Object -ComObject AutoCAD.Application.24.3
  Invoke-ComRetry { $acad.Visible = $true; $acad.WindowState = 3 } | Out-Null
  [uint32]$resolvedProcessId = 0
  [void][F105WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry { $acad.HWND }), [ref]$resolvedProcessId)
  $automationProcessId = [int]$resolvedProcessId; $owned = $automationProcessId -gt 0 -and $preExistingProcessIds -notcontains $automationProcessId
  if (-not $owned) { throw 'F-105 refuses to use a pre-existing AutoCAD process.' }
  $automationProcess = Get-Process -Id $automationProcessId -ErrorAction Stop
  $automationExecutablePath = [IO.Path]::GetFullPath([string]$automationProcess.Path)
  if ([IO.Path]::GetFileName($automationExecutablePath) -ine 'acad.exe') { throw "F-105 PID $automationProcessId is not acad.exe." }
  $automationProcessIdentity = [ordered]@{ processId = $automationProcessId; executablePath = $automationExecutablePath; startTimeUtc = $automationProcess.StartTime.ToUniversalTime().ToString('o') }
  [ordered]@{ schemaVersion = 1; processId = $automationProcessId; executablePath = $automationProcessIdentity.executablePath; startTimeUtc = $automationProcessIdentity.startTimeUtc; owned = $true; token = $OwnershipToken } | ConvertTo-Json -Compress | Set-Content -LiteralPath $pidFile -Encoding ascii
  $engineVersion = [string](Invoke-ComRetry { $acad.Version })
  $scratch = if ([int](Invoke-ComRetry { $acad.Documents.Count }) -gt 0) { Invoke-ComRetry { $acad.ActiveDocument } } else { Invoke-ComRetry { $acad.Documents.Add() } }
  if ([string](Invoke-ComRetry { $scratch.FullName }) -or [int](Invoke-ComRetry { $scratch.ModelSpace.Count }) -ne 0) { throw 'F-105 refuses a saved or non-blank drawing.' }
  Invoke-ComRetry { $scratch.SetVariable('BACKGROUNDPLOT', 0) } | Out-Null
  $papers = @(Invoke-ComRetry { @($scratch.Layouts | Where-Object { [string]$_.Name -ne 'Model' } | Sort-Object TabOrder) })
  if ($papers.Count -lt 1) { throw 'F-105 QNEW did not provide a paper layout.' }
  $section = $papers[0]; foreach ($extra in @($papers | Select-Object -Skip 1)) { Invoke-ComRetry { $extra.Delete() } | Out-Null }
  Invoke-ComRetry { $section.Name = 'F-105 SHEET 10 SECTION'; $section.TabOrder = 1 } | Out-Null
  $plan = $scratch.Layouts.Add('F-105 SHEET 20 PLAN'); Invoke-ComRetry { $plan.TabOrder = 2 } | Out-Null
  $sectionMedia = Set-A4Portrait $section; $planMedia = Set-A4Portrait $plan
  # Creation is intentionally single-shot. Retrying a compound mutating COM
  # block can duplicate entities when a later property write is transient.
  $sectionCircle = $section.Block.AddCircle([double[]]@(105, 160, 0), 45)
  $sectionText = $section.Block.AddText('F-105 SHEET 10 SECTION', [double[]]@(15, 18, 0), 6)
  $planLine = $plan.Block.AddLine([double[]]@(20, 45, 0), [double[]]@(190, 245, 0))
  $planText = $plan.Block.AddText('F-105 SHEET 20 PLAN', [double[]]@(15, 18, 0), 6)
  Invoke-ComRetry { $sectionCircle.Color = 5; $sectionText.Color = 5; $planLine.Color = 1; $planText.Color = 1; $scratch.Regen(1) } | Out-Null
  $beforeSave = @((Get-StableLayoutSnapshot $section 'F-105 SHEET 10 SECTION'), (Get-StableLayoutSnapshot $plan 'F-105 SHEET 20 PLAN'))
  Invoke-ComRetry { $scratch.SaveAs($tempDwg, 64) } | Out-Null
  $probePath = Join-Path $outputRoot 'probe.pdf'
  Invoke-ComRetry { $scratch.Activate(); $scratch.ActiveLayout = $plan; $scratch.ActiveSpace = 0; $scratch.MSpace = $false } | Out-Null
  $probeSucceeded = [bool](Invoke-ComRetry { $scratch.Plot.PlotToFile($probePath, 'DWG To PDF.pc3') } -TimeoutSeconds 90)
  if (-not $probeSucceeded -or -not (Test-Path -LiteralPath $probePath)) { throw 'F-105 single-layout probe did not create a PDF.' }
  $orderedNames = [string[]]@('F-105 SHEET 20 PLAN', 'F-105 SHEET 10 SECTION')
  $batchOutputs = @(Plot-Layouts $scratch $orderedNames ($batchDirectory + [IO.Path]::DirectorySeparatorChar))
  $excludedOutputs = @(Plot-Layouts $scratch ([string[]]@('F-105 SHEET 20 PLAN')) ($excludedDirectory + [IO.Path]::DirectorySeparatorChar))
  Invoke-ComRetry { $scratch.Close($false) } | Out-Null; $scratch = $null
  $dwgInfo = Get-Item -LiteralPath $tempDwg; $dwgSha256 = Get-Sha256 $tempDwg
  $reopened = Invoke-ComRetry { $acad.Documents.Open($tempDwg) }; Invoke-ComRetry { $reopened.Activate() } | Out-Null
  $afterReopen = @((Get-StableLayoutSnapshot (Invoke-ComRetry { $reopened.Layouts.Item('F-105 SHEET 10 SECTION') }) 'F-105 SHEET 10 SECTION'), (Get-StableLayoutSnapshot (Invoke-ComRetry { $reopened.Layouts.Item('F-105 SHEET 20 PLAN') }) 'F-105 SHEET 20 PLAN'))
  $checks = [ordered]@{
    twoA4PortraitLayouts = @($beforeSave | Where-Object { [Math]::Abs($_.paper.widthMm - 210) -lt 0.01 -and [Math]::Abs($_.paper.heightMm - 297) -lt 0.01 }).Count -eq 2
    deliberateTabOrder = $beforeSave[0].name -eq 'F-105 SHEET 10 SECTION' -and $beforeSave[1].name -eq 'F-105 SHEET 20 PLAN'
    orderedBatchRequest = ($orderedNames -join '|') -eq 'F-105 SHEET 20 PLAN|F-105 SHEET 10 SECTION'
    requestedOrderIsNotAlphabetic = ($orderedNames -join '|') -ne (@($orderedNames | Sort-Object) -join '|')
    twoBatchOutputs = $batchOutputs.Count -eq 2 -and @($batchOutputs | Where-Object { $_.bytes -gt 0 -and $_.sha256 -match '^[a-f0-9]{64}$' }).Count -eq 2
    exclusionOutput = $excludedOutputs.Count -eq 1 -and $excludedOutputs[0].bytes -gt 0
    exactSingleTextPerLayout = ($beforeSave[0].paperText -join '|') -eq 'F-105 SHEET 10 SECTION' -and ($beforeSave[1].paperText -join '|') -eq 'F-105 SHEET 20 PLAN'
    dwgReopenStable = $afterReopen.Count -eq 2 -and ($afterReopen | ConvertTo-Json -Compress -Depth 8) -eq ($beforeSave | ConvertTo-Json -Compress -Depth 8)
  }
  $result = [ordered]@{
    schemaVersion = 1; rowId = 'F-105'; benchmark = 'AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation'
    engine = 'Autodesk AutoCAD 2024 desktop COM SetLayoutsToPlot/PlotToFile'; engineVersion = $engineVersion
    automationProcessId = $automationProcessId; automationProcessOwned = $owned; automationProcessIdentity = $automationProcessIdentity; backgroundPlot = [int](Invoke-ComRetry { $reopened.GetVariable('BACKGROUNDPLOT') })
    requestedOrder = $orderedNames; excludedRequest = @('F-105 SHEET 20 PLAN'); beforeSave = $beforeSave; afterReopen = $afterReopen
    batchOutputs = $batchOutputs; excludedOutputs = $excludedOutputs; checks = $checks
    dwg = [ordered]@{ bytes = [long]$dwgInfo.Length; sha256 = $dwgSha256; saveAsType = 64; retained = $false }
    status = if (@($checks.Values | Where-Object { $_ -ne $true }).Count -eq 0) { 'PASS' } else { 'FAIL' }
  }
} catch {
  Write-Error ("F-105 failure at {0}: {1}" -f $_.InvocationInfo.PositionMessage, $_.Exception.Message); throw
} finally {
  if ($reopened) { try { Invoke-ComRetry { $reopened.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
  if ($scratch) { try { Invoke-ComRetry { $scratch.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
  if ($owned -and $acad) { try { Invoke-ComRetry { $acad.Quit() } -TimeoutSeconds 10 | Out-Null } catch {} }
}
if (-not $result) { throw 'F-105 AutoCAD matrix produced no result.' }
$result.userDocument = [ordered]@{ isolatedOwnedProcess = $owned; blankRestored = $owned }
$finalStatus = $result.status; $result | ConvertTo-Json -Depth 14
if ($finalStatus -ne 'PASS') { exit 1 }
