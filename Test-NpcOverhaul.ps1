param([ValidateSet('foundation','menu','mind','vehicles','audio','director','release')][string]$Stage='foundation')
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath($PSScriptRoot)
$taskSource=Join-Path $taskRoot 'source'
$taskEvidence=Join-Path $taskRoot ('verification\npc-overhaul\'+$Stage+'-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $taskEvidence -Force | Out-Null
$taskChecks=New-Object System.Collections.Generic.List[object]
function Invoke-NpcCheck([string]$Name,[scriptblock]$Command) {
  $taskStarted=[DateTime]::UtcNow
  $taskLog=Join-Path $taskEvidence ($Name+'.txt')
  $global:LASTEXITCODE=0
  try {
    & $Command *> $taskLog
    if ($LASTEXITCODE -ne 0) {throw ('Command exited '+$LASTEXITCODE)}
    $taskChecks.Add([pscustomobject]@{name=$Name;passed=$true;seconds=([DateTime]::UtcNow-$taskStarted).TotalSeconds;log=$taskLog})
    Write-Output ('PASS '+$Name)
  } catch {
    $taskChecks.Add([pscustomobject]@{name=$Name;passed=$false;seconds=([DateTime]::UtcNow-$taskStarted).TotalSeconds;log=$taskLog})
    Get-Content -LiteralPath $taskLog -Tail 30
    throw ('Stage check failed: '+$Name+'. Evidence retained at '+$taskEvidence)
  }
}
Push-Location $taskSource
try {
  Invoke-NpcCheck 'settings-generated' { & node.exe --import tsx scripts/generate-settings.ts --check }
  Invoke-NpcCheck 'typecheck' { & npm.cmd run typecheck }
  Invoke-NpcCheck 'backend-tests' { & npm.cmd test }
  Invoke-NpcCheck 'portal-build' { & npm.cmd run build -- --outDir (Join-Path $taskEvidence 'portal-dist') }
  Invoke-NpcCheck 'client-build' { & '.\game-client\Build-EnhancedClient.ps1' }
  Invoke-NpcCheck 'client-tests' { & '.\game-client\Test-EnhancedClient.ps1' }
  Invoke-NpcCheck 'client-audit' { & '.\game-client\Audit-EnhancedClient.ps1' }
  Invoke-NpcCheck 'audio-policy' { & '.\audio-host\Build-AudioHost.ps1' -SelfTest }
  Invoke-NpcCheck 'installer-rollback' { & (Join-Path $taskRoot 'Test-WorldInstaller.ps1') }
} finally {
  Pop-Location
  $taskReport=[ordered]@{checkedAt=[DateTime]::UtcNow.ToString('o');stage=$Stage;classification='VERIFIED';checks=$taskChecks.ToArray();passed=($taskChecks.Count -eq 9 -and @($taskChecks | Where-Object {-not $_.passed}).Count -eq 0);gameExecuted=$false;providerCalled=$false;nativeControllerTested=$false;nativeAudioHeard=$false;evidenceDirectory=$taskEvidence}
  $taskReport | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $taskEvidence 'gate.json') -Encoding utf8
}
Write-Output ('Offline stage checks complete: '+$taskEvidence)
