param([string]$GameRoot = 'C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced')
$ErrorActionPreference = 'Stop'
$clientRoot = $PSScriptRoot
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
$framework = Split-Path -Parent $compiler
$api = Join-Path $GameRoot 'ScriptHookVDotNet3.dll'
if (!(Test-Path -LiteralPath $compiler)) { throw 'The .NET Framework compiler is missing. Use MSBuild with the supplied project and .NET Framework 4.8 targeting pack.' }
if (!(Test-Path -LiteralPath $api)) { throw 'Set GameRoot to a GTA V Enhanced install containing its Enhanced ScriptHookVDotNet3.dll.' }
$output = Join-Path $clientRoot 'bin'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$arguments = @('/nologo','/target:library','/platform:anycpu','/optimize+','/warn:4',('/out:'+(Join-Path $output 'LivingLSAIsV2.Enhanced.dll')),('/reference:'+$api),('/reference:'+(Join-Path $framework 'System.dll')),('/reference:'+(Join-Path $framework 'System.Core.dll')),('/reference:'+(Join-Path $framework 'System.Windows.Forms.dll')),('/reference:'+(Join-Path $framework 'System.Net.Http.dll')),('/reference:'+(Join-Path $framework 'System.Web.Extensions.dll')),(Join-Path $clientRoot 'WorldPolicy.cs'),(Join-Path $clientRoot 'WorldDirector.cs'),(Join-Path $clientRoot 'ResponsePolicy.cs'),(Join-Path $clientRoot 'DashboardTransport.cs'),(Join-Path $clientRoot 'LivingLSAIsV2.Enhanced.cs'))
$arguments += @('SettingsCatalog.Generated.cs','FoundationPolicy.cs','RuntimeCompatibility.cs','InputRouter.cs','MenuPolicy.cs','NativeMenu.cs','MenuBridge.cs') | ForEach-Object { Join-Path $clientRoot $_ }
$arguments += '/reference:'+(Join-Path $framework 'System.Drawing.dll')
& $compiler $arguments
if ($LASTEXITCODE -ne 0) { throw 'Enhanced client compile failed.' }
Get-FileHash -LiteralPath (Join-Path $output 'LivingLSAIsV2.Enhanced.dll') -Algorithm SHA256

