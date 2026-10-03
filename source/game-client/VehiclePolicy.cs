using System;
using System.Collections.Generic;
using System.Linq;

namespace LivingLosSantosV2
{
    // Step 4 pure policy. No GTA types here so the offline test build can exercise it.
    // Detection only classifies facts the game already observed; it never spawns,
    // warps or edits entities. The companion chooses whether to act on an opportunity.
    public static class VehiclePolicy
    {
        public static readonly string[] Scenarios={"windowTalk","carToCar","passengerChat","lifts","roadRage","carjack","pedestrianImpact","trafficStop","driveBy","breakdown"};
        public sealed class Facts
        {
            public bool PlayerInVehicle,NpcInVehicle,NpcIsDriver,SharesPlayerVehicle,Contact,PlayerJacking,NpcBeingJacked,HitByPlayerVehicle,NpcIsCop,NpcGang,VehicleBroken,PlayerSeatFree,NpcProtected,VehicleProtected,NpcInCombat;
            public float PlayerSpeed,NpcSpeed,Distance;public int Wanted;
        }
        public static bool Known(string scenario){return Scenarios.Contains(scenario);}
        // Highest-stakes observation wins. Returns null when nothing applies or the
        // NPC/vehicle belongs to another script (mission protection).
        public static string Classify(Facts f,double windowMeters,double chatSpeed,double maxDistance)
        {
            if(f==null||f.NpcProtected||f.NpcInCombat||Double.IsNaN(f.Distance)||f.Distance<0||f.Distance>maxDistance)return null;
            if(f.PlayerJacking&&f.NpcBeingJacked&&f.Distance<=10)return "carjack";
            if(!f.NpcInVehicle&&f.HitByPlayerVehicle&&f.Distance<=20)return "pedestrianImpact";
            if(f.SharesPlayerVehicle)return "passengerChat";
            if(f.VehicleProtected)return null;
            if(f.PlayerInVehicle&&f.NpcInVehicle&&f.NpcIsDriver&&f.Contact&&f.Distance<=15)return "roadRage";
            if(f.NpcIsCop&&f.Wanted==1&&f.Distance<=12&&(!f.NpcInVehicle||f.NpcSpeed<2))return "trafficStop";
            if(f.NpcGang&&f.NpcInVehicle&&f.NpcSpeed<=8&&f.Distance<=25)return "driveBy";
            if(f.VehicleBroken&&f.NpcSpeed<1&&f.Distance<=12)return "breakdown";
            if(f.PlayerInVehicle&&f.PlayerSpeed<=1&&f.PlayerSeatFree&&!f.NpcInVehicle&&f.Distance<=8)return "lifts";
            if(f.PlayerInVehicle&&f.NpcInVehicle&&f.NpcIsDriver&&f.PlayerSpeed<=chatSpeed&&f.NpcSpeed<=chatSpeed&&f.Distance<=6)return "carToCar";
            if(!f.PlayerInVehicle&&f.NpcInVehicle&&f.NpcSpeed<1&&f.Distance<=windowMeters)return "windowTalk";
            return null;
        }
    }

    // Bounded opportunity bookkeeping: per-scenario and per-NPC cooldowns, a TTL,
    // and a hard cap that matches the companion validator (4).
    public sealed class ScenarioGate
    {
        public const int MaxOpen=4;
        // Ttl bounds how long an opportunity is advertised; PlanWindow bounds how long a
        // delivered plan may still claim it (AI latency + exchange cadence). One claim per ID.
        public static readonly TimeSpan ScenarioCooldown=TimeSpan.FromSeconds(45),NpcCooldown=TimeSpan.FromSeconds(120),Ttl=TimeSpan.FromSeconds(10),PlanWindow=TimeSpan.FromSeconds(60);
        private readonly Dictionary<string,DateTime> scenarioAt=new Dictionary<string,DateTime>(),npcAt=new Dictionary<string,DateTime>();
        private readonly Dictionary<string,Opportunity> offered=new Dictionary<string,Opportunity>();
        private readonly List<Opportunity> open=new List<Opportunity>();
        public sealed class Opportunity{public string Id,Scenario,NpcId;public DateTime At;}
        public IList<Opportunity> Open{get{return open.AsReadOnly();}}
        public Opportunity Offer(string scenario,string npcId,DateTime now)
        {
            Expire(now);
            if(!VehiclePolicy.Known(scenario)||String.IsNullOrEmpty(npcId)||open.Count>=MaxOpen)return null;
            DateTime prior;
            if(scenarioAt.TryGetValue(scenario,out prior)&&now-prior<ScenarioCooldown)return null;
            if(npcAt.TryGetValue(npcId,out prior)&&now-prior<NpcCooldown)return null;
            if(open.Any(o=>o.NpcId==npcId))return null;
            var item=new Opportunity{Id=Guid.NewGuid().ToString(),Scenario=scenario,NpcId=npcId,At=now};
            open.Add(item);offered[item.Id]=item;scenarioAt[scenario]=now;npcAt[npcId]=now;
            if(npcAt.Count>256)foreach(var k in npcAt.Where(x=>now-x.Value>NpcCooldown).Select(x=>x.Key).ToArray())npcAt.Remove(k);
            return item;
        }
        public void Expire(DateTime now){open.RemoveAll(o=>now-o.At>Ttl);foreach(var k in offered.Where(x=>now-x.Value.At>PlanWindow).Select(x=>x.Key).ToArray())offered.Remove(k);}
        // Returns the offered opportunity once; a replayed or stale ID returns null.
        public Opportunity Consume(string id,DateTime now)
        {
            Expire(now);Opportunity item;
            if(id==null||!offered.TryGetValue(id,out item))return null;
            offered.Remove(id);open.RemoveAll(o=>o.Id==id);return item;
        }
        public bool Offered(string id){return id!=null&&offered.ContainsKey(id);}
        public void Clear(){open.Clear();offered.Clear();}
    }

