param(
  [Parameter(Mandatory = $true)][string]$TemplatePath,
  [Parameter(Mandatory = $true)][string]$PidPath,
  [Parameter(Mandatory = $true)][string]$OwnershipToken
)

$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class F107WindowProcess {
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

function Get-Sha256 {
  param([Parameter(Mandatory = $true)][string]$Path)
  $stream = [IO.File]::OpenRead($Path)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
  finally { $algorithm.Dispose(); $stream.Dispose() }
}

function Get-PaperMargins {
  param([Parameter(Mandatory = $true)]$Configuration)
  return Invoke-ComRetry {
    $arguments = [object[]]@($null, $null)
    $modifier = New-Object System.Reflection.ParameterModifier 2
    $modifier[0] = $true
    $modifier[1] = $true
    $modifiers = [System.Reflection.ParameterModifier[]]@($modifier)
    $null = $Configuration.GetType().InvokeMember(
      'GetPaperMargins',
      [System.Reflection.BindingFlags]::InvokeMethod,
      $null,
      $Configuration,
      $arguments,
      $modifiers,
      [System.Globalization.CultureInfo]::InvariantCulture,
      $null
    )
    if ($null -eq $arguments[0] -or $null -eq $arguments[1]) { throw 'GetPaperMargins returned empty out parameters.' }
    return ,@(@($arguments[0]), @($arguments[1]))
  }
}

function Set-A4Portrait {
  param([Parameter(Mandatory = $true)]$Configuration)
  Invoke-ComRetry { $Configuration.ConfigName = 'DWG To PDF.pc3'; $Configuration.RefreshPlotDeviceInfo(); $Configuration.PaperUnits = 1 } | Out-Null
  $media = @($Configuration.GetCanonicalMediaNames() | Where-Object {
    [string]$_ -match '(?i)A4' -and [string]$_ -match '210' -and [string]$_ -match '297'
  } | Sort-Object { [string]$_ -match '(?i)full.?bleed' } | Select-Object -First 1)
  if ($media.Count -ne 1) { throw 'DWG To PDF.pc3 did not expose ISO A4.' }
  Invoke-ComRetry { $Configuration.CanonicalMediaName = [string]$media[0]; $Configuration.PlotRotation = 0 } | Out-Null
  [double]$width = 0; [double]$height = 0
  Invoke-ComRetry { $Configuration.GetPaperSize([ref]$width, [ref]$height) } | Out-Null
  if ($width -gt $height) { Invoke-ComRetry { $Configuration.PlotRotation = 1 } | Out-Null }
  return [string]$media[0]
}

function Get-PlotSnapshot {
  param([Parameter(Mandatory = $true)]$Configuration)
  [double]$rawWidth = 0; [double]$rawHeight = 0
  Invoke-ComRetry { $Configuration.GetPaperSize([ref]$rawWidth, [ref]$rawHeight) } | Out-Null
  $origin = @(Invoke-ComRetry { $Configuration.PlotOrigin })
  $paperMargins = @(Get-PaperMargins $Configuration)
  $lowerLeft = @($paperMargins[0]); $upperRight = @($paperMargins[1])
  $rotation = [int](Invoke-ComRetry { $Configuration.PlotRotation })
  return [ordered]@{
    name = [string](Invoke-ComRetry { $Configuration.Name })
    configName = [string](Invoke-ComRetry { $Configuration.ConfigName })
    canonicalMediaName = [string](Invoke-ComRetry { $Configuration.CanonicalMediaName })
    rotation = $rotation
    paper = [ordered]@{
      widthMm = if ($rotation -eq 1 -or $rotation -eq 3) { $rawHeight } else { $rawWidth }
      heightMm = if ($rotation -eq 1 -or $rotation -eq 3) { $rawWidth } else { $rawHeight }
    }
    plotType = [int](Invoke-ComRetry { $Configuration.PlotType })
    paperUnits = [int](Invoke-ComRetry { $Configuration.PaperUnits })
    useStandardScale = [bool](Invoke-ComRetry { $Configuration.UseStandardScale })
    standardScale = [int](Invoke-ComRetry { $Configuration.StandardScale })
    customScale = [double](Invoke-ComRetry { $Configuration.CustomScale })
    centerPlot = [bool](Invoke-ComRetry { $Configuration.CenterPlot })
    plotOrigin = [ordered]@{ x = [double]$origin[0]; y = [double]$origin[1] }
    paperMargins = [ordered]@{
      lowerLeft = [ordered]@{ x = [double]$lowerLeft[0]; y = [double]$lowerLeft[1] }
      upperRight = [ordered]@{ x = [double]$upperRight[0]; y = [double]$upperRight[1] }
    }
    plotWithLineweights = [bool](Invoke-ComRetry { $Configuration.PlotWithLineweights })
    plotWithPlotStyles = [bool](Invoke-ComRetry { $Configuration.PlotWithPlotStyles })
    styleSheet = [string](Invoke-ComRetry { $Configuration.StyleSheet })
  }
}

function Missing-PlotConfiguration {
  param([Parameter(Mandatory = $true)]$Document, [Parameter(Mandatory = $true)][string]$Name)
  try { $null = Invoke-ComRetry { $Document.PlotConfigurations.Item($Name) } -TimeoutSeconds 2; return $false } catch { return $true }
}

$preExistingProcessIds = @(Get-Process -Name 'acad' -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.Id })
$acad = $null; $scratch = $null; $fromTemplate = $null; $result = $null; $automationProcessId = 0; $owned = $false
$template = [IO.Path]::GetFullPath($TemplatePath); $pidFile = [IO.Path]::GetFullPath($PidPath)
if (Test-Path -LiteralPath $template) { throw "Refusing to overwrite F-107 template: $template" }
New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($template)) | Out-Null
try {
  $acad = Invoke-ComRetry { New-Object -ComObject AutoCAD.Application.24.3 } -TimeoutSeconds 30
  [uint32]$resolvedProcessId = 0
  [void][F107WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry { $acad.HWND }), [ref]$resolvedProcessId)
  $automationProcessId = [int]$resolvedProcessId
  $owned = $automationProcessId -gt 0 -and $preExistingProcessIds -notcontains $automationProcessId
  if (-not $owned) { throw 'F-107 refuses to use a pre-existing AutoCAD process.' }
  Invoke-ComRetry { $acad.Visible = $true; $acad.WindowState = 3 } | Out-Null
  [ordered]@{ schemaVersion = 1; processId = $automationProcessId; owned = $true; token = $OwnershipToken } | ConvertTo-Json -Compress | Set-Content -LiteralPath $pidFile -Encoding ascii
  $engineVersion = [string](Invoke-ComRetry { $acad.Version })
  $scratch = if ([int](Invoke-ComRetry { $acad.Documents.Count }) -gt 0) { Invoke-ComRetry { $acad.ActiveDocument } } else { Invoke-ComRetry { $acad.Documents.Add() } }
  if ([string](Invoke-ComRetry { $scratch.FullName }) -or [int](Invoke-ComRetry { $scratch.ModelSpace.Count }) -ne 0) { throw 'F-107 refuses a saved or non-blank drawing.' }
  Invoke-ComRetry { $scratch.Activate(); $scratch.SetVariable('BACKGROUNDPLOT', 0); $scratch.SetVariable('INSUNITS', 4); $scratch.SetVariable('TILEMODE', 0) } | Out-Null
  $layout = Invoke-ComRetry { $scratch.Layouts.Item('Layout1') }
  $setup = Invoke-ComRetry { $scratch.PlotConfigurations.Add('F-107 A4 Monochrome', $false) }
  Invoke-ComRetry { $setup.CopyFrom($layout); $setup.Name = 'F-107 A4 Monochrome' } | Out-Null
  $media = Set-A4Portrait $setup
  Invoke-ComRetry {
    $setup.PlotType = 5; $setup.UseStandardScale = $true; $setup.StandardScale = 1
    $setup.PlotWithLineweights = $true; $setup.PlotWithPlotStyles = $true; $setup.StyleSheet = 'monochrome.ctb'
    $layout.CopyFrom($setup); $setup.Name = 'F-107 A4 Issue'; $scratch.ActiveLayout = $layout; $scratch.Regen(1)
  } | Out-Null
  $oldNameMissingAfterRename = Missing-PlotConfiguration $scratch 'F-107 A4 Monochrome'
  $renamedLookup = Invoke-ComRetry { $scratch.PlotConfigurations.Item('F-107 A4 Issue') }
  $beforeDeleteCount = [int](Invoke-ComRetry { $scratch.PlotConfigurations.Count })
  $deleteCandidate = Invoke-ComRetry { $scratch.PlotConfigurations.Add('F-107 DELETE', $false) }
  Invoke-ComRetry { $deleteCandidate.CopyFrom($setup); $deleteCandidate.Name = 'F-107 DELETE' } | Out-Null
  $withDeleteCount = [int](Invoke-ComRetry { $scratch.PlotConfigurations.Count })
  Invoke-ComRetry { $deleteCandidate.Delete() } | Out-Null
  $afterDeleteCount = [int](Invoke-ComRetry { $scratch.PlotConfigurations.Count })
  $deleteNameMissing = Missing-PlotConfiguration $scratch 'F-107 DELETE'
  $savedSetup = Get-PlotSnapshot $renamedLookup
  $savedLayout = Get-PlotSnapshot $layout
  $savedInsertionUnits = [int](Invoke-ComRetry { $scratch.GetVariable('INSUNITS') })
  Invoke-ComRetry { $scratch.SaveAs($template, 66) } -TimeoutSeconds 90 | Out-Null
  Invoke-ComRetry { $scratch.Close($false) } | Out-Null; $scratch = $null
  $file = Get-Item -LiteralPath $template

  $fromTemplate = Invoke-ComRetry { $acad.Documents.Add($template) } -TimeoutSeconds 60
  Invoke-ComRetry { $fromTemplate.Activate(); $fromTemplate.SetVariable('TILEMODE', 0) } | Out-Null
  $readSetup = Invoke-ComRetry { $fromTemplate.PlotConfigurations.Item('F-107 A4 Issue') }
  $readLayout = Invoke-ComRetry { $fromTemplate.Layouts.Item('Layout1') }
  Invoke-ComRetry { $readSetup.RefreshPlotDeviceInfo(); $readLayout.RefreshPlotDeviceInfo(); $fromTemplate.Regen(1) } | Out-Null
  $reopenedSetup = Get-PlotSnapshot $readSetup
  $reopenedLayout = Get-PlotSnapshot $readLayout
  $reopenedInsertionUnits = [int](Invoke-ComRetry { $fromTemplate.GetVariable('INSUNITS') })
  $reopenedSetupCount = [int](Invoke-ComRetry { $fromTemplate.PlotConfigurations.Count })
  Invoke-ComRetry { $fromTemplate.Close($false) } | Out-Null; $fromTemplate = $null
  $close = { param([double]$A, [double]$B, [double]$Tolerance = 0.01) [Math]::Abs($A - $B) -le $Tolerance }
  $samePoint = { param($A, $B) (& $close $A.x $B.x) -and (& $close $A.y $B.y) }
  $sameMargins = { param($A, $B) (& $samePoint $A.lowerLeft $B.lowerLeft) -and (& $samePoint $A.upperRight $B.upperRight) }
  $same = {
    param($A, $B)
    return $A.name -eq $B.name -and $A.configName -eq $B.configName -and $A.canonicalMediaName -eq $B.canonicalMediaName -and
      $A.rotation -eq $B.rotation -and (& $close $A.paper.widthMm $B.paper.widthMm) -and (& $close $A.paper.heightMm $B.paper.heightMm) -and
      $A.plotType -eq $B.plotType -and $A.paperUnits -eq $B.paperUnits -and $A.useStandardScale -eq $B.useStandardScale -and $A.standardScale -eq $B.standardScale -and (& $close $A.customScale $B.customScale 0.000001) -and
      $A.centerPlot -eq $B.centerPlot -and (& $samePoint $A.plotOrigin $B.plotOrigin) -and (& $sameMargins $A.paperMargins $B.paperMargins) -and $A.plotWithLineweights -eq $B.plotWithLineweights -and $A.plotWithPlotStyles -eq $B.plotWithPlotStyles -and $A.styleSheet -eq $B.styleSheet
  }
  $sameLayout = {
    param($A, $B)
    return $A.configName -eq $B.configName -and $A.canonicalMediaName -eq $B.canonicalMediaName -and $A.rotation -eq $B.rotation -and
      (& $close $A.paper.widthMm $B.paper.widthMm) -and (& $close $A.paper.heightMm $B.paper.heightMm) -and $A.plotType -eq $B.plotType -and
      $A.paperUnits -eq $B.paperUnits -and $A.useStandardScale -eq $B.useStandardScale -and $A.standardScale -eq $B.standardScale -and (& $close $A.customScale $B.customScale 0.000001) -and $A.centerPlot -eq $B.centerPlot -and (& $samePoint $A.plotOrigin $B.plotOrigin) -and (& $sameMargins $A.paperMargins $B.paperMargins) -and
      $A.plotWithLineweights -eq $B.plotWithLineweights -and $A.plotWithPlotStyles -eq $B.plotWithPlotStyles -and $A.styleSheet -eq $B.styleSheet
  }
  $checks = [ordered]@{
    createdAppliedRenamed = $oldNameMissingAfterRename -and $savedSetup.name -eq 'F-107 A4 Issue' -and $savedLayout.configName -eq 'DWG To PDF.pc3'
    deletedNamedSetup = $withDeleteCount -eq ($beforeDeleteCount + 1) -and $afterDeleteCount -eq $beforeDeleteCount -and $deleteNameMissing
    fullA4LayoutContract = $savedSetup.configName -eq 'DWG To PDF.pc3' -and $savedSetup.canonicalMediaName -eq $media -and (& $close $savedSetup.paper.widthMm 210) -and (& $close $savedSetup.paper.heightMm 297) -and $savedSetup.plotType -eq 5 -and $savedSetup.paperUnits -eq 1 -and $savedSetup.useStandardScale -and $savedSetup.standardScale -eq 1 -and (& $close $savedSetup.customScale 0 0.000001) -and -not $savedSetup.centerPlot -and (& $close $savedSetup.plotOrigin.x 0) -and (& $close $savedSetup.plotOrigin.y 0) -and $savedSetup.paperMargins.lowerLeft.x -ge 0 -and $savedSetup.paperMargins.lowerLeft.y -ge 0 -and $savedSetup.paperMargins.upperRight.x -le 210.01 -and $savedSetup.paperMargins.upperRight.y -le 297.01 -and $savedSetup.plotWithLineweights -and $savedSetup.plotWithPlotStyles -and $savedSetup.styleSheet -eq 'monochrome.ctb'
    millimeterUnitsReopened = $savedInsertionUnits -eq 4 -and $reopenedInsertionUnits -eq 4
    nativeDwtCreated = $file.Length -gt 0 -and (Get-Sha256 $template) -match '^[a-f0-9]{64}$'
    namedSetupReopened = $reopenedSetupCount -eq 1 -and (& $same $savedSetup $reopenedSetup)
    appliedLayoutReopened = (& $sameLayout $savedLayout $reopenedLayout)
  }
  $result = [ordered]@{
    schemaVersion = 1; rowId = 'F-107'; benchmark = 'AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation'
    engine = 'Autodesk AutoCAD 2024 desktop COM named PlotConfiguration and native DWT'; engineVersion = $engineVersion
    automationProcessId = $automationProcessId; automationProcessOwned = $owned; backgroundPlot = 0
    operations = [ordered]@{ create = 'F-107 A4 Monochrome'; applyTo = 'Layout1'; renameTo = 'F-107 A4 Issue'; deleted = 'F-107 DELETE' }
    counts = [ordered]@{ beforeDelete = $beforeDeleteCount; withDelete = $withDeleteCount; afterDelete = $afterDeleteCount; reopened = $reopenedSetupCount }
    insertionUnits = [ordered]@{ saved = $savedInsertionUnits; reopened = $reopenedInsertionUnits; expectedMillimeters = 4 }
    savedSetup = $savedSetup; savedLayout = $savedLayout; reopenedSetup = $reopenedSetup; reopenedLayout = $reopenedLayout
    dwt = [ordered]@{ bytes = [long]$file.Length; sha256 = Get-Sha256 $template; saveAsType = 66; header = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($template), 0, 6); retained = $false }
    checks = $checks; status = if (@($checks.Values | Where-Object { $_ -ne $true }).Count -eq 0) { 'PASS' } else { 'FAIL' }
  }
} catch {
  Write-Error ("F-107 failure at {0}: {1}" -f $_.InvocationInfo.PositionMessage, $_.Exception.Message); throw
} finally {
  if ($acad -and -not $owned) {
    try {
      [uint32]$finallyProcessId = 0
      [void][F107WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry { $acad.HWND }) , [ref]$finallyProcessId)
      if ([int]$finallyProcessId -gt 0 -and $preExistingProcessIds -notcontains [int]$finallyProcessId) {
        $automationProcessId = [int]$finallyProcessId
        $owned = $true
      }
    } catch {}
  }
  if ($fromTemplate) { try { Invoke-ComRetry { $fromTemplate.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
  if ($scratch) { try { Invoke-ComRetry { $scratch.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
  if ($owned -and $acad) { try { Invoke-ComRetry { $acad.Quit() } -TimeoutSeconds 10 | Out-Null } catch {} }
}
if (-not $result) { throw 'F-107 AutoCAD matrix produced no result.' }
$result.userDocument = [ordered]@{ isolatedOwnedProcess = $owned; blankRestored = $owned }
$finalStatus = $result.status; $result | ConvertTo-Json -Depth 14
if ($finalStatus -ne 'PASS') { exit 1 }
