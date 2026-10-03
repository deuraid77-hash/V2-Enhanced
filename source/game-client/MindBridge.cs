using System;
using System.Collections.Generic;
using System.Linq;
using GTA;
using GTA.Math;

namespace LivingLosSantosV2
{
    public sealed partial class EnhancedClient
    {
        private sealed class NotableLease{public Ped Ped;public int Handle,Model;public DateTime Since;}
        private readonly List<NotableLease> notables=new List<NotableLease>();
        private readonly List<Dictionary<string,object>> mindOutcomes=new List<Dictionary<string,object>>(),witnessedEvents=new List<Dictionary<string,object>>();
        private readonly Dictionary<string,DateTime> witnessedCooldown=new Dictionary<string,DateTime>();
        private int appliedReputationRevision,appliedMemoryRevision;
        private DateTime recentPlayerCrime=DateTime.MinValue,nextMindTick=DateTime.MinValue;
        private bool NotableOwned(Ped ped){return ped!=null&&notables.Any(n=>n.Handle==ped.Handle&&n.Model==ped.Model.Hash&&n.Ped.Exists());}
        private void ProtectNotable(Ped ped)
        {
            if(!npcSettings.Flag("memory.enabled")||npcSettings.Number("memory.notableCap")==0||!WorldDirector.Alive(ped)||ModOwns(ped)||NotableOwned(ped)||ped.IsPersistent||ped.IsInVehicle())return;
            if(notables.Count>=(int)npcSettings.Number("memory.notableCap")){ReleaseNotable(notables.OrderBy(n=>n.Since).First());}
            ped.SetIsPersistentNoClearTask(true);notables.Add(new NotableLease{Ped=ped,Handle=ped.Handle,Model=ped.Model.Hash,Since=DateTime.UtcNow});
        }
        private void ReleaseNotable(NotableLease n){try{if(n.Ped!=null&&n.Ped.Exists()&&n.Ped.Handle==n.Handle&&n.Ped.Model.Hash==n.Model)n.Ped.SetIsPersistentNoClearTask(false);}finally{notables.Remove(n);}}
        private void ReleaseNotables(bool all){foreach(var n in notables.ToArray())if(all||!WorldDirector.Alive(n.Ped)||!WorldDirector.Alive(Game.Player.Character)||n.Ped.Position.DistanceTo(Game.Player.Character.Position)>60||notables.Count>(int)npcSettings.Number("memory.notableCap"))ReleaseNotable(n);}
        private Dictionary<string,object> ObserveIdentity(Ped ped,NpcMemory memory)
        {
            if(memory.Identity==null){var clothes=ped.Style.GetAllComponents().Where(c=>(int)c.Type>=0&&(int)c.Type<=11&&c.Index>=0&&c.Index<=255&&c.TextureIndex>=0&&c.TextureIndex<=255).Take(12).Select(c=>new Dictionary<string,object>{{"slot",(int)c.Type},{"drawable",c.Index},{"texture",c.TextureIndex}}).ToArray();memory.Identity=new Dictionary<string,object>{{"clothing",clothes},{"homeArea",ResponsePolicy.CleanText(World.GetZoneLocalizedName(ped.Position),80)},{"role",ResponsePolicy.CleanText(director.Faction(ped),80)}};}
            return memory.Identity;
        }
        private void TickMind(Ped player,string pause)
        {
            if(pause!=null&&pause!="Reply wheel open"&&pause!="Dialogue keyboard open"&&pause!="Native menu open"||!npcSettings.Flag("memory.enabled")){ReleaseNotables(true);return;}
            ReleaseNotables(false);if(pause!=null)return;DateTime now=DateTime.UtcNow;if(now<nextMindTick)return;nextMindTick=now.AddSeconds(1);
            if(player.IsShooting)recentPlayerCrime=now;
            foreach(var target in seen.Values.Where(s=>now-s.At<TimeSpan.FromSeconds(2)).Take(16)){
                if(!WorldDirector.Alive(target.Ped)||target.Ped.Model.Hash!=target.Model)continue;
                if(player.IsAiming&&Game.Player.IsTargeting(target.Ped)&&target.Ped.Position.DistanceTo(player.Position)<12){Witness("threat",target.Ped);recentPlayerCrime=now;}
                if(Game.Player.Wanted.WantedLevel>0&&player.IsShooting&&target.Ped.Position.DistanceTo(player.Position)<35)Witness("crime",target.Ped);
            }
        }
        private void Witness(string type,Ped ped)
        {
            if(!npcSettings.Flag("memory.enabled")||!WorldDirector.Alive(ped))return;string id=NpcId(ped),key=id+":"+type;DateTime prior;if(witnessedCooldown.TryGetValue(key,out prior)&&DateTime.UtcNow-prior<TimeSpan.FromSeconds(30))return;witnessedCooldown[key]=DateTime.UtcNow;
            foreach(string old in witnessedCooldown.Where(x=>DateTime.UtcNow-x.Value>TimeSpan.FromMinutes(5)).Select(x=>x.Key).ToArray())witnessedCooldown.Remove(old);
            Observe(ped);if(witnessedEvents.Count>=64)witnessedEvents.RemoveAt(0);witnessedEvents.Add(new Dictionary<string,object>{{"id",Guid.NewGuid().ToString()},{"type",type},{"at",DateTime.UtcNow.ToString("o")},{"npcIds",new[]{id}},{"district",ResponsePolicy.CleanText(World.GetZoneLocalizedName(ped.Position),80)},{"position",Position(ped.Position)}});ProtectNotable(ped);
        }
        private void ConsumeMindUpdate(Dictionary<string,object> update,Dictionary<string,object> payload,Ped player)
        {
            string npcId=Wire.Text(update,"npcId",128);SeenNpc current;if(!seen.TryGetValue(npcId,out current)||DateTime.UtcNow-current.At>TimeSpan.FromSeconds(5)||!WorldDirector.Alive(current.Ped)||current.Ped.Model.Hash!=current.Model||ScriptProtected(current.Ped))return;
            MindHydration data=MindHydration.Parse(payload);if(data.Handle!=current.Handle||data.Model!=current.Model)return;NpcMemory memory=Memory(current.Ped,true);
            if(memory.Hydration!=null&&MindHydration.Epoch(data.StoreEpoch)<MindHydration.Epoch(memory.Hydration.StoreEpoch))return;
            bool reset=memory.Hydration!=null&&MindHydration.Epoch(data.StoreEpoch)>MindHydration.Epoch(memory.Hydration.StoreEpoch);
            if(!reset&&memory.Hydration!=null&&data.Revision<memory.Hydration.Revision)return;
            data.ApplyTo(memory.Mind,reset);memory.Hydration=data;memory.Note=data.Summary;if(reset)memory.History.Clear();if(data.Notable)ProtectNotable(current.Ped);appliedMemoryRevision=Math.Max(appliedMemoryRevision,data.Revision);
        }
        private void ConsumeReputation(Dictionary<string,object> response)
        {
            object raw;if(!response.TryGetValue("reputationSnapshot",out raw)||raw==null)return;var value=Wire.Map(raw);int revision=Wire.Integer(value,"revision",0,Int32.MaxValue);if(revision<=appliedReputationRevision)return;
            var factions=ReputationPolicy.Parse(Wire.Map(Wire.Value(value,"factionStandings")));var districts=ReputationPolicy.Parse(Wire.Map(Wire.Value(value,"districtStandings")));factionStandings.Clear();districtStandings.Clear();foreach(var p in factions)factionStandings[p.Key]=p.Value;foreach(var p in districts)districtStandings[p.Key]=p.Value;appliedReputationRevision=revision;
        }
        private void MindOutcome(string commit,string jobId,string npcId,bool applied,NpcMind mind)
        {
            if(commit==null)return;Guid parsed;if(!Guid.TryParse(commit,out parsed))throw new InvalidOperationException("Invalid memory commit identity.");mindOutcomes.RemoveAll(x=>(string)x["commitId"]==commit);if(mindOutcomes.Count>=128)mindOutcomes.RemoveAt(0);var item=new Dictionary<string,object>{{"commitId",commit},{"jobId",jobId},{"npcId",npcId},{"status",applied?"applied":"rejected"}};if(applied)item["mind"]=mind.Snapshot();mindOutcomes.Add(item);
        }
    }
}

