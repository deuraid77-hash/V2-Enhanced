param()
$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
$framework = Split-Path -Parent $compiler
$output = Join-Path $PSScriptRoot 'build'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$executable = Join-Path $output 'OfflineTests.exe'
$arguments = @('/nologo','/target:exe','/optimize+','/warn:4',('/out:'+$executable),('/reference:'+(Join-Path $framework 'System.dll')),('/reference:'+(Join-Path $framework 'System.Core.dll')),('/reference:'+(Join-Path $framework 'System.Net.Http.dll')),('/reference:'+(Join-Path $framework 'System.Web.Extensions.dll')),(Join-Path $PSScriptRoot 'WorldPolicy.cs'),(Join-Path $PSScriptRoot 'test\WorldPolicyTests.cs'),(Join-Path $PSScriptRoot 'ResponsePolicy.cs'),(Join-Path $PSScriptRoot 'DashboardTransport.cs'),(Join-Path $PSScriptRoot 'test\OfflineTests.cs'))
& $compiler $arguments
if ($LASTEXITCODE -ne 0) { throw 'Offline test compile failed.' }
& $executable (Join-Path $output 'offline-tests.json')
if ($LASTEXITCODE -ne 0) { throw 'Enhanced client offline tests failed.' }

