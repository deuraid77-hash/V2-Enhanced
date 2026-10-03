$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
$framework = Split-Path -Parent $compiler
$output = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$arguments = @('/nologo','/target:exe','/optimize+','/warn:4',('/out:'+(Join-Path $output 'Probe-NativeMenu.exe')))
$arguments += @('System.dll','System.Core.dll','System.Net.Http.dll','System.Web.Extensions.dll') | ForEach-Object { '/reference:'+(Join-Path $framework $_) }
$arguments += @('WorldPolicy.cs','ResponsePolicy.cs','DashboardTransport.cs','FoundationPolicy.cs','MenuPolicy.cs','SettingsCatalog.Generated.cs','test\MenuContractProbe.cs') | ForEach-Object { Join-Path $PSScriptRoot $_ }
$arguments += Join-Path $PSScriptRoot 'ActionPolicy.cs'
& $compiler $arguments
if ($LASTEXITCODE -ne 0) { throw 'Native menu contract probe compile failed.' }
