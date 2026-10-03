param([string]$GameDirectory = 'C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced')
$ErrorActionPreference = 'Stop'
$taskGame = [IO.Path]::GetFullPath($GameDirectory).TrimEnd('\')
$taskPackage = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
$taskScripts = Join-Path $taskGame 'scripts\LivingLosSantos'
$taskManifest = Get-Content -LiteralPath (Join-Path $taskPackage 'release-manifest.json') -Raw | ConvertFrom-Json
if (@(Get-Process -Name GTA5,GTA5_Enhanced,RAGEPluginHook -ErrorAction SilentlyContinue).Count) { throw 'Close GTA and RAGE Plugin Hook before installing the world director.' }
$taskExe = Join-Path $taskGame 'GTA5_Enhanced.exe'
if (-not (Test-Path -LiteralPath $taskExe)) { throw 'This package requires GTA V Enhanced.' }
if ((Get-Item -LiteralPath $taskExe).VersionInfo.FileVersion -ne $taskManifest.GameVersion) { throw 'Game version changed. Rebuild and audit the client against this game before installing.' }
if ((Get-FileHash -LiteralPath (Join-Path $taskGame 'ScriptHookVDotNet3.dll') -Algorithm SHA256).Hash -ne $taskManifest.ScriptHookVDotNet3SHA256) { throw 'Enhanced ScriptHook API changed. Rebuild and audit before installing.' }
$taskIni = Join-Path $taskGame 'ScriptHookVDotNet.ini'
$taskOriginal = [IO.File]::ReadAllText($taskIni)
if ($taskOriginal -notmatch '(?m)^ScriptsLocation=' -or $taskOriginal -notmatch '(?m)^AutoLoadScripts=') { throw 'Expected SHVDN settings are missing; file preserved.' }
$taskUpdated = [regex]::Replace($taskOriginal, '(?m)^ScriptsLocation=[^\r\n]*', 'ScriptsLocation="scripts\LivingLosSantos"')
$taskUpdated = [regex]::Replace($taskUpdated, '(?m)^AutoLoadScripts=[^\r\n]*', 'AutoLoadScripts=true')
$taskInstallRecord = Join-Path $taskPackage 'world-install-manifest.json'
$taskPrior = $null
if (Test-Path -LiteralPath $taskInstallRecord) {
  $taskPrior = Get-Content -LiteralPath $taskInstallRecord -Raw | ConvertFrom-Json
  if ($taskPrior.GameDirectory -ne $taskGame) { throw 'This package records another installation. Preserve that installation record first.' }
  if ((Get-FileHash -LiteralPath $taskIni -Algorithm SHA256).Hash -ne $taskPrior.InstalledConfigSHA256) { throw 'SHVDN configuration changed since installation; preserved for reconciliation.' }
}
else {
  $taskCurrentScripts = [regex]::Match($taskOriginal, '(?m)^ScriptsLocation=([^\r\n]*)').Groups[1].Value.Trim().Trim('"').Replace('/','\').TrimEnd('\')
  if ($taskCurrentScripts -eq 'scripts\LivingLosSantos') {
    throw 'The dedicated world director is already configured, but this package has no world-install-manifest.json. Use the original installation package and its recovery record. Existing files were preserved; already-modified settings cannot be recorded as the original rollback.'
  }
}
$taskPayloads = @($taskManifest.ClientFiles | ForEach-Object {
  if ($_.Name -ne 'LivingLSAIsV2.Enhanced.dll') { throw 'Unexpected runtime payload.' }
  $taskSource = [IO.Path]::GetFullPath((Join-Path $taskPackage $_.Source))
  if (-not $taskSource.StartsWith($taskPackage+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Payload is outside this package.' }
  if ((Get-FileHash -LiteralPath $taskSource -Algorithm SHA256).Hash -ne $_.SHA256) { throw 'Payload hash does not match release manifest.' }
  [pscustomobject]@{Source=$taskSource;Path=(Join-Path $taskScripts $_.Name);SHA256=$_.SHA256}
})
if ($taskPayloads.Count -ne 1) { throw 'Expected one game-client DLL.' }
foreach ($taskPayload in $taskPayloads) {
  if (Test-Path -LiteralPath $taskPayload.Path) {
    $taskHash=(Get-FileHash -LiteralPath $taskPayload.Path -Algorithm SHA256).Hash
    if ($taskHash -ne $taskPayload.SHA256 -and (-not $taskPrior -or $taskPrior.ClientSHA256 -ne $taskHash)) { throw 'An unrecognized client occupies the target; preserved.' }
  }
}
$taskRecovery = Join-Path $taskPackage ('backups\world-install-'+(Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $taskRecovery -Force | Out-Null
Copy-Item -LiteralPath $taskIni -Destination (Join-Path $taskRecovery 'ScriptHookVDotNet.ini')
if ($taskPrior) { Copy-Item -LiteralPath $taskInstallRecord -Destination (Join-Path $taskRecovery 'previous-install-manifest.json') }
New-Item -ItemType Directory -Path $taskScripts -Force | Out-Null
foreach ($taskPayload in $taskPayloads) {
  if (Test-Path -LiteralPath $taskPayload.Path) { Copy-Item -LiteralPath $taskPayload.Path -Destination (Join-Path $taskRecovery 'previous-client.dll') }
  Copy-Item -LiteralPath $taskPayload.Source -Destination $taskPayload.Path
  if ((Get-FileHash -LiteralPath $taskPayload.Path -Algorithm SHA256).Hash -ne $taskPayload.SHA256) { throw 'Installed DLL hash mismatch; recovery files retained.' }
}
[IO.File]::WriteAllText($taskIni, $taskUpdated, (New-Object System.Text.UTF8Encoding($false)))
$taskRecord = [ordered]@{
  InstalledAt=[DateTime]::UtcNow.ToString('o');GameDirectory=$taskGame;ClientPath=$taskPayloads[0].Path;ClientSHA256=$taskPayloads[0].SHA256
  ConfigPath=$taskIni;InstalledConfigSHA256=(Get-FileHash -LiteralPath $taskIni -Algorithm SHA256).Hash
  OriginalConfig=if($taskPrior){$taskPrior.OriginalConfig}else{Join-Path $taskRecovery 'ScriptHookVDotNet.ini'}
  OriginalConfigSHA256=if($taskPrior){$taskPrior.OriginalConfigSHA256}else{(Get-FileHash -LiteralPath (Join-Path $taskRecovery 'ScriptHookVDotNet.ini') -Algorithm SHA256).Hash}
  RecoveryDirectory=$taskRecovery;AutoStartEnabled=$true;ScriptsLocation='scripts\LivingLosSantos';InGameVerified=$false
}
$taskRecord | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $taskInstallRecord -Encoding UTF8
Write-Output 'Living Los Santos installed in its own script folder. It will start automatically in Story Mode. Existing scripts and private credentials are preserved; SHVDN now loads only this dedicated folder.'

