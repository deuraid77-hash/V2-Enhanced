$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
$framework = Split-Path -Parent $compiler
$output = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$arguments = @('/nologo','/target:exe','/optimize+','/warn:4',('/out:'+(Join-Path $output 'Probe-Companion.exe')),('/reference:'+(Join-Path $framework 'System.dll')),('/reference:'+(Join-Path $framework 'System.Core.dll')),('/reference:'+(Join-Path $framework 'System.Net.Http.dll')),('/reference:'+(Join-Path $framework 'System.Web.Extensions.dll')),(Join-Path $PSScriptRoot 'ResponsePolicy.cs'),(Join-Path $PSScriptRoot 'DashboardTransport.cs'),(Join-Path $PSScriptRoot 'test\DashboardContractProbe.cs'))
& $compiler $arguments
if ($LASTEXITCODE -ne 0) { throw 'Dashboard contract probe compile failed.' }