    public sealed class ScenarioBeat{public string NpcId,Speech,Tone,ActionType;public int Handle,Model;public Dictionary<string,object> Action;}
    public static class ScenarioPlanPolicy
    {
        public const int MaxBeats=4,MaxSpeech=240;
        // Validates the whole plan before anything runs; a single bad beat rejects all.
        public static List<ScenarioBeat> Parse(Dictionary<string,object> payload,string jobId,string runtimeId,string sceneEpoch,DateTime now)
        {
            string scenario=Wire.Text(payload,"scenario",32);if(!VehiclePolicy.Known(scenario))throw new InvalidOperationException("Unknown vehicle scenario.");
            var raw=Wire.Maps(Wire.Value(payload,"beats")).Take(MaxBeats+1).ToArray();
            if(raw.Length<1||raw.Length>MaxBeats)throw new InvalidOperationException("Scenario beat count is outside its bound.");
            var beats=new List<ScenarioBeat>();
            foreach(var b in raw)
            {
                string npcId=Wire.Text(b,"npcId",128),speech=ResponsePolicy.CleanText(Wire.Text(b,"speech",800),MaxSpeech);
                if(speech.Length==0)throw new InvalidOperationException("Scenario speech is empty after sanitization.");
                var action=Wire.Map(Wire.Value(b,"action"));string type=Wire.Text(action,"type",40);
                if(!ActionPolicy.Known(type))throw new InvalidOperationException("Scenario selected an unknown action.");
                int handle=Wire.Integer(b,"expectedHandle",1,Int32.MaxValue),model=Wire.Integer(b,"expectedModelHash",Int32.MinValue,Int32.MaxValue);
                if(Wire.Text(action,"jobId",128)!=jobId||Wire.Text(action,"runtimeId",128)!=runtimeId||Wire.Text(action,"sceneEpoch",128)!=sceneEpoch||Wire.Text(action,"npcId",128)!=npcId||Wire.Integer(action,"expectedHandle",1,Int32.MaxValue)!=handle||Wire.Integer(action,"expectedModelHash",Int32.MinValue,Int32.MaxValue)!=model||Wire.Timestamp(action,"expiresAt")<=now)
                    throw new InvalidOperationException("Scenario action identity or expiry mismatch.");
                Wire.Text(action,"actionId",128);
                beats.Add(new ScenarioBeat{NpcId=npcId,Speech=speech,Tone=ResponsePolicy.CleanText(b.ContainsKey("voiceTone")?b["voiceTone"]:null,40),ActionType=type,Handle=handle,Model=model,Action=action});
            }
            return beats;
        }
        public static void Bind(Dictionary<string,object> payload,ScenarioGate.Opportunity opportunity,IEnumerable<ScenarioBeat> beats)
        {
            if(opportunity==null)throw new InvalidOperationException("Scenario opportunity is unknown, stale or already used.");
            if(Wire.Text(payload,"opportunityId",64)!=opportunity.Id||Wire.Text(payload,"scenario",32)!=opportunity.Scenario)throw new InvalidOperationException("Scenario plan does not match the offered opportunity.");
            if(beats.Any(b=>b.NpcId!=opportunity.NpcId))throw new InvalidOperationException("Scenario beat speaker was not offered.");
        }
    }
}
