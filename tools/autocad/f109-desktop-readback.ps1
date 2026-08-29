param(
  [Parameter(Mandatory = $true)][string]$DxfPath,
  [Parameter(Mandatory = $true)][string]$PidPath,
  [Parameter(Mandatory = $true)][string]$OwnershipToken
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class F109WindowProcess {
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

function Wait-AcadReady {
  param([Parameter(Mandatory = $true)]$Application, [Parameter(Mandatory = $true)]$Document, [int]$TimeoutSeconds = 25)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    try {
      $state = $Application.GetAcadState()
      if ([bool]$state.IsQuiescent -and [int]$Document.GetVariable('CMDACTIVE') -eq 0 -and [bool]$Document.ReadOnly) { return }
    } catch {}
    if ([DateTime]::UtcNow -ge $deadline) { throw 'F-109 desktop AutoCAD did not reach a quiescent read-only state.' }
    Start-Sleep -Milliseconds 150
  } while ($true)
}

function Invoke-NonEmptyCom {
  param([Parameter(Mandatory = $true)][scriptblock]$ValueAction, [string]$Label = 'COM value', [int]$TimeoutSeconds = 25)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    try {
      $value = [string](& $ValueAction)
      if (-not [string]::IsNullOrWhiteSpace($value)) { return $value }
    } catch {
      if ([DateTime]::UtcNow -ge $deadline) { throw }
    }
    if ([DateTime]::UtcNow -ge $deadline) { throw "$Label remained empty for $TimeoutSeconds seconds." }
    Start-Sleep -Milliseconds 150
  } while ($true)
}

function Invoke-NonNullCom {
  param([Parameter(Mandatory = $true)][scriptblock]$ValueAction, [string]$Label = 'COM value', [int]$TimeoutSeconds = 25)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    try {
      $value = & $ValueAction
      if ($null -ne $value) { return $value }
    } catch {
      if ([DateTime]::UtcNow -ge $deadline) { throw }
    }
    if ([DateTime]::UtcNow -ge $deadline) { throw "$Label remained null for $TimeoutSeconds seconds." }
    Start-Sleep -Milliseconds 150
  } while ($true)
}

function Invoke-NonZeroDoubleCom {
  param([Parameter(Mandatory = $true)][scriptblock]$ValueAction, [string]$Label = 'COM value', [int]$TimeoutSeconds = 25)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    try {
      $value = [double](& $ValueAction)
      if ([Math]::Abs($value) -gt 1e-9) { return $value }
    } catch {
      if ([DateTime]::UtcNow -ge $deadline) { throw }
    }
    if ([DateTime]::UtcNow -ge $deadline) { throw "$Label remained zero for $TimeoutSeconds seconds." }
    Start-Sleep -Milliseconds 150
  } while ($true)
}

function Wait-ComCount {
  param([Parameter(Mandatory = $true)][scriptblock]$ValueAction, [int]$Minimum, [string]$Label, [int]$TimeoutSeconds = 25)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    try {
      $value = [int](& $ValueAction)
      if ($value -ge $Minimum) { return $value }
    } catch {
      if ([DateTime]::UtcNow -ge $deadline) { throw }
    }
    if ([DateTime]::UtcNow -ge $deadline) { throw "$Label remained below $Minimum for $TimeoutSeconds seconds." }
    Start-Sleep -Milliseconds 150
  } while ($true)
}

function Convert-Point2 {
  param([Parameter(Mandatory = $true)]$Value)
  return @([double]$Value[0], [double]$Value[1])
}

function Get-OptionalComValue {
  param([Parameter(Mandatory = $true)][scriptblock]$Action)
  try { return (& $Action) } catch { return $null }
}

function Set-OwnedPidSidecar {
  param([Parameter(Mandatory = $true)]$Application)
  [uint32]$resolvedProcessId = 0
  [void][F109WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry { $Application.HWND }), [ref]$resolvedProcessId)
  $candidate = [int]$resolvedProcessId
  if ($candidate -gt 0 -and $preExistingProcessIds -notcontains $candidate) {
    [ordered]@{ schemaVersion = 1; processId = $candidate; owned = $true; token = $OwnershipToken } | ConvertTo-Json -Compress | Set-Content -LiteralPath $PidPath -Encoding ascii
    return $candidate
  }
  return 0
}

