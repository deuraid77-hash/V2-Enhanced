param(
    [string]$GameRoot = 'C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced',
    [string]$CecilPath = 'C:\Users\username\Documents\GTA ChatGPT Integration\rage-hook-stage\Mono.Cecil.dll'
)
$ErrorActionPreference = 'Stop'
Add-Type -Path $CecilPath
$resolver = New-Object Mono.Cecil.DefaultAssemblyResolver
$resolver.AddSearchDirectory($GameRoot)
$resolver.AddSearchDirectory((Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319'))
$parameters = New-Object Mono.Cecil.ReaderParameters
$parameters.AssemblyResolver = $resolver
$clientPath = Join-Path $PSScriptRoot 'bin\LivingLSAIsV2.Enhanced.dll'
$apiPath = Join-Path $GameRoot 'ScriptHookVDotNet3.dll'
$client = [Mono.Cecil.AssemblyDefinition]::ReadAssembly($clientPath, $parameters)
$api = [Mono.Cecil.AssemblyDefinition]::ReadAssembly($apiPath, $parameters)
$references = @($client.MainModule.GetMemberReferences() | Where-Object { $_.DeclaringType.Scope.Name -eq 'ScriptHookVDotNet3' } | ForEach-Object {
    $resolved = $false
    try { $resolved = $null -ne $_.Resolve() } catch { }
    [PSCustomObject]@{ Member = $_.FullName; Resolved = $resolved }
})
$sourcePaths = @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.cs' -File | Select-Object -ExpandProperty FullName)
$sourceText = ($sourcePaths | ForEach-Object { Get-Content -LiteralPath $_ -Raw }) -join "`n"
$nativeNames = @([regex]::Matches($sourceText,'(?<![\w])Hash\.([A-Z][A-Z0-9_]+)') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
$nativeFields = ($api.MainModule.Types | Where-Object FullName -EQ 'GTA.Native.Hash').Fields
$nativeChecks = @($nativeNames | ForEach-Object { $name = $_; $field = $nativeFields | Where-Object Name -EQ $name; [PSCustomObject]@{Name=$name;Present=$null -ne $field;Hash=if($field){'0x{0:X16}' -f $field.Constant}else{$null}} })
$offline = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'build\offline-tests.json') -Raw | ConvertFrom-Json
$sources = @($sourceText)
$customMemoryOrPInvoke = [bool](($sources -join "`n") -match 'DllImport|Marshal\.|unsafe\s|MemoryAddress|MemoryAccess|FindPattern|ReadProcessMemory|WriteProcessMemory')
$files = @('LivingLSAIsV2.Enhanced.cs','WorldDirector.cs','WorldPolicy.cs','ResponsePolicy.cs','DashboardTransport.cs','LivingLSAIsV2.Enhanced.csproj','Build-EnhancedClient.ps1','Test-EnhancedClient.ps1','Build-WorldProbe.ps1','test\OfflineTests.cs','test\WorldPolicyTests.cs','test\WorldContractProbe.cs','test\DashboardContractProbe.cs','bin\LivingLSAIsV2.Enhanced.dll') | ForEach-Object { $file=Join-Path $PSScriptRoot $_; [PSCustomObject]@{Path=$_;SHA256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash;Bytes=(Get-Item -LiteralPath $file).Length} }
$result = [ordered]@{
    CheckedAtUTC=[DateTime]::UtcNow.ToString('o')
    GameFileVersion=(Get-Item -LiteralPath (Join-Path $GameRoot 'GTA5_Enhanced.exe')).VersionInfo.FileVersion
    ApiAssemblyVersion=$api.Name.Version.ToString()
    ApiFileVersion=(Get-Item -LiteralPath $apiPath).VersionInfo.FileVersion
    ApiSHA256=(Get-FileHash -LiteralPath $apiPath -Algorithm SHA256).Hash
    ClientAssemblyVersion=$client.Name.Version.ToString()
    TargetFramework='.NET Framework 4.8'
    Compiler=(Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
    ModuleArchitecture=$client.MainModule.Architecture.ToString()
    ModuleAttributes=$client.MainModule.Attributes.ToString()
    ApiMemberReferences=$references.Count
    ResolvedApiMemberReferences=@($references | Where-Object Resolved).Count
    UnresolvedApiMemberReferences=@($references | Where-Object { !$_.Resolved })
    NativeGuardsAndTaskHashes=$nativeChecks
    CustomMemoryOrPInvokeDetected=$customMemoryOrPInvoke
    OfflineTests=[ordered]@{Total=$offline.total;Passed=$offline.passed;Failed=$offline.failed}
    OnlineGuardImplemented=$true
    GameExecuted=$false
    LiveNpcActionsVerified=$false
    Files=$files
    MemberReferences=$references
}
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'build\verification.json') -Encoding UTF8
if ($client -is [IDisposable]) { $client.Dispose() }
if ($api -is [IDisposable]) { $api.Dispose() }
if ($resolver -is [IDisposable]) { $resolver.Dispose() }
if ($result.UnresolvedApiMemberReferences.Count -gt 0 -or @($nativeChecks | Where-Object {!$_.Present}).Count -gt 0 -or $customMemoryOrPInvoke -or $offline.failed -ne 0) { throw 'Enhanced compatibility audit failed.' }
[PSCustomObject]@{GameFileVersion=$result.GameFileVersion;ApiVersion=$result.ApiAssemblyVersion;ApiMemberReferences=$result.ApiMemberReferences;Resolved=$result.ResolvedApiMemberReferences;NativeNamesPresent=$nativeChecks.Count;OfflineTestsPassed=$offline.passed;GameExecuted=$false} | ConvertTo-Json
