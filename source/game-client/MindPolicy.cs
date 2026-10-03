using System;
using System.Collections.Generic;
using System.Linq;

namespace LivingLosSantosV2
{
    public sealed class MindHydration
    {
        public string MindId,StoreEpoch,Summary,Recognition;public int Revision,Handle,Model;public bool Notable,Cached,HydrateMind;public double Confidence;public Dictionary<string,object> Persona;public Dictionary<string,object>[] Episodes;public NpcMind Mind;
        public static NpcMind ParseMind(Dictionary<string,object> value){return new NpcMind{Fear=Wire.Integer(value,"fear",0,100),Aggression=Wire.Integer(value,"aggression",0,100),Morale=Wire.Integer(value,"morale",0,100),Trust=Wire.Integer(value,"trust",0,100),Respect=Wire.Integer(value,"respect",0,100),Mood=ResponsePolicy.CleanText(Wire.Text(value,"mood",40),40),Revision=Wire.Integer(value,"revision",0,Int32.MaxValue)};}
        public static MindHydration Parse(Dictionary<string,object> value)
        {
            var r=new MindHydration{MindId=Wire.Text(value,"mindId",128),Revision=Wire.Integer(value,"revision",0,Int32.MaxValue),Handle=Wire.Integer(value,"expectedHandle",1,Int32.MaxValue),Model=Wire.Integer(value,"expectedModelHash",Int32.MinValue,Int32.MaxValue),Notable=Wire.Boolean(value,"notable"),Cached=Wire.Boolean(value,"cached"),Mind=ParseMind(Wire.Map(Wire.Value(value,"mind")))};
            r.StoreEpoch=value.ContainsKey("storeEpoch")?Wire.Text(value,"storeEpoch",128):"0";Epoch(r.StoreEpoch);r.HydrateMind=value.ContainsKey("hydrateMind")&&Wire.Boolean(value,"hydrateMind");var recognition=Wire.Map(Wire.Value(value,"recognition"));r.Recognition=Wire.Text(recognition,"status",32);if(!new[]{"new","session","best-effort","ambiguous"}.Contains(r.Recognition))throw new InvalidOperationException("Unknown recognition state.");r.Confidence=NpcMind.Number(Wire.Value(recognition,"confidence"));if(r.Confidence<0||r.Confidence>1)throw new InvalidOperationException("Recognition confidence out of range.");
            r.Summary=ResponsePolicy.CleanText(value.ContainsKey("summary")?value["summary"]:"",1200);r.Episodes=Wire.Maps(Wire.Value(value,"episodes")).Take(65).ToArray();if(r.Episodes.Length>64)throw new InvalidOperationException("Episode count exceeded.");
            if(value.ContainsKey("persona")&&value["persona"]!=null){var p=Wire.Map(value["persona"]);Wire.Text(p,"name",80);Wire.Integer(p,"age",18,90);foreach(string key in new[]{"job","backstory","speechStyle","goal","fear","secret"})Wire.Text(p,key,400);var quirks=((System.Collections.IEnumerable)Wire.Value(p,"quirks")).Cast<object>().Take(4).ToArray();if(quirks.Length!=3||quirks.Any(q=>!(q is string)||((string)q).Length>160))throw new InvalidOperationException("Invalid persona quirks.");var voice=Wire.Map(Wire.Value(p,"voiceCasting"));if(!new[]{"masculine","feminine","neutral"}.Contains(Wire.Text(voice,"gender",16))||!new[]{"young-adult","adult","older"}.Contains(Wire.Text(voice,"ageBand",16)))throw new InvalidOperationException("Invalid persona voice category.");Wire.Text(voice,"accent",80);foreach(string k in new[]{"pitch","speed"}){double n=NpcMind.Number(Wire.Value(voice,k));if(n<.8||n>1.2)throw new InvalidOperationException("Invalid persona voice range.");}r.Persona=new Dictionary<string,object>(p);}
            return r;
        }
        public void ApplyTo(NpcMind target,bool reset){if(!HydrateMind||!reset&&Mind.Revision<target.Revision)return;target.Fear=Mind.Fear;target.Aggression=Mind.Aggression;target.Morale=Mind.Morale;target.Trust=Mind.Trust;target.Respect=Mind.Respect;target.Mood=Mind.Mood;target.Revision=Mind.Revision;target.Summary=Summary;}
        public static long Epoch(string value){long epoch;if(!Int64.TryParse(value,out epoch)||epoch<0)throw new InvalidOperationException("Invalid memory store epoch.");return epoch;}
    }
    public static class ReputationPolicy
    {
        public static Dictionary<string,int> Parse(Dictionary<string,object> values){if(values.Count>128)throw new InvalidOperationException("Reputation map exceeded.");return values.ToDictionary(p=>{if(String.IsNullOrWhiteSpace(p.Key)||p.Key.Length>80)throw new InvalidOperationException("Invalid reputation key.");return p.Key;},p=>{double n=NpcMind.Number(p.Value);if(n!=Math.Truncate(n)||n< -100||n>100)throw new InvalidOperationException("Invalid reputation value.");return (int)n;});}
    }
}
