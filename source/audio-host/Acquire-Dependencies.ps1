param()
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$vendorRoot = Join-Path $PSScriptRoot 'vendor'
New-Item -ItemType Directory -Path $vendorRoot -Force | Out-Null
$packages = @(
    @{ Name='naudio.core'; Assembly='NAudio.Core'; Hash='63EC0488354353F035764E2CAE470B04AFB790B0E5A9706ED1987B9AF3CFE02F' },
    @{ Name='naudio.wasapi'; Assembly='NAudio.Wasapi'; Hash='AEC112D586ADF06C467F444AEC745BDE4932D7B44D77B393634FE5EA09E20B12' }
)
foreach ($package in $packages) {
    $archivePath = Join-Path $vendorRoot ($package.Name + '.2.4.0.nupkg')
    if (-not (Test-Path -LiteralPath $archivePath)) {
        Invoke-WebRequest -Uri ('https://api.nuget.org/v3-flatcontainer/' + $package.Name + '/2.4.0/' + $package.Name + '.2.4.0.nupkg') -OutFile $archivePath
    }
    if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -ne $package.Hash) { throw ('Unexpected hash: ' + $package.Name) }
    $packageRoot = Join-Path $vendorRoot $package.Name
    $archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
        foreach ($entryName in @(('lib/netstandard2.0/' + $package.Assembly + '.dll'), ($package.Assembly + '.nuspec'))) {
            $entry = $archive.GetEntry($entryName)
            if ($null -eq $entry -or $entry.Length -gt 4194304) { throw 'Pinned package entry missing or oversized.' }
            $destination = [System.IO.Path]::GetFullPath((Join-Path $packageRoot $entryName))
            if (-not $destination.StartsWith([System.IO.Path]::GetFullPath($vendorRoot) + [System.IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Dependency destination escaped vendor directory.' }
            New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$destination,$true)
        }
    } finally { $archive.Dispose() }
}
$licensePath = Join-Path $vendorRoot 'NAudio-LICENSE.txt'
if (-not (Test-Path -LiteralPath $licensePath)) { Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/naudio/NAudio/7c855e6737435f781dcbac782930a0de7a13cb2b/license.txt' -OutFile $licensePath }
if ((Get-FileHash -LiteralPath $licensePath -Algorithm SHA256).Hash -ne '303E01786B271EB464B3F43D18A375F2F17D37BC708A37C2FDF45B289FB5BFAA') { throw 'Unexpected NAudio licence hash.' }
'Verified NAudio 2.4.0 packages and MIT licence. No audio device was opened.'
