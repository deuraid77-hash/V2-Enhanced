param([string]$Destination = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'living-los-santos-world-director-v3-enhanced.zip'))
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$taskOutput = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $taskOutput) { throw 'Package already exists; choose a new destination to preserve it.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskRootNames = @('Start-V2-Companion.cmd','Start-V2-Companion.ps1','Stop-V2-Companion.ps1','Start-Living-Los-Santos.cmd','Start-Living-Los-Santos.ps1','Install-EnhancedClient.ps1','Disable-EnhancedClient.ps1','Package-Enhanced.ps1','Test-WorldInstaller.ps1','README.md','WORLD-REBUILD.md','STATUS.md','release-manifest.json','world-verification.json','world-installer-tests.json','archive-provenance.json','world-server-tests.txt','world-typecheck.txt','world-build.txt','world-dashboard.jpg','Verify-WorldPackage.ps1','world-browser-tests.json','world-csharp-contract-check.json','world-runtime-acceptance.json')
$taskRootNames += 'world-territory-result.jpg'
$taskFiles = @($taskRootNames | ForEach-Object { Join-Path $taskRoot $_ } | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
$taskSource = Join-Path $taskRoot 'source'
Push-Location $taskSource
try {
  $taskFiles += @(rg --files --hidden --no-ignore -g '!scripts/qa-*' -g '!node_modules/**' -g '!data/**' -g '!game-client/obj/**' -g '!game-client/bin/**' -g '!game-client/build/*.exe' -g '!.env*' -g '!*.log' | ForEach-Object { Join-Path $taskSource $_ })
} finally { Pop-Location }
$taskFiles += Join-Path $taskSource '.env.example'
$taskFiles += Join-Path $taskSource 'game-client\bin\LivingLSAIsV2.Enhanced.dll'
$taskFiles = @($taskFiles | Sort-Object -Unique)
foreach ($taskFile in $taskFiles) {
  $taskFull = [IO.Path]::GetFullPath($taskFile)
  if (-not $taskFull.StartsWith($taskRoot + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'A package member is outside the working directory.' }
  if ((Get-Item -LiteralPath $taskFull).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Package member is a reparse point.' }
  if ([IO.Path]::GetFileName($taskFull).StartsWith('.env') -and [IO.Path]::GetFileName($taskFull) -ne '.env.example') { throw 'Private environment file cannot be packaged.' }
}
$taskArchive = [IO.Compression.ZipFile]::Open($taskOutput, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($taskFile in $taskFiles) {
    $taskRelative = $taskFile.Substring($taskRoot.Length + 1).Replace('\','/')
    $null = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($taskArchive, $taskFile, $taskRelative, [IO.Compression.CompressionLevel]::Optimal)
  }
} finally { $taskArchive.Dispose() }
[pscustomobject]@{ Path = $taskOutput; Files = $taskFiles.Count; Bytes = (Get-Item -LiteralPath $taskOutput).Length; SHA256 = (Get-FileHash -LiteralPath $taskOutput -Algorithm SHA256).Hash } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'package-result.json') -Encoding UTF8
Write-Output "Created $taskOutput ($($taskFiles.Count) files)."
