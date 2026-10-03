param([switch]$PortalOnly)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'Start-V2-Companion.ps1')
if ($PortalOnly) { return }
$taskGame='C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced'
if (Get-Process -Name GTA5_Enhanced,RAGEPluginHook -ErrorAction SilentlyContinue) { Write-Output 'GTA or RAGE Plugin Hook is already running.'; return }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'world-install-manifest.json'))) { throw 'Install the rebuilt client first with Install-EnhancedClient.ps1 while GTA and RAGE are closed.' }
Start-Process -FilePath (Join-Path $taskGame 'RAGEPluginHook.exe') -WorkingDirectory $taskGame -WindowStyle Hidden

