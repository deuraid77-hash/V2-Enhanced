using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;

namespace LivingLosSantosV2
{
    // No GTA references: identity, replay, mind and input rules have executable offline fixtures.
    public sealed class NpcMind
    {
        public int Fear=20, Aggression=30, Morale=70, Trust=50, Respect=50;
        public string Mood="neutral", Summary="", VoiceTone="", Quirk="", InternalThought="";
        public int Revision;
        public Dictionary<string,object> Snapshot()
        { return new Dictionary<string,object>{{"fear",Fear},{"aggression",Aggression},{"morale",Morale},{"trust",Trust},{"respect",Respect},{"mood",Mood},{"revision",Revision}}; }
        public void Apply(Dictionary<string,object> delta)
        {
            // Parse every field before mutation, so a malformed final result cannot half-apply.
            int fear=Delta(delta,"fear",40), aggression=Delta(delta,"aggression",40), morale=Delta(delta,"morale",40), trust=Delta(delta,"trust",20), respect=Delta(delta,"respect",20);
            object raw; string mood=delta.TryGetValue("mood",out raw)?ResponsePolicy.CleanText(RequireString(raw),40):Mood;
            if(String.IsNullOrWhiteSpace(mood)) throw new InvalidOperationException("Mood is empty after sanitization.");
            Fear=Clamp(Fear+fear,0,100); Aggression=Clamp(Aggression+aggression,0,100); Morale=Clamp(Morale+morale,0,100); Trust=Clamp(Trust+trust,0,100); Respect=Clamp(Respect+respect,0,100); Mood=mood; Revision++;
        }
        public static string RequireString(object value) { if(!(value is string)) throw new InvalidOperationException("Expected bounded text."); return (string)value; }
        public static int Delta(Dictionary<string,object> map,string key,int limit)
        { object value; if(!map.TryGetValue(key,out value)) return 0; double n=Number(value); if(n!=Math.Truncate(n)) throw new InvalidOperationException("Mind deltas must be integers."); return Clamp((int)Math.Max(-100000,Math.Min(100000,n)),-limit,limit); }
        public static double Number(object value)
        { if(!(value is int)&&!(value is long)&&!(value is double)&&!(value is decimal)&&!(value is float)) throw new InvalidOperationException("Expected a finite number."); double n=Convert.ToDouble(value,CultureInfo.InvariantCulture); if(Double.IsNaN(n)||Double.IsInfinity(n)) throw new InvalidOperationException("Expected a finite number."); return n; }
        public static int Clamp(int value,int low,int high) { return Math.Max(low,Math.Min(high,value)); }
    }
    public sealed class AiUpdateGate
    {
        private readonly Dictionary<string,DateTime> consumed=new Dictionary<string,DateTime>();
        public bool TryClaim(Dictionary<string,object> update,string runtime,string epoch,DateTime now,out string error)
        {
            error=null;
            try {
                string id=Wire.Text(update,"id",128);
                if(consumed.ContainsKey(id)) return false;
                if(Wire.Text(update,"runtimeId",128)!=runtime||Wire.Text(update,"sceneEpoch",128)!=epoch) { error="AI result belongs to an old scene or session."; return false; }
                DateTime expiry=Wire.Timestamp(update,"expiresAt");
                if(expiry<=now||expiry>now.AddSeconds(60)) { error="AI result expired or has an invalid lifetime."; return false; }
                foreach(string expired in consumed.Where(x=>now-x.Value>TimeSpan.FromMinutes(10)).Select(x=>x.Key).ToArray()) consumed.Remove(expired);
                if(consumed.Count>=1024) consumed.Remove(consumed.OrderBy(x=>x.Value).First().Key);
                consumed.Add(id,now); return true;
            } catch(InvalidOperationException ex) { error=ex.Message; return false; }
        }
        public static bool EntityAllowed(int expectedHandle,int expectedModel,int actualHandle,int actualModel,bool exists,bool alive,bool human,bool protectedEntity,bool vehicle,double distance,double maxDistance)
        { return exists&&alive&&human&&!protectedEntity&&!vehicle&&expectedHandle==actualHandle&&expectedModel==actualModel&&!Double.IsNaN(distance)&&!Double.IsInfinity(distance)&&distance>=0&&distance<=maxDistance; }
    }
    public static class WorkingHistory
    {
        public static Dictionary<string,object>[] Snapshot(IEnumerable<Dictionary<string,object>> history)
        {
            var tail=history.Reverse().Take(12).Reverse();
            return tail.Select(entry=> {
                string role=Wire.Text(entry,"role",8);
                if(role!="player"&&role!="npc") throw new InvalidOperationException("Invalid conversation history role.");
                string text=ResponsePolicy.CleanText(NpcMind.RequireString(Wire.Value(entry,"text")),400);
                if(text.Length==0) throw new InvalidOperationException("Empty conversation history text.");
                return new Dictionary<string,object>{{"role",role},{"text",text}};
            }).ToArray();
        }
    }
    public sealed class HoldGate
    {
        private bool wasPressed,fired; private long started;
        public bool Poll(bool pressed,long now,int holdMs)
        { if(!pressed) { wasPressed=false; fired=false; return false; } if(!wasPressed) { started=now; wasPressed=true; } if(fired||now-started<holdMs) return false; fired=true; return true; }
        public void Reset() { wasPressed=false; fired=false; }
    }
    public sealed class TickMetrics
    {
        private readonly Stopwatch timer=new Stopwatch(); private readonly double[] samples=new double[240]; private int index,count;
        public int Deferred; public double LastMs,MaxMs,DirectorMs,GameFrameMs; private double lastDirectorMs;
        public void Begin() { timer.Restart(); }
        public bool HasBudget(double budgetMs) { return timer.Elapsed.TotalMilliseconds<budgetMs; }
        public void End() { timer.Stop(); LastMs=timer.Elapsed.TotalMilliseconds; lastDirectorMs=DirectorMs; MaxMs=Math.Max(MaxMs,LastMs); samples[index++%samples.Length]=LastMs; count=Math.Min(count+1,samples.Length); }
        public object Snapshot() { var sorted=samples.Take(count).OrderBy(x=>x).ToArray(); return new {lastMs=Math.Round(LastMs,3),maxMs=Math.Round(MaxMs,3),p95Ms=count==0?0:Math.Round(sorted[(int)((count-1)*0.95)],3),sampleCount=count,deferred=Deferred,directorMs=Math.Round(lastDirectorMs,3),npcAndTransportMs=Math.Round(Math.Max(0,LastMs-lastDirectorMs),3),gameFrameMs=Math.Round(GameFrameMs,3)}; }
    }
    public sealed class NpcSettingsState
    {
        private Dictionary<string,object> values=SettingsCatalog.Defaults();
        public int Revision=-1;
        public bool Apply(int revision,Dictionary<string,object> settings)
        { if(revision<0) throw new InvalidOperationException("Invalid settings revision."); if(revision<=Revision) return false; var valid=SettingsCatalog.Validate(settings); if(valid.Count!=SettingsCatalog.All.Length) throw new InvalidOperationException("Incomplete NPC settings snapshot."); values=valid; Revision=revision; return true; }
        public bool Flag(string key) { object value; return values.TryGetValue(key,out value)&&value is bool&&(bool)value; }
        public double Number(string key) { object value; return values.TryGetValue(key,out value)?NpcMind.Number(value):0; }
        public string Text(string key) { object value; return values.TryGetValue(key,out value)?Convert.ToString(value,CultureInfo.InvariantCulture):""; }
        public object Snapshot() { return new Dictionary<string,object>(values); }
    }
    public static class InputLabels
    {
        public static string Button(int control,bool playstation)
        {
            if(control==0||control==217||control==236||control==244) return playstation?"Touchpad":"View";
            if(control==44||control==206||control==227) return playstation?"R1":"RB";
            if(control==37||control==205||control==226) return playstation?"L1":"LB";
            if(control==26||control==79||control==210||control==231) return "R3";
            if(control==28||control==36||control==86||control==209||control==230) return "L3";
            if(control==46||control==51||control==54||control==175||control==235) return "D-pad Right";
            if(control==47||control==52||control==58||control==174||control==234) return "D-pad Left";
            if(control==27||control==172||control==232) return "D-pad Up";
            if(control==19||control==173||control==233) return "D-pad Down";
            if(control==176||control==201||control==223) return playstation?"Cross":"A";
            if(control==177||control==202||control==225) return playstation?"Circle":"B";
            if(control==203||control==224) return playstation?"Square":"X";
            if(control==204||control==222) return playstation?"Triangle":"Y";
            if(control==228)return playstation?"L2":"LT";
            if(control==229)return playstation?"R2":"RT";
            return "Game control "+control;
        }
    }
}
