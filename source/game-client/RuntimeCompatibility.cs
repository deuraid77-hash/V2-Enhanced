using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;

namespace LivingLosSantosV2
{
    public sealed class RuntimeCompatibility
    {
        public const string TestedExe="1.0.1158.16", TestedApi="3.9.0.0", TestedApiHash="1E4D0BC4D34D05A6038FC87EEDE492D3DC4265522DE473EC19CDF6746B5B0E48";
        public string GameFileVersion="unavailable", ApiVersion="unavailable", ApiHash="unavailable", Reason="Compatibility could not be established.";
        public bool Supported;
        public static bool Matches(string exe,string api,string hash) { return exe==TestedExe&&api==TestedApi&&String.Equals(hash,TestedApiHash,StringComparison.OrdinalIgnoreCase); }
        public static RuntimeCompatibility Inspect(string executable,string apiPath)
        {
            var result=new RuntimeCompatibility();
            try { result.GameFileVersion=FileVersionInfo.GetVersionInfo(executable).FileVersion; result.ApiVersion=System.Reflection.AssemblyName.GetAssemblyName(apiPath).Version.ToString(); using(var stream=File.OpenRead(apiPath)) using(var sha=SHA256.Create()) result.ApiHash=BitConverter.ToString(sha.ComputeHash(stream)).Replace("-",""); result.Supported=Matches(result.GameFileVersion,result.ApiVersion,result.ApiHash); result.Reason=result.Supported?null:"Untested executable or SHVDN SDK: risky features paused; diagnostics remain available."; } catch(Exception ex) { result.Reason="Compatibility inspection failed: "+ex.GetType().Name; }
            return result;
        }
        public object Snapshot(string sdkVersion) { return new {supported=Supported,gameFileVersion=GameFileVersion,sdkGameVersion=sdkVersion,apiAssemblyVersion=ApiVersion,apiSha256=ApiHash,reason=Reason}; }
    }
}