$source = [IO.Path]::GetFullPath($DxfPath)
if (-not (Test-Path -LiteralPath $source)) { throw "F-109 DXF does not exist: $source" }
$preExistingProcessIds = @(Get-Process -Name 'acad' -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.Id })
$acad = $null; $document = $null; $owned = $false; $automationProcessId = 0; $result = $null
$closedWithoutSaving = $false; $quitRequested = $false; $cleanupError = $null
try {
  # COM activation is single-shot: retrying New-Object can launch multiple
  # unauthenticated acad.exe processes when registration is slow.
  $acad = New-Object -ComObject AutoCAD.Application.24.3
  $automationProcessId = Set-OwnedPidSidecar $acad
  $owned = $automationProcessId -gt 0
  if (-not $owned) { throw 'F-109 refuses to use a pre-existing AutoCAD process.' }
  Invoke-ComRetry { $acad.Visible = $true; $acad.WindowState = 3 } | Out-Null
  $engineVersion = [string](Invoke-ComRetry { $acad.Version })
  $document = Invoke-ComRetry { $acad.Documents.Open($source, $true) } -TimeoutSeconds 60
  Invoke-ComRetry { $document.Activate(); $document.Regen(1) } | Out-Null
  Wait-AcadReady $acad $document
  Invoke-ComRetry { $acad.ZoomExtents(); $document.Regen(1) } | Out-Null
  Wait-AcadReady $acad $document
  $openedReadOnly = [bool](Invoke-ComRetry { $document.ReadOnly })
  $extents = [ordered]@{
    min = Convert-Point2 (Invoke-NonNullCom { $document.GetVariable('EXTMIN') } 'EXTMIN')
    max = Convert-Point2 (Invoke-NonNullCom { $document.GetVariable('EXTMAX') } 'EXTMAX')
  }
  $counts = [ordered]@{}
  $handles = New-Object System.Collections.Generic.List[string]
  $nativeRecords = [ordered]@{}
  $modelSpace = Invoke-ComRetry { $document.ModelSpace }
  $modelCount = Wait-ComCount { $modelSpace.Count } 40 'ModelSpace count'
  for ($index = 0; $index -lt $modelCount; $index++) {
    $entity = Invoke-ComRetry { $modelSpace.Item($index) }
    $name = Invoke-NonEmptyCom { $entity.ObjectName } "Entity $index ObjectName"
    if (-not $counts.Contains($name)) { $counts[$name] = 0 }
    $counts[$name] = [int]$counts[$name] + 1
    $handle = Invoke-NonEmptyCom { $entity.Handle } "Entity $index Handle"
    $handles.Add($handle)
    $record = [ordered]@{
      type = $name
      layer = Invoke-NonEmptyCom { $entity.Layer } "Entity $handle Layer"
      color = [int](Invoke-ComRetry { $entity.Color })
      trueColor = Get-OptionalComValue { [int]$entity.TrueColor.RGB }
      linetype = Invoke-NonEmptyCom { $entity.Linetype } "Entity $handle Linetype"
      lineweight = [int](Invoke-ComRetry { $entity.Lineweight })
      transparency = Get-OptionalComValue { [string]$entity.Transparency }
    }
    switch ($name) {
      'AcDbLine' {
        $record.start = Convert-Point2 (Invoke-NonNullCom { $entity.StartPoint } "Entity $handle StartPoint")
        $record.end = Convert-Point2 (Invoke-NonNullCom { $entity.EndPoint } "Entity $handle EndPoint")
      }
      'AcDbPolyline' {
        $coordinates = @(Invoke-NonNullCom { $entity.Coordinates } "Entity $handle Coordinates")
        $vertices = New-Object System.Collections.Generic.List[object]
        for ($vertexIndex = 0; $vertexIndex -lt $coordinates.Count; $vertexIndex += 2) {
          $vertices.Add(@([double]$coordinates[$vertexIndex], [double]$coordinates[$vertexIndex + 1], [double](Invoke-ComRetry { $entity.GetBulge($vertexIndex / 2) })))
        }
        $record.closed = [bool](Invoke-ComRetry { $entity.Closed })
        $record.vertices = [object[]]$vertices.ToArray()
      }
      'AcDbText' {
        $record.insert = Convert-Point2 (Invoke-NonNullCom { $entity.InsertionPoint } "Entity $handle InsertionPoint")
        $record.text = Invoke-NonEmptyCom { $entity.TextString } "Entity $handle TextString"
        $record.height = [double](Invoke-ComRetry { $entity.Height })
        $record.style = Invoke-NonEmptyCom { $entity.StyleName } "Entity $handle StyleName"
        $record.rotation = [double](Invoke-ComRetry { $entity.Rotation })
      }
      'AcDbHatch' {
        $record.pattern = Invoke-NonEmptyCom { $entity.PatternName } "Entity $handle PatternName"
        $record.associative = [bool](Invoke-ComRetry { $entity.AssociativeHatch })
        $record.loopCount = [int](Invoke-ComRetry { $entity.NumberOfLoops })
      }
      'AcDbCircle' {
        $record.center = Convert-Point2 (Invoke-NonNullCom { $entity.Center } "Entity $handle Center")
        $record.radius = [double](Invoke-ComRetry { $entity.Radius })
      }
      'AcDbAlignedDimension' {
        $record.first = Convert-Point2 (Invoke-NonNullCom { $entity.ExtLine1Point } "Entity $handle ExtLine1Point")
        $record.second = Convert-Point2 (Invoke-NonNullCom { $entity.ExtLine2Point } "Entity $handle ExtLine2Point")
        $record.textPosition = Convert-Point2 (Invoke-NonNullCom { $entity.TextPosition } "Entity $handle TextPosition")
        $rawTextOverride = [string](Invoke-ComRetry { $entity.TextOverride })
        $record.textOverrideRaw = $rawTextOverride
        $record.text = if ([string]::IsNullOrEmpty($rawTextOverride)) { '<>' } else { $rawTextOverride }
        $record.measurement = Invoke-NonZeroDoubleCom { $entity.Measurement } "Entity $handle Measurement"
        $record.style = Invoke-NonEmptyCom { $entity.StyleName } "Entity $handle StyleName"
      }
    }
    $nativeRecords[$handle.ToUpperInvariant()] = $record
  }
  Invoke-ComRetry { $document.Regen(1) } | Out-Null
  Wait-AcadReady $acad $document
  $polylineClosuresAfterRegen = [ordered]@{}
  foreach ($handle in @($handles)) {
    if ($nativeRecords[$handle].type -eq 'AcDbPolyline') {
      $entity = Invoke-ComRetry { $document.HandleToObject($handle) }
      $polylineClosuresAfterRegen[$handle] = [bool](Invoke-ComRetry { $entity.Closed })
    }
  }
  $layers = [ordered]@{}
  $layerCollection = Invoke-ComRetry { $document.Layers }
  $layerCount = Wait-ComCount { $layerCollection.Count } 4 'Layer count'
  for ($index = 0; $index -lt $layerCount; $index++) {
    $layer = Invoke-ComRetry { $layerCollection.Item($index) }
    $name = Invoke-NonEmptyCom { $layer.Name } "Layer $index Name"
    if (@('JOONED', 'TELJED', 'SEINAD', 'VIIRUTUS') -contains $name) {
      $layers[$name] = [ordered]@{
        color = [int](Invoke-ComRetry { $layer.Color })
        lineweight = [int](Invoke-ComRetry { $layer.Lineweight })
        linetype = Invoke-NonEmptyCom { $layer.Linetype } "Layer $name Linetype"
        trueColor = Get-OptionalComValue { [int]$layer.TrueColor.RGB }
        transparency = Get-OptionalComValue { [string]$layer.Transparency }
      }
    }
  }
  $styles = New-Object System.Collections.Generic.List[string]
  $styleCollection = Invoke-ComRetry { $document.TextStyles }
  $styleCount = Wait-ComCount { $styleCollection.Count } 2 'Text style count'
  for ($index = 0; $index -lt $styleCount; $index++) {
    $style = Invoke-ComRetry { $styleCollection.Item($index) }
    $styles.Add((Invoke-NonEmptyCom { $style.Name } "Text style $index Name"))
  }
  $checks = [ordered]@{
    units = [int](Invoke-ComRetry { $document.GetVariable('INSUNITS') }) -eq 4
    totalEntities = $modelCount -eq 40
    nativeTypes = $counts.AcDbLine -eq 12 -and $counts.AcDbPolyline -eq 9 -and $counts.AcDbText -eq 10 -and $counts.AcDbHatch -eq 7 -and $counts.AcDbCircle -eq 1 -and $counts.AcDbAlignedDimension -eq 1
    exactHandles = $handles.Count -eq 40 -and @($handles | Select-Object -Unique).Count -eq 40
    layers = $layers.JOONED.color -eq 7 -and $layers.JOONED.lineweight -eq 25 -and $layers.JOONED.linetype -eq 'Continuous' -and $layers.TELJED.color -eq 4 -and $layers.TELJED.lineweight -eq 13 -and $layers.TELJED.linetype -eq 'DASHDOT' -and $layers.SEINAD.color -eq 6 -and $layers.SEINAD.lineweight -eq 50 -and $layers.SEINAD.linetype -eq 'DASHED' -and $layers.VIIRUTUS.color -eq 9 -and $layers.VIIRUTUS.lineweight -eq 13 -and $layers.VIIRUTUS.linetype -eq 'Continuous'
    styles = $styles -contains 'NORMAL' -and $styles -contains 'Standard'
    readOnly = $openedReadOnly
    polylineClosureStable = @($polylineClosuresAfterRegen.Keys | Where-Object { [bool]$nativeRecords[$_].closed -ne [bool]$polylineClosuresAfterRegen[$_] }).Count -eq 0
  }
  $result = [ordered]@{
    schemaVersion = 1; rowId = 'F-109'; benchmark = 'AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation'
    engine = 'Autodesk AutoCAD 2024 desktop COM'; engineVersion = $engineVersion
    automationProcessId = $automationProcessId; automationProcessOwned = $owned
    sourcePath = [IO.Path]::GetFileName($source); documentName = [string](Invoke-ComRetry { $document.Name })
    units = [int](Invoke-ComRetry { $document.GetVariable('INSUNITS') })
    totalEntities = $modelCount
    entities = $counts; handles = @($handles); nativeRecords = $nativeRecords; polylineClosuresAfterRegen = $polylineClosuresAfterRegen; layers = $layers; styles = $styles; extents = $extents
    openedReadOnly = $openedReadOnly
    checks = $checks; status = if (@($checks.Values | Where-Object { $_ -ne $true }).Count -eq 0) { 'PASS' } else { 'FAIL' }
  }
} finally {
  if ($acad -and -not $owned) {
    try { $automationProcessId = Set-OwnedPidSidecar $acad; $owned = $automationProcessId -gt 0 } catch {}
  }
  if ($document) {
    try { Invoke-ComRetry { $document.Close($false) } -TimeoutSeconds 10 | Out-Null; $closedWithoutSaving = $true }
    catch { $cleanupError = "Close failed: $($_.Exception.Message)" }
  }
  if ($owned -and $acad) {
    try { Invoke-ComRetry { $acad.Quit() } -TimeoutSeconds 10 | Out-Null; $quitRequested = $true }
    catch { if (-not $cleanupError) { $cleanupError = "Quit failed: $($_.Exception.Message)" } }
  }
}
if (-not $result) { throw 'F-109 desktop AutoCAD read-back produced no result.' }
$result.closedWithoutSaving = $closedWithoutSaving
$result.quitRequested = $quitRequested
if ($cleanupError) { throw $cleanupError }
if (-not $closedWithoutSaving -or -not $quitRequested) { throw 'F-109 desktop cleanup was not independently observed.' }
$result | ConvertTo-Json -Depth 10
if ($result.status -ne 'PASS') { exit 1 }
