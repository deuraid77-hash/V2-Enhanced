$ErrorActionPreference = 'Stop'
$taskRecord = Join-Path $PSScriptRoot 'running-companion.json'
if (-not (Test-Path -LiteralPath $taskRecord)) { Write-Output 'Close the companion command window to stop a manually launched server.'; return }
$taskRunning = Get-Content -LiteralPath $taskRecord -Raw | ConvertFrom-Json
$taskProcess = Get-Process -Id $taskRunning.Pid -ErrorAction SilentlyContinue
if (-not $taskProcess) { Write-Output 'The recorded background companion is already stopped.'; return }
$taskListener = Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue
if ($taskProcess.ProcessName -ne 'node' -or $taskListener.OwningProcess -ne $taskRunning.Pid) { throw 'The recorded process no longer matches the companion listener; nothing stopped.' }
$taskStarted = ([DateTimeOffset]$taskRunning.StartedAt).UtcDateTime
if ([Math]::Abs(($taskProcess.StartTime.ToUniversalTime() - $taskStarted).TotalSeconds) -gt 30) { throw 'The recorded process start time differs; nothing stopped.' }
Stop-Process -Id $taskRunning.Pid
Write-Output 'Stopped the recorded V2 background companion. Game files and original voice bridge are unchanged.'
