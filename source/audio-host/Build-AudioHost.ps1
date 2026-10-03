param([switch]$SelfTest)
$ErrorActionPreference = 'Stop'
$compilerPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compilerPath)) { throw 'The .NET Framework 4.8 compiler is required.' }
$audioOutput = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Path $audioOutput -Force | Out-Null
$audioExecutable = Join-Path $audioOutput 'LivingLosSantos.AudioHost.exe'
& $compilerPath /nologo /target:exe /platform:anycpu /optimize+ /warnaserror+ /reference:System.Web.Extensions.dll "/out:$audioExecutable" (Join-Path $PSScriptRoot 'AudioPolicy.cs') (Join-Path $PSScriptRoot 'AudioHost.cs')
if ($LASTEXITCODE -ne 0) { throw 'Audio host compilation failed.' }
if ($SelfTest) {
    & $audioExecutable --self-test
    if ($LASTEXITCODE -ne 0) { throw 'Audio policy self-test failed.' }
}
Get-FileHash -LiteralPath $audioExecutable -Algorithm SHA256 | Select-Object Path, Hash
