param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$taskSource = Join-Path $taskRoot 'source'
$taskUrl = 'http://127.0.0.1:3000'
function Get-CompanionHealth {
  try { return Invoke-RestMethod -Uri ($taskUrl + '/api/health') -TimeoutSec 2 } catch { return $null }
}
function Test-Companion([object]$Health) {
  return $null -ne $Health -and $Health.mode -eq 'enhanced-companion' -and $Health.version -match '^4\.' -and $Health.worldRuntime.protocol -eq 4
}
$taskExistingHealth = Get-CompanionHealth
if (Test-Companion $taskExistingHealth) {
  Write-Output "The Living Los Santos companion is already running at $taskUrl"
  if (-not $NoBrowser) { Start-Process $taskUrl }
  return
}
if ($null -ne $taskExistingHealth -and $taskExistingHealth.mode -eq 'enhanced-companion') {
  throw 'An incompatible Living Los Santos companion is already running on port 3000. Stop the older companion with its own Stop-V2-Companion.ps1, then start this version 4 launcher. The running process was preserved.'
}
if (Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue) { throw 'Another application is using port 3000. Stop it or change the companion/client configuration together.' }
$taskNode = (Get-Command node.exe -ErrorAction Stop).Source
$taskVersion = [version]((& $taskNode --version).TrimStart('v'))
if ($taskVersion -lt [version]'22.12.0') { throw 'Node.js 22.12 or newer is required.' }
Push-Location $taskSource
try {
  if (-not (Test-Path -LiteralPath (Join-Path $taskSource 'node_modules\tsx'))) {
    & npm.cmd ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
  }
  if (-not (Test-Path -LiteralPath (Join-Path $taskSource 'dist\index.html'))) {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Dashboard build failed.' }
  }
} finally { Pop-Location }
$env:NODE_ENV = 'production'
$taskProcess = Start-Process -FilePath $taskNode -ArgumentList @('--import','tsx','server.ts') -WorkingDirectory $taskSource -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRoot 'companion-stdout.log') -RedirectStandardError (Join-Path $taskRoot 'companion-stderr.log') -PassThru
[pscustomobject]@{Pid=$taskProcess.Id;Port=3000;StartedAt=[DateTime]::UtcNow.ToString('o');Source=$taskSource} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'running-companion.json') -Encoding UTF8
$taskReady = $false
for ($taskTry=0; $taskTry -lt 40; $taskTry++) {
  if (Test-Companion (Get-CompanionHealth)) { $taskReady=$true; break }
  $taskProcess.Refresh()
  if ($taskProcess.HasExited) { break }
  Start-Sleep -Milliseconds 250
}
if (-not $taskReady) { throw 'Companion startup failed; inspect companion-stderr.log in this package.' }
Write-Output "The Living Los Santos companion is running in the background at $taskUrl. Use Stop-V2-Companion.ps1 to stop it."
if (-not $NoBrowser) { Start-Process $taskUrl }
