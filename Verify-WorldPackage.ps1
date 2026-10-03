param([string]$Archive=(Join-Path ([Environment]::GetFolderPath('Desktop')) 'living-los-santos-world-director-v3-enhanced.zip'))
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskKeys=New-Object System.Collections.Generic.List[string]
$taskGame='C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced'
foreach($taskPrivate in @('scripts\LivingLSAIs.ini','scripts\LLAI SERVER\OPENAI SETTINGS.ini')) {
  $taskPath=Join-Path $taskGame $taskPrivate
  if(Test-Path -LiteralPath $taskPath) {
    foreach($taskLine in (Get-Content -LiteralPath $taskPath)) {
      if($taskLine -match '(?i)^\s*[^=]*(?:key|secret|token)[^=]*=\s*(.+?)\s*$') {
        $taskValue=$Matches[1].Trim().Trim('"')
        if($taskValue.Length -ge 24 -and $taskValue -match '^[A-Za-z0-9_.-]+$') { $taskKeys.Add($taskValue) }
      }
    }
  }
}
$taskManifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'release-manifest.json') -Raw|ConvertFrom-Json
$taskArchive=[IO.Compression.ZipFile]::OpenRead($Archive)
$taskNames=New-Object System.Collections.Generic.HashSet[string]([StringComparer]::OrdinalIgnoreCase)
$taskScanned=0
$taskDllHash=$null
try {
  foreach($taskEntry in $taskArchive.Entries) {
    $taskName=$taskEntry.FullName.Replace('\','/')
    if($taskName.StartsWith('/') -or $taskName -match '(^|/)\.\.(/|$)|:' -or -not $taskNames.Add($taskName)) { throw 'Package has an unsafe or duplicate entry path.' }
    if($taskName -match '(^|/)(node_modules|backups|verification)/|^source/data/|\.env\.local$|\.ini$|qa-world-fixture|world-requests\.json|world-settings\.json|campaign-v3\.json') { throw "Private or test state included: $taskName" }
    if($taskEntry.Length -gt 32MB) { throw 'Unexpectedly large package member.' }
    $taskStream=$taskEntry.Open(); $taskMemory=New-Object IO.MemoryStream
    try {$taskStream.CopyTo($taskMemory);$taskBytes=$taskMemory.ToArray()} finally {$taskStream.Dispose();$taskMemory.Dispose()}
    foreach($taskEncoding in @([Text.Encoding]::UTF8,[Text.Encoding]::Unicode)) {
      $taskDecoded=$taskEncoding.GetString($taskBytes)
      foreach($taskKey in $taskKeys) { if($taskDecoded.Contains($taskKey)) { throw "Private credential detected in package member: $taskName" } }
    }
    if($taskName -eq 'source/game-client/bin/LivingLSAIsV2.Enhanced.dll') {
      $taskSha=[Security.Cryptography.SHA256]::Create()
      try {$taskDllHash=([BitConverter]::ToString($taskSha.ComputeHash($taskBytes))).Replace('-','')} finally {$taskSha.Dispose()}
    }
    $taskScanned++
  }
} finally {$taskArchive.Dispose()}
foreach($taskRequired in @('README.md','WORLD-REBUILD.md','world-verification.json','release-manifest.json','Install-EnhancedClient.ps1','Disable-EnhancedClient.ps1','Start-Living-Los-Santos.cmd','source/package-lock.json','source/server-lib/world.ts','source/dist/index.html','source/game-client/WorldDirector.cs','source/game-client/bin/LivingLSAIsV2.Enhanced.dll')) { if(-not $taskNames.Contains($taskRequired)){throw "Missing release file: $taskRequired"} }
if($taskDllHash -ne $taskManifest.ClientFiles[0].SHA256) { throw 'Packaged DLL differs from release manifest.' }
$taskInstalled=Join-Path $taskGame 'scripts\LivingLosSantos\LivingLSAIsV2.Enhanced.dll'
$taskMatchesInstalled=(Test-Path -LiteralPath $taskInstalled) -and (Get-FileHash -LiteralPath $taskInstalled).Hash -eq $taskDllHash
[ordered]@{CheckedAt=[DateTime]::UtcNow.ToString('o');Archive=$Archive;EntriesRead=$taskScanned;RequiredFilesPresent=$true;PrivateStateExcluded=$true;CredentialMatches=0;DLLMatchesRelease=$true;DLLMatchesInstalled=$taskMatchesInstalled;SHA256=(Get-FileHash -LiteralPath $Archive).Hash;Bytes=(Get-Item -LiteralPath $Archive).Length}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $PSScriptRoot 'world-package-verification.json')
Write-Output "Verified $taskScanned archive members; private state excluded; no credential matches; DLL matches release: true; matches installed: $taskMatchesInstalled."
