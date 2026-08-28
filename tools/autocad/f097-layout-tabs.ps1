$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class F097WindowProcess {
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
  $commands = try { [string]$Document.GetVariable('CMDNAMES') } catch { '' }
  $prompt = try { [string]$Document.GetVariable('LASTPROMPT') } catch { '' }
  throw "AutoCAD did not return idle. CMDNAMES='$commands' LASTPROMPT='$prompt'"
}

function Get-LayoutSnapshot {
  param([Parameter(Mandatory = $true)]$Document)
  return @(Invoke-ComRetry {
      @($Document.Layouts |
        Sort-Object { [int]$_.TabOrder } |
        ForEach-Object {
          $circles = @($_.Block | Where-Object { [string]$_.ObjectName -eq 'AcDbCircle' })
          $viewports = @($_.Block | Where-Object { [string]$_.ObjectName -eq 'AcDbViewport' })
          [ordered]@{
            name = [string]$_.Name
            tabOrder = [int]$_.TabOrder
            circleCount = [int]$circles.Count
            circleHandles = @($circles | ForEach-Object { [string]$_.Handle })
            circleRadii = @($circles | ForEach-Object { [double]$_.Radius })
            viewportCount = [int]$viewports.Count
            viewportHandles = @($viewports | ForEach-Object { [string]$_.Handle })
            plotRotation = [int]$_.PlotRotation
          }
        })
    } -TimeoutSeconds 30)
}

