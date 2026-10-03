$ErrorActionPreference = 'Stop'
if (@(Get-Process -Name GTA5,GTA5_Enhanced,RAGEPluginHook -ErrorAction SilentlyContinue).Count) { throw 'Close GTA and RAGE Plugin Hook before disabling the world director.' }
$taskManifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'world-install-manifest.json') -Raw | ConvertFrom-Json
$taskAllowed = [IO.Path]::GetFullPath((Join-Path $taskManifest.GameDirectory 'scripts\LivingLosSantos\LivingLSAIsV2.Enhanced.dll'))
$taskTarget = [IO.Path]::GetFullPath($taskManifest.ClientPath)
if ($taskTarget -ne $taskAllowed) { throw 'Recorded DLL is outside the dedicated client path.' }
$taskConfig = [IO.Path]::GetFullPath($taskManifest.ConfigPath)
if ($taskConfig -ne [IO.Path]::GetFullPath((Join-Path $taskManifest.GameDirectory 'ScriptHookVDotNet.ini'))) { throw 'Unexpected configuration path.' }
$taskOriginalConfig=[IO.Path]::GetFullPath($taskManifest.OriginalConfig)
if (-not $taskOriginalConfig.StartsWith([IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'backups')).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Recovery configuration outside package backups.' }
if ((Get-FileHash -LiteralPath $taskConfig -Algorithm SHA256).Hash -ne $taskManifest.InstalledConfigSHA256) { throw 'SHVDN settings changed since installation. Preserved for manual reconciliation.' }
if ((Get-FileHash -LiteralPath $taskOriginalConfig -Algorithm SHA256).Hash -ne $taskManifest.OriginalConfigSHA256) { throw 'Recovery configuration hash mismatch.' }
if ((Test-Path -LiteralPath $taskTarget) -and (Get-FileHash -LiteralPath $taskTarget -Algorithm SHA256).Hash -ne $taskManifest.ClientSHA256) { throw 'Client changed since installation. Preserved.' }
$taskDestination = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ('disabled\world-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))))
if (-not $taskDestination.StartsWith([IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Recovery destination outside package.' }
New-Item -ItemType Directory -Path $taskDestination -Force | Out-Null
if (Test-Path -LiteralPath $taskTarget) { Move-Item -LiteralPath $taskTarget -Destination (Join-Path $taskDestination 'LivingLSAIsV2.Enhanced.dll') }
Copy-Item -LiteralPath $taskOriginalConfig -Destination $taskConfig
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'world-install-manifest.json') -Destination (Join-Path $taskDestination 'world-install-manifest.json')
Remove-Item -LiteralPath (Join-Path $PSScriptRoot 'world-install-manifest.json')
Write-Output "World director parked at $taskDestination. Previous SHVDN loading settings restored. Campaign files retained."

