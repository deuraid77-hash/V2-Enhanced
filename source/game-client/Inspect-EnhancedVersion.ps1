param(
    [string]$GameRoot='C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced',
    [string]$CecilPath='C:\Users\username\Documents\GTA ChatGPT Integration\rage-hook-stage\Mono.Cecil.dll'
)
# Read-only IL evidence. No executable launch, native call, game-memory read, or file modification.
$ErrorActionPreference='Stop'
Add-Type -Path $CecilPath
$api=[Mono.Cecil.AssemblyDefinition]::ReadAssembly((Join-Path $GameRoot 'ScriptHookVDotNet3.dll'))
$runtime=[Mono.Cecil.AssemblyDefinition]::ReadAssembly((Join-Path $GameRoot 'ScriptHookVDotNet.asi'))
try {
    $getter=($api.MainModule.Types | Where-Object FullName -EQ 'GTA.Game').Methods | Where-Object Name -EQ 'get_FileVersion'
    $initializer=($runtime.MainModule.Types | Where-Object FullName -EQ 'SHVDN.NativeMemory').Methods | Where-Object Name -EQ '.cctor'
    [ordered]@{
        Evidence='VERIFIED static IL; not a new in-game measurement'
        ExecutableFileVersion=(Get-Item -LiteralPath (Join-Path $GameRoot 'GTA5_Enhanced.exe')).VersionInfo.FileVersion
        ApiFileVersionGetter=@($getter.Body.Instructions | ForEach-Object ToString)
        EnhancedVersionInitialization=@($initializer.Body.Instructions | Where-Object {$_.Offset -ge 0x176 -and $_.Offset -le 0x1C4} | ForEach-Object ToString)
        Explanation='Installed Enhanced runtime adds one to executable version Major before exposing GTA.Game.FileVersion. Client reports both actual executable and normalized SDK versions.'
    } | ConvertTo-Json -Depth 5
} finally {
    if($api -is [IDisposable]){$api.Dispose()}
    if($runtime -is [IDisposable]){$runtime.Dispose()}
}
