param(
  [Parameter(Mandatory = $true)][string]$EvidenceDirectory
)

$resolved = [System.IO.Path]::GetFullPath($EvidenceDirectory)
if (-not [System.IO.Directory]::Exists($resolved)) {
  throw "Evidence directory does not exist: $resolved"
}

$receipt = [ordered]@{
  feature = "F-068"
  status = "NOT_RUN"
  reason = "Runner is preparation-only while the precision worker owns AutoCAD live execution."
  executedAt = $null
  autocadVersion = $null
  kuubikBuildSha = $null
  dxfSha256 = $null
  workflows = @()
}

$receipt | ConvertTo-Json -Depth 8
