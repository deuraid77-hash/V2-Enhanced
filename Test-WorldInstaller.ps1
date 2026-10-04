$ErrorActionPreference='Stop'
$taskRoot=$PSScriptRoot
$taskFixture=Join-Path $taskRoot ('verification\installer-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
$taskPackage=Join-Path $taskFixture 'package'
$taskGame=Join-Path $taskFixture 'fake-game'
New-Item -ItemType Directory -Path $taskPackage,$taskGame,(Join-Path $taskPackage 'source\game-client\bin') -Force | Out-Null
foreach($taskName in @('Install-EnhancedClient.ps1','Disable-EnhancedClient.ps1','Start-V2-Companion.ps1')) { Copy-Item -LiteralPath (Join-Path $taskRoot $taskName) -Destination (Join-Path $taskPackage $taskName) }
$taskIni=Join-Path $taskGame 'ScriptHookVDotNet.ini'
[IO.File]::WriteAllText($taskIni,"ScriptsLocation=`"scripts`"`r`nAutoLoadScripts=false`r`nConsoleKeyBinding=F4`r`n")
$taskBefore=(Get-FileHash -LiteralPath $taskIni).Hash
[IO.File]::WriteAllText((Join-Path $taskGame 'GTA5_Enhanced.exe'),'fixture, never executed')
[IO.File]::WriteAllText((Join-Path $taskGame 'ScriptHookVDotNet3.dll'),'fixture API, never loaded')
$taskDll=Join-Path $taskPackage 'source\game-client\bin\LivingLSAIsV2.Enhanced.dll'
[IO.File]::WriteAllText($taskDll,'fixture payload, never loaded')
$taskManifest=@{GameVersion=(Get-Item -LiteralPath (Join-Path $taskGame 'GTA5_Enhanced.exe')).VersionInfo.FileVersion;ScriptHookVDotNet3SHA256=(Get-FileHash -LiteralPath (Join-Path $taskGame 'ScriptHookVDotNet3.dll')).Hash;ClientFiles=@(@{Name='LivingLSAIsV2.Enhanced.dll';Source='source\game-client\bin\LivingLSAIsV2.Enhanced.dll';SHA256=(Get-FileHash -LiteralPath $taskDll).Hash})}
$taskManifest|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $taskPackage 'release-manifest.json')
$taskChecks=New-Object System.Collections.Generic.List[string]
function Assert-WorldInstall([bool]$Condition,[string]$Name) { if(-not $Condition){throw "FAILED: $Name"}; $taskChecks.Add($Name) }
# Scope the process fixture to this script: the real game and its files are never touched.
function Get-Process { param($Name,$ErrorAction) return @() }
& (Join-Path $taskPackage 'Install-EnhancedClient.ps1') -GameDirectory $taskGame
$taskRecord=Get-Content -LiteralPath (Join-Path $taskPackage 'world-install-manifest.json') -Raw|ConvertFrom-Json
Assert-WorldInstall ((Get-FileHash -LiteralPath $taskRecord.ClientPath).Hash -eq $taskManifest.ClientFiles[0].SHA256) 'payload installed and verified'
Assert-WorldInstall ((Get-Content -LiteralPath $taskIni -Raw) -match 'AutoLoadScripts=true') 'autoload enabled'
Assert-WorldInstall ((Get-Content -LiteralPath $taskIni -Raw) -match 'ScriptsLocation="scripts\\LivingLosSantos"') 'isolated script directory selected'
Assert-WorldInstall ((Get-FileHash -LiteralPath $taskRecord.OriginalConfig).Hash -eq $taskBefore) 'original loading settings backed up byte-for-byte'
& (Join-Path $taskPackage 'Install-EnhancedClient.ps1') -GameDirectory $taskGame
$taskSecond=Get-Content -LiteralPath (Join-Path $taskPackage 'world-install-manifest.json') -Raw|ConvertFrom-Json
Assert-WorldInstall ($taskSecond.OriginalConfig -eq $taskRecord.OriginalConfig) 'repeat install retains original rollback'
$taskRecordPath=Join-Path $taskPackage 'world-install-manifest.json'
$taskSavedRecord=Join-Path $taskFixture 'preserved-install-manifest.json'
Copy-Item -LiteralPath $taskRecordPath -Destination $taskSavedRecord
Remove-Item -LiteralPath $taskRecordPath
$taskConfiguredHash=(Get-FileHash -LiteralPath $taskIni).Hash
$taskBackupCount=@(Get-ChildItem -LiteralPath (Join-Path $taskPackage 'backups') -Directory).Count
$taskMissingRecordRefused=$false
try { & (Join-Path $taskPackage 'Install-EnhancedClient.ps1') -GameDirectory $taskGame } catch { $taskMissingRecordRefused=$_.Exception.Message -match 'no world-install-manifest.json' }
Assert-WorldInstall $taskMissingRecordRefused 'reinstall without original record refuses an already configured director'
Assert-WorldInstall (((Get-FileHash -LiteralPath $taskIni).Hash -eq $taskConfiguredHash) -and ((Get-FileHash -LiteralPath $taskRecord.ClientPath).Hash -eq $taskManifest.ClientFiles[0].SHA256)) 'missing-record refusal preserves installed configuration and DLL'
Assert-WorldInstall ((-not(Test-Path -LiteralPath $taskRecordPath)) -and (@(Get-ChildItem -LiteralPath (Join-Path $taskPackage 'backups') -Directory).Count -eq $taskBackupCount)) 'missing-record refusal creates no false rollback record or backup'
Copy-Item -LiteralPath $taskSavedRecord -Destination $taskRecordPath
[IO.File]::AppendAllText($taskIni,"# user change`r`n")
$taskRefused=$false
try { & (Join-Path $taskPackage 'Disable-EnhancedClient.ps1') } catch { $taskRefused=$_.Exception.Message -match 'settings changed' }
Assert-WorldInstall $taskRefused 'rollback refuses to overwrite user changes'
Copy-Item -LiteralPath (Join-Path $taskSecond.RecoveryDirectory 'ScriptHookVDotNet.ini') -Destination $taskIni
& (Join-Path $taskPackage 'Disable-EnhancedClient.ps1')
Assert-WorldInstall ((Get-FileHash -LiteralPath $taskIni).Hash -eq $taskBefore) 'rollback restores exact original settings'
Assert-WorldInstall (-not(Test-Path -LiteralPath $taskRecord.ClientPath)) 'rollback parks only installed DLL'
Assert-WorldInstall (-not(Test-Path -LiteralPath (Join-Path $taskPackage 'world-install-manifest.json'))) 'rollback clears active installation record'
Assert-WorldInstall (Test-Path -LiteralPath (Join-Path $taskGame 'GTA5_Enhanced.exe')) 'unrelated files preserved'
# Fake only the launcher dependencies below; no requests or process operations
# reach the running companion or the real game during compatibility checks.
$taskMockHealth=$null
$taskMockStarts=0
function Invoke-RestMethod { param($Uri,$TimeoutSec) return $taskMockHealth }
function Start-Process { param($FilePath,$ArgumentList,$WorkingDirectory,$WindowStyle,$RedirectStandardOutput,$RedirectStandardError,[switch]$PassThru) $script:taskMockStarts++; throw 'Unexpected fixture process start.' }
$taskMockHealth=[pscustomobject]@{mode='enhanced-companion';version='2.4.0-enhanced-adapter'}
$taskOldRefused=$false
try { & (Join-Path $taskPackage 'Start-V2-Companion.ps1') -NoBrowser } catch { $taskOldRefused=$_.Exception.Message -match 'incompatible Living Los Santos companion' }
Assert-WorldInstall $taskOldRefused 'launcher refuses the old version 2 companion instead of falsely reporting readiness'
$taskMockHealth=[pscustomobject]@{mode='enhanced-companion';version='4.0.0-enhanced-foundation';worldRuntime=[pscustomobject]@{protocol=3}}
$taskWrongProtocolRefused=$false
try { & (Join-Path $taskPackage 'Start-V2-Companion.ps1') -NoBrowser } catch { $taskWrongProtocolRefused=$_.Exception.Message -match 'incompatible Living Los Santos companion' }
Assert-WorldInstall $taskWrongProtocolRefused 'launcher requires protocol 4 in addition to a version 4 label'
$taskMockHealth=[pscustomobject]@{mode='enhanced-companion';version='3.0.0-enhanced-world';worldRuntime=[pscustomobject]@{protocol=4}}
$taskWrongVersionRefused=$false
try { & (Join-Path $taskPackage 'Start-V2-Companion.ps1') -NoBrowser } catch { $taskWrongVersionRefused=$_.Exception.Message -match 'incompatible Living Los Santos companion' }
Assert-WorldInstall $taskWrongVersionRefused 'launcher requires version 4 in addition to a protocol 4 label'
$taskMockHealth=[pscustomobject]@{mode='enhanced-companion';version='3.0.0-enhanced-world';worldRuntime=[pscustomobject]@{protocol=3}}
$taskV3Refused=$false
try { & (Join-Path $taskPackage 'Start-V2-Companion.ps1') -NoBrowser } catch { $taskV3Refused=$_.Exception.Message -match 'incompatible Living Los Santos companion' }
Assert-WorldInstall $taskV3Refused 'launcher refuses a running version 3 / protocol 3 companion'
$taskMockHealth=[pscustomobject]@{mode='enhanced-companion';version='4.0.0-enhanced-foundation';worldRuntime=[pscustomobject]@{protocol=4}}
& (Join-Path $taskPackage 'Start-V2-Companion.ps1') -NoBrowser
Assert-WorldInstall ($taskMockStarts -eq 0) 'compatible companion is reused and incompatible running processes are never stopped or relaunched'
[pscustomobject]@{checkedAt=[DateTime]::UtcNow.ToString('o');fixture=$taskFixture;passed=$taskChecks.Count;checks=$taskChecks;realGameTouched=$false}|ConvertTo-Json -Depth 4|Set-Content -LiteralPath (Join-Path $taskRoot 'world-installer-tests.json')
Write-Output "$($taskChecks.Count) isolated installer/rollback checks passed."
