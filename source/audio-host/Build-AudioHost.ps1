param([switch]$SelfTest)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'Acquire-Dependencies.ps1')
$compilerPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compilerPath)) { throw 'The .NET Framework 4.8 compiler is required.' }
$audioOutput = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Path $audioOutput -Force | Out-Null
$audioExecutable = Join-Path $audioOutput 'LivingLosSantos.AudioHost.exe'
$coreDll = Join-Path $PSScriptRoot 'vendor\naudio.core\lib\netstandard2.0\NAudio.Core.dll'
$wasapiDll = Join-Path $PSScriptRoot 'vendor\naudio.wasapi\lib\netstandard2.0\NAudio.Wasapi.dll'
$standardDll = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\netstandard.dll'
foreach ($dependency in @($coreDll,$wasapiDll,$standardDll)) { if (-not (Test-Path -LiteralPath $dependency)) { throw 'Pinned helper dependency is missing. See audio-host/DEPENDENCIES.md.' } }
Copy-Item -LiteralPath $coreDll,$wasapiDll -Destination $audioOutput -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'vendor\NAudio-LICENSE.txt') -Destination $audioOutput -Force
& $compilerPath /nologo /target:exe /platform:anycpu /optimize+ /warnaserror+ /reference:System.Web.Extensions.dll "/reference:$coreDll" "/reference:$wasapiDll" "/reference:$standardDll" "/out:$audioExecutable" (Join-Path $PSScriptRoot 'AudioPolicy.cs') (Join-Path $PSScriptRoot 'CaptureEngine.cs') (Join-Path $PSScriptRoot 'AudioHost.cs')
if ($LASTEXITCODE -ne 0) { throw 'Audio host compilation failed.' }
if ($SelfTest) {
    & $audioExecutable --self-test
    if ($LASTEXITCODE -ne 0) { throw 'Audio policy self-test failed.' }
}
Get-FileHash -LiteralPath $audioExecutable -Algorithm SHA256 | Select-Object Path, Hash