function Send-AcadCommand {
  param([Parameter(Mandatory = $true)]$Document, [Parameter(Mandatory = $true)][string]$Command)
  Invoke-ComRetry { $Document.SendCommand($Command) } | Out-Null
  Wait-AcadIdle $Document
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

$preExistingProcessIds = @(Get-Process -Name 'acad' -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.Id })
$acad = $null; $scratch = $null; $reopened = $null; $result = $null; $automationProcessId = 0; $owned = $false
$tempDwg = Join-Path ([IO.Path]::GetTempPath()) ("KuubikDraw-F097-{0}.dwg" -f [guid]::NewGuid().ToString('N'))
try {
  $acad = Invoke-ComRetry { New-Object -ComObject AutoCAD.Application.24.3 } -TimeoutSeconds 30
  Invoke-ComRetry { $acad.Visible = $true } | Out-Null
  [uint32]$resolvedProcessId = 0
  [void][F097WindowProcess]::GetWindowThreadProcessId([IntPtr][int64](Invoke-ComRetry { $acad.HWND }), [ref]$resolvedProcessId)
  $automationProcessId = [int]$resolvedProcessId
  $owned = $automationProcessId -gt 0 -and $preExistingProcessIds -notcontains $automationProcessId
  Write-Host "[F-097] automation-process pid=$automationProcessId owned=$owned"
  if (-not $owned) { throw 'F-097 refuses to use a pre-existing AutoCAD process.' }
  $scratch = if ([int](Invoke-ComRetry { $acad.Documents.Count }) -gt 0) { Invoke-ComRetry { $acad.ActiveDocument } } else { Invoke-ComRetry { $acad.Documents.Add() } }
  if ([string](Invoke-ComRetry { $scratch.FullName }) -or [int](Invoke-ComRetry { $scratch.ModelSpace.Count }) -ne 0) { throw 'F-097 refuses a saved or non-blank drawing.' }
  Invoke-ComRetry { $scratch.Activate() } | Out-Null
  Wait-AcadIdle $scratch

  $papers = @($scratch.Layouts | Where-Object { [string]$_.Name -ne 'Model' } | Sort-Object TabOrder)
  if ($papers.Count -lt 1) { throw 'F-097 QNEW did not provide a paper layout.' }
  $source = $papers[0]
  $notes = if ($papers.Count -gt 1) { $papers[1] } else { Invoke-ComRetry { $scratch.Layouts.Add('Layout 2') } }
  foreach ($extra in @($papers | Select-Object -Skip 2)) { Invoke-ComRetry { $extra.Delete() } | Out-Null }
  Invoke-ComRetry { $source.Name = 'F097 PLAN'; $notes.Name = 'F097 NOTES'; $source.TabOrder = 1; $notes.TabOrder = 2; $source.PlotRotation = 1 } | Out-Null
  [double[]]$center = @(50, 50, 0)
  $circle = Invoke-ComRetry { $source.Block.AddCircle($center, 25) }
  $afterCreate = Get-LayoutSnapshot $scratch

  Send-AcadCommand $scratch "_.-LAYOUT`n_New`nF097 CREATED`n"
  $afterNativeCreate = Get-LayoutSnapshot $scratch
  Send-AcadCommand $scratch "_.-LAYOUT`n_Delete`nF097 CREATED`n"

  Invoke-ComRetry { $scratch.ActiveLayout = $source } | Out-Null
  Send-AcadCommand $scratch "_.-LAYOUT`n_Copy`nF097 PLAN`n`n"
  $copy = Invoke-ComRetry { $scratch.Layouts.Item('F097 PLAN (2)') }
  $afterCopy = Get-LayoutSnapshot $scratch

  Invoke-ComRetry { $circle.Radius = 30; $notes.TabOrder = 1 } | Out-Null
  $afterReorder = Get-LayoutSnapshot $scratch

  $duplicateRejected = $false
  try { $notes.Name = 'f097 plan' } catch { $duplicateRejected = $true }
  if (-not $duplicateRejected) { $notes.Name = 'F097 NOTES' }
  $longRejected = $false
  try { $notes.Name = ('X' * 256) } catch { $longRejected = $true }
  if (-not $longRejected) { $notes.Name = 'F097 NOTES' }
  $invalidCharacterRejected = $false
  try { $notes.Name = 'F097?BAD' } catch { $invalidCharacterRejected = $true }
  if (-not $invalidCharacterRejected) { $notes.Name = 'F097 NOTES' }

  Invoke-ComRetry { $scratch.ActiveLayout = $copy } | Out-Null
  Send-AcadCommand $scratch "_.-LAYOUT`n_Delete`nF097 PLAN (2)`n"
  $activeAfterDelete = [string](Invoke-ComRetry { $scratch.ActiveLayout.Name })
  $afterDelete = Get-LayoutSnapshot $scratch
  Invoke-ComRetry { $scratch.SaveAs($tempDwg, 64) } | Out-Null
  Invoke-ComRetry { $scratch.Close($false) } | Out-Null
  $scratch = $null
  $dwgInfo = Get-Item -LiteralPath $tempDwg
  $dwgBytes = [long]$dwgInfo.Length
  $dwgSha256 = Get-Sha256 $tempDwg
  $reopened = Invoke-ComRetry { $acad.Documents.Open($tempDwg) }
  Invoke-ComRetry { $reopened.Activate() } | Out-Null
  Wait-AcadIdle $reopened
  $afterReopen = Get-LayoutSnapshot $reopened

  Invoke-ComRetry { $reopened.ActiveLayout = $reopened.Layouts.Item('Model') } | Out-Null
  Send-AcadCommand $reopened "_.-LAYOUT`n_Delete`nF097 NOTES`n"
  $afterSinglePaper = Get-LayoutSnapshot $reopened
  $lastPaperRejected = $false
  try { Invoke-ComRetry { $reopened.Layouts.Item('F097 PLAN').Delete() } -TimeoutSeconds 5 | Out-Null } catch { $lastPaperRejected = $true }
  $paperCountAfterLastDeleteAttempt = @($reopened.Layouts | Where-Object { [string]$_.Name -ne 'Model' }).Count

  for ($layoutIndex = $paperCountAfterLastDeleteAttempt + 1; $layoutIndex -le 255; $layoutIndex += 1) {
    $limitName = "F097 LIMIT $layoutIndex"
    Invoke-ComRetry { $reopened.Layouts.Add($limitName) } -TimeoutSeconds 10 | Out-Null
  }
  $paperCountAtLimit = @($reopened.Layouts | Where-Object { [string]$_.Name -ne 'Model' }).Count
  $paperLimitRejected = $false
  try { Invoke-ComRetry { $reopened.Layouts.Add('F097 LIMIT 256') } -TimeoutSeconds 5 | Out-Null } catch { $paperLimitRejected = $true }
  $paperCountAfterOverflowAttempt = @($reopened.Layouts | Where-Object { [string]$_.Name -ne 'Model' }).Count

  $copySnapshot = @($afterCopy | Where-Object { $_.name -eq 'F097 PLAN (2)' })[0]
  $sourceCopySnapshot = @($afterCopy | Where-Object { $_.name -eq 'F097 PLAN' })[0]
  $sourceAfterEdit = @($afterReorder | Where-Object { $_.name -eq 'F097 PLAN' })[0]
  $copyAfterEdit = @($afterReorder | Where-Object { $_.name -eq 'F097 PLAN (2)' })[0]
  $checks = [ordered]@{
    create = (@($afterCreate.name) -join '|') -eq 'Model|F097 PLAN|F097 NOTES'
    nativeCreateAndDelete = (@($afterNativeCreate.name) -join '|') -eq 'Model|F097 PLAN|F097 NOTES|F097 CREATED'
    copyBeforeSource = (@($afterCopy.name) -join '|') -eq 'Model|F097 PLAN (2)|F097 PLAN|F097 NOTES'
    copyPaperEntity = $copySnapshot.circleCount -eq 1 -and $copySnapshot.circleRadii[0] -eq 25 -and $copySnapshot.plotRotation -eq 1
    copyIndependentHandle = $copySnapshot.circleHandles[0] -ne (@($afterCopy | Where-Object { $_.name -eq 'F097 PLAN' })[0].circleHandles[0])
    copyViewportIdentity = $copySnapshot.viewportCount -gt 0 -and $copySnapshot.viewportCount -eq $sourceCopySnapshot.viewportCount -and @($copySnapshot.viewportHandles | Where-Object { $sourceCopySnapshot.viewportHandles -contains $_ }).Count -eq 0
    sourceEditIndependent = $sourceAfterEdit.circleRadii[0] -eq 30 -and $copyAfterEdit.circleRadii[0] -eq 25
    reorder = (@($afterReorder.name) -join '|') -eq 'Model|F097 NOTES|F097 PLAN (2)|F097 PLAN'
    deleteAdjacentActivation = $activeAfterDelete -eq 'F097 PLAN'
    delete = (@($afterDelete.name) -join '|') -eq 'Model|F097 NOTES|F097 PLAN'
    reopen = (@($afterReopen.name) -join '|') -eq 'Model|F097 NOTES|F097 PLAN'
    duplicateCaseInsensitiveRejected = $duplicateRejected
    nameOver255Rejected = $longRejected
    invalidCharacterRejected = $invalidCharacterRejected
    lastPaperDeleteRejectedOrNoOp = $paperCountAfterLastDeleteAttempt -eq 1 -and (@($afterSinglePaper.name) -join '|') -eq 'Model|F097 PLAN'
    paperLayoutLimit255 = $paperCountAtLimit -eq 255 -and $paperLimitRejected -and $paperCountAfterOverflowAttempt -eq 255
  }
  $status = if (@($checks.Values | Where-Object { $_ -ne $true }).Count -eq 0) { 'PASS' } else { 'FAIL' }
  $result = [ordered]@{
    schemaVersion = 1; rowId = 'F-097'; benchmark = 'AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation'
    engine = 'Autodesk AutoCAD 2024 desktop COM/native command'; engineVersion = [string](Invoke-ComRetry { $acad.Version })
    automationProcessId = $automationProcessId; automationProcessOwned = $owned
    operations = [ordered]@{ afterCreate = $afterCreate; afterNativeCreate = $afterNativeCreate; afterCopy = $afterCopy; afterReorder = $afterReorder; afterDelete = $afterDelete; afterReopen = $afterReopen; afterSinglePaper = $afterSinglePaper }
    limits = [ordered]@{ lastPaperDeleteRaisedError = $lastPaperRejected; paperCountAfterLastDeleteAttempt = $paperCountAfterLastDeleteAttempt; paperCountAtLimit = $paperCountAtLimit; paperCountAfterOverflowAttempt = $paperCountAfterOverflowAttempt }
    activeAfterDelete = $activeAfterDelete; checks = $checks
    dwg = [ordered]@{ bytes = $dwgBytes; sha256 = $dwgSha256; saveAsType = 64; retained = $false }
    status = $status
  }
} finally {
  if ($reopened) { try { Invoke-ComRetry { $reopened.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
  if ($scratch) { try { Invoke-ComRetry { $scratch.Close($false) } -TimeoutSeconds 10 | Out-Null } catch {} }
  if (Test-Path -LiteralPath $tempDwg) { Remove-Item -LiteralPath $tempDwg -Force }
}

if (-not $result) { throw 'F-097 AutoCAD matrix produced no result.' }
$result.userDocument = [ordered]@{ isolatedOwnedProcess = $owned; blankRestored = $owned }
$finalStatus = $result.status
$result | ConvertTo-Json -Depth 12
if ($finalStatus -ne 'PASS') { exit 1 }
