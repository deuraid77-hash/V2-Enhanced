using System;
using System.Collections.Generic;
using System.Linq;

namespace LivingLosSantosV2
{
    /// <summary>Pure voice-frame policy. No GTA types, so it runs in the offline test harness.</summary>
    public static class VoicePolicy
    {
        public const int MaxCues=4, MaxBarks=4, MaxSpeakers=8;
        public static readonly string[] BarkGroups={"casual","reaction","vehicle","hurt","combat","group"};
        public static string CueSource(string source)
        {
            string s=(source??"").ToLowerInvariant();
            return s.Contains("fallback")||s.Contains("offline")?"fallback":s.Contains("bank")||s.Contains("cache")?"bank":"gemini";
        }
        // First alphabetic word of the AI voiceTone; the companion maps unknown words to a neutral delivery.
        public static string Tone(string raw)
        {
            if(String.IsNullOrEmpty(raw))return "natural";
            var word=new string(raw.ToLowerInvariant().SkipWhile(c=>c<'a'||c>'z').TakeWhile(c=>c>='a'&&c<='z').Take(20).ToArray());
            return word.Length==0?"natural":word;
        }
        // Readable subtitle duration from line length, bounded to 2.5–9 s.
        public static int SubtitleMs(string text){return Math.Max(2500,Math.Min(9000,1500+(text??"").Length*60));}
        // Audio stops on hard pauses; typing a reply or using the reply wheel keeps the current line playing.
        public static bool StopsAudio(string pause){return pause!=null&&pause!="Dialogue keyboard open"&&pause!="Reply wheel open";}
        public static double IntervalMs(double hz){return 1000.0/Math.Max(10,Math.Min(20,hz));}
    }

    public sealed class VoiceFrameGate
    {
        private DateTime next=DateTime.MinValue, startedAt=DateTime.MinValue; private bool inFlight;
        public static readonly TimeSpan InFlightTimeout=TimeSpan.FromSeconds(3);
        public bool InFlight{get{return inFlight;}}
        public bool TryBegin(DateTime now,double hz)
        {
            if(inFlight&&now-startedAt<InFlightTimeout)return false;
            if(now<next)return false;
            inFlight=true;startedAt=now;next=now.AddMilliseconds(VoicePolicy.IntervalMs(hz));return true;
        }
        public void End(){inFlight=false;}
        public void Reset(){inFlight=false;next=DateTime.MinValue;}
    }

    /// <summary>Client-side bark admission: global spacing, per NPC+group spacing and density roll.</summary>
    public sealed class BarkGate
    {
        private readonly Dictionary<string,DateTime> last=new Dictionary<string,DateTime>();
        private DateTime lastAny=DateTime.MinValue;
        public static readonly TimeSpan GlobalSpacing=TimeSpan.FromSeconds(2.5), NpcSpacing=TimeSpan.FromSeconds(4);
        public bool Admit(string npcId,string group,DateTime now,double densityPercent,double roll)
        {
            if(String.IsNullOrEmpty(npcId)||Array.IndexOf(VoicePolicy.BarkGroups,group)<0)return false;
            if(now-lastAny<GlobalSpacing)return false;
            DateTime prior;string key=npcId+"|"+group;
            if(last.TryGetValue(key,out prior)&&now-prior<NpcSpacing)return false;
            if(roll*100>=Math.Max(0,Math.Min(100,densityPercent)))return false;
            if(last.Count>=256)last.Clear();
            last[key]=now;lastAny=now;return true;
        }
        public void Clear(){last.Clear();lastAny=DateTime.MinValue;}
    }
}
