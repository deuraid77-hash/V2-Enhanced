using System;
using System.Collections.Generic;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace LivingLosSantos.Audio
{
    // External helper: enumeration is read-only; capture starts only for an explicit
    // scoped held-input request. Playback remains unavailable until its own gate.
    public static class AudioHost
    {
        private const int MaxMessageCharacters = 262144;
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = MaxMessageCharacters, RecursionLimit = 16 };
        private static readonly Regex Identifier = new Regex("^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$", RegexOptions.CultureInvariant);

        public static int Main(string[] args)
        {
            Console.InputEncoding = new UTF8Encoding(false);
            Console.OutputEncoding = new UTF8Encoding(false);
            if (args.Length == 1 && args[0] == "--self-test") return SelfTest();
            if (args.Length != 0) return 2;
            using(var captureEngine=new CaptureEngine()) try {
                for (;;) {
                    string line = ReadBoundedLine();
                    if (line == null) return 0; // Companion stdin EOF ends helper lifecycle.
                    if (line.Length == 0) continue;
                    string id = "invalid", type = "invalid";
                    try {
                        var request = Json.DeserializeObject(line) as Dictionary<string, object>;
                        if (request == null) throw new InvalidOperationException();
                        id = Field(request, "requestId"); type = Field(request, "type");
                        if (!Identifier.IsMatch(id) || !Identifier.IsMatch(type)) throw new InvalidOperationException();
                        if (type == "capabilities") Reply(new { requestId=id, type=type, success=true, capabilities=new {
                            protocol=1, version="4.0.0-held-capture", playback=false, capture=true,
                            offlineSpeech=false, spatialMixing=false, stage="held-capture" } });
                        else if(type=="captureDevices") Reply(new{requestId=id,type=type,success=true,devices=captureEngine.Devices()});
                        else if(type=="captureFocus"){var r=Json.Deserialize<Dictionary<string,object>>(Json.Serialize(captureEngine.Focus(Field(request,"id"))));r["requestId"]=id;r["type"]=type;r["success"]=true;Reply(r);}
                        else if(type=="captureStart"){var r=Json.Deserialize<Dictionary<string,object>>(Json.Serialize(captureEngine.Start(Field(request,"id"),Field(request,"deviceId"),Convert.ToInt32(request["maxDurationMs"]),Convert.ToDouble(request["sensitivity"]))));r["requestId"]=id;r["type"]=type;r["success"]=true;Reply(r);}
                        else if(type=="captureLease"||type=="captureStop"||type=="captureChunk"){object value=type=="captureLease"?captureEngine.Lease(Field(request,"id"),Convert.ToInt32(request["sequence"])):type=="captureStop"?captureEngine.Stop(Field(request,"id")):captureEngine.Chunk(Field(request,"id"),Convert.ToInt32(request["sequence"]));var r=Json.Deserialize<Dictionary<string,object>>(Json.Serialize(value));r["requestId"]=id;r["type"]=type;r["success"]=true;Reply(r);}
                        else if(type=="captureCancel"){captureEngine.Cancel(Field(request,"id"));Reply(new{requestId=id,type=type,success=true});}
                        else if (type == "ping") Reply(new { requestId=id, type=type, success=true });
                        else if (type == "shutdown") { Reply(new { requestId=id, type=type, success=true }); return 0; }
                        else Reply(new { requestId=id, type=type, success=false, error="Audio device commands are unavailable in this build." });
                    } catch { Reply(new { requestId=Identifier.IsMatch(id) ? id : "invalid", type="error", success=false, error="Invalid audio command." }); }
                }
            } catch { return 3; } // No private payloads or spoken text in stderr.
        }
        private static string Field(Dictionary<string,object> obj, string key)
        { object value; return obj.TryGetValue(key,out value) && value is string ? (string)value : ""; }
        private static string ReadBoundedLine()
        {
            var text = new StringBuilder();
            for (;;) {
                int next = Console.Read();
                if (next < 0) return text.Length == 0 ? null : text.ToString();
                if (next == '\n') return text.ToString().TrimEnd('\r');
                if (text.Length >= MaxMessageCharacters) throw new InvalidOperationException("Message limit");
                text.Append((char)next);
            }
        }
        private static void Reply(object value) { Console.WriteLine(Json.Serialize(value)); Console.Out.Flush(); }
        private static int SelfTest()
        {
            int passed = 0;
            Action<bool> check = delegate(bool condition) { if (!condition) throw new InvalidOperationException("Policy test failed"); passed++; };
            try {
                var origin = new Point3(0,0,0); var right = new Point3(1,0,0);
                var center = AudioPolicy.Spatial(origin,right,new Point3(0,1,0),3,45,1.2,1,1);
                check(Math.Abs(center.Left-center.Right)<0.000001);
                check(Math.Abs(center.Left*center.Left+center.Right*center.Right-1)<0.000001);
                var left = AudioPolicy.Spatial(origin,right,new Point3(-1,0,0),3,45,1.2,1,1);
                check(left.Left==1 && left.Right==0);
                var rightGain = AudioPolicy.Spatial(origin,right,new Point3(1,0,0),3,45,1.2,1,1);
                check(rightGain.Left==0 && rightGain.Right==1);
                var distant = AudioPolicy.Spatial(origin,right,new Point3(0,30,0),3,45,1.2,1,1);
                check(distant.Left<center.Left);
                var outside = AudioPolicy.Spatial(origin,right,new Point3(0,45,0),3,45,1.2,1,1);
                check(outside.Left==0 && outside.Right==0);
                var mono = AudioPolicy.Spatial(origin,right,new Point3(-1,0,0),3,45,1.2,0,1);
                check(Math.Abs(mono.Left-mono.Right)<0.000001);
                check(AudioPolicy.Priority("conversation")>AudioPolicy.Priority("combat"));
                check(AudioPolicy.Priority("combat")>AudioPolicy.Priority("vehicle"));
                check(AudioPolicy.Priority("vehicle")>AudioPolicy.Priority("casual"));
                check(AudioPolicy.ScopeIsCurrent("r","s","r","s",1500,1000,500,false,true));
                check(!AudioPolicy.ScopeIsCurrent("r","s","r","s",1501,1000,500,false,true));
                check(!AudioPolicy.ScopeIsCurrent("r","s","new","s",1500,1000,500,false,true));
                check(!AudioPolicy.ScopeIsCurrent("r","s","r","new",1500,1000,500,false,true));
                check(!AudioPolicy.ScopeIsCurrent("r","s","r","s",1500,1000,500,true,true));
                check(!AudioPolicy.ScopeIsCurrent("r","s","r","s",1500,1000,500,false,false));
                check(!AudioPolicy.ScopeIsCurrent("r","s","r","s",999,1000,500,false,true));
                check(AudioPolicy.Clamp(Double.NaN,0,1)==0);
                passed+=CaptureEngine.SelfTest();
                Reply(new { success=true, stage="offline-policy-only", passed=passed, audioDevicesOpened=0 }); return 0;
            } catch { Reply(new { success=false, stage="offline-policy-only", passed=passed, audioDevicesOpened=0 }); return 1; }
        }
    }
}
