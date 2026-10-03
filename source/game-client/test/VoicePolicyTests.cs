using System;
using System.Threading;
using LivingLosSantosV2;

internal static class VoicePolicyTests
{
    private static void Assert(bool value){if(!value)throw new Exception("Voice assertion failed.");}
    public static void Run(Action<string,Action> check)
    {
        var t=new DateTime(2026,10,3,12,0,0,DateTimeKind.Utc);
        check("voice cue source mapping",delegate{Assert(VoicePolicy.CueSource("gemini")=="gemini"&&VoicePolicy.CueSource("Offline fallback")=="fallback"&&VoicePolicy.CueSource("cached AI")=="bank"&&VoicePolicy.CueSource(null)=="gemini");});
        check("voice tone first word",delegate{Assert(VoicePolicy.Tone("Angry, impatient")=="angry"&&VoicePolicy.Tone("  ...scared")=="scared"&&VoicePolicy.Tone(null)=="natural"&&VoicePolicy.Tone("123")=="natural");});
        check("subtitle duration bounds",delegate{Assert(VoicePolicy.SubtitleMs("")==2500&&VoicePolicy.SubtitleMs(new string('x',500))==9000&&VoicePolicy.SubtitleMs(new string('x',50))==4500);});
        check("hard pauses stop audio, reply input does not",delegate{Assert(VoicePolicy.StopsAudio("Game paused")&&VoicePolicy.StopsAudio("Loading")&&!VoicePolicy.StopsAudio(null)&&!VoicePolicy.StopsAudio("Dialogue keyboard open")&&!VoicePolicy.StopsAudio("Reply wheel open"));});
        check("frame rate clamped to 10-20 Hz",delegate{Assert(VoicePolicy.IntervalMs(5)==100&&VoicePolicy.IntervalMs(40)==50);});
        check("one voice frame in flight, rate bounded, stuck request expires",delegate{var gate=new VoiceFrameGate();Assert(gate.TryBegin(t,10)&&!gate.TryBegin(t.AddMilliseconds(200),10));gate.End();Assert(!gate.TryBegin(t.AddMilliseconds(50),10)&&gate.TryBegin(t.AddMilliseconds(100),10));Assert(gate.TryBegin(t.AddSeconds(4),10));});
        check("bark global and per-NPC spacing",delegate{var bark=new BarkGate();Assert(bark.Admit("n1","combat",t,100,0.5)&&!bark.Admit("n2","combat",t.AddSeconds(1),100,0));Assert(!bark.Admit("n1","combat",t.AddSeconds(3),100,0)&&bark.Admit("n1","hurt",t.AddSeconds(3),100,0));});
        check("bark density and group validation",delegate{var bark=new BarkGate();Assert(!bark.Admit("n3","combat",t,20,0.5)&&bark.Admit("n3","combat",t,20,0.1));Assert(!bark.Admit("n4","opera",t.AddSeconds(20),100,0)&&!bark.Admit("","combat",t.AddSeconds(20),100,0));});
        check("transport admits only the voice frame route",delegate{using(var tr=new DashboardTransport("http://127.0.0.1:9/"))using(var c=new CancellationTokenSource()){c.Cancel();bool routeRejected=false;try{tr.PostAsync("api/audio/frame","{}",c.Token).GetAwaiter().GetResult();}catch(ArgumentException){routeRejected=true;}catch(Exception){}Assert(!routeRejected);routeRejected=false;try{tr.PostAsync("api/audio/other","{}",c.Token).GetAwaiter().GetResult();}catch(ArgumentException){routeRejected=true;}catch(Exception){}Assert(routeRejected);}});
    }
}
