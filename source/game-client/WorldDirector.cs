using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using GTA;
using GTA.Math;
using GTA.Native;

namespace LivingLosSantosV2
{
    internal sealed class WorldDirector
    {
        internal sealed class OwnedPed
        {
            public Ped Ped; public int Handle, Model; public string Faction; public bool Attacker, Witness, Retired;
            public DateTime NextTask=DateTime.MinValue;
            public Blip Blip;
            public bool Exists { get { return Ped != null && Ped.Exists() && WorldRules.CanOwn(Handle,Ped.Handle,Model,Ped.Model.Hash,true); } }
            public bool Alive { get { return Exists && Ped.IsAlive; } }
        }
        private sealed class Encounter
        {
            public string Id=Guid.NewGuid().ToString("N"), Type, Attacker, Defender, State="streaming", Command;
            public Territory Territory;
            public Vector3 Center;
            public DateTime Started=DateTime.UtcNow, StateAt=DateTime.UtcNow, Expires=DateTime.MaxValue;
            public readonly List<OwnedPed> Peds=new List<OwnedPed>();
            public readonly List<Model> Models=new List<Model>();
            public int PerTeam, Witnesses;
            public double PlacementPhase;
            public int PlacementIndex=-1,NextCandidate,NavFailures,GroundFailures,ClearanceFailures,RangeFailures,HeightFailures,DuplicateCandidates;
            public readonly HashSet<string> SampledPositions=new HashSet<string>();
            public int Planned { get { return PerTeam*2+Witnesses; } }
        }
        private readonly List<Encounter> encounters=new List<Encounter>();
        private readonly Dictionary<string,Blip> territoryBlips=new Dictionary<string,Blip>();
        private readonly Random random=new Random();
        private readonly Action<string,string,string,string> emit;
        private readonly Action<string,bool,string> acknowledge;
        private readonly Action persist;
        private DateTime nextEvent=DateTime.UtcNow.AddSeconds(20), nextPulse=DateTime.MinValue, nextTaunt=DateTime.MinValue;
        private int placementBudget;
        private bool spawnedThisPulse;
        public readonly Territory[] Territories=WorldRules.Territories();
        public DirectorSettings Settings=new DirectorSettings();
        public string PausedReason="Starting Story Mode director";
        public WorldDirector(Action<string,string,string,string> events,Action<string,bool,string> ack,Action save)
        { emit=events; acknowledge=ack; persist=save; }
        public IEnumerable<OwnedPed> Peds { get { return encounters.SelectMany(e=>e.Peds); } }
        public int OwnedCount { get { return Peds.Count(p=>p.Exists); } }
        public bool IsOwned(Ped ped) { return ped!=null && Peds.Any(p=>p.Handle==ped.Handle && p.Model==ped.Model.Hash && p.Exists); }
        public string Faction(Ped ped)
        {
            OwnedPed owned=Peds.FirstOrDefault(p=>p.Handle==ped.Handle && p.Model==ped.Model.Hash && p.Exists);
            if(owned!=null) return owned.Faction;
            int hash=ped.Model.Hash;
            foreach(string gang in WorldRules.Factions) if(ModelNames(gang).Any(name=>new Model(name).Hash==hash)) return gang;
            return "Civilian/Unknown";
        }
        public void Apply(DirectorSettings value)
        {
            Settings=value;
            foreach(Encounter e in encounters.ToArray())
                if(!Settings.enabled || (e.Type=="turf_war"&&!Settings.turfWars) || (e.Type=="street_fight"&&!Settings.streetFights)) End(e,"Cancelled by director settings",false,null);
            while(encounters.Count>Settings.maxActiveEvents || encounters.Sum(e=>e.Planned)>Settings.maxSpawnedPeds)
                End(encounters.Last(),"Cancelled to apply reduced population limits",false,null);
            nextEvent=DateTime.UtcNow.AddSeconds(Settings.eventIntervalSeconds);
            persist();
        }
        public void Toggle() { var value=DirectorSettings.Parse(Settings.Snapshot()); value.enabled=!value.enabled; Apply(value); emit("director",value.enabled?"Street director enabled":"Street director disabled",null,null); }
        private static string[] ModelNames(string faction)
        {
            if(faction=="Families") return new[]{"g_m_y_famca_01","g_m_y_famdnf_01","g_m_y_famfor_01"};
            if(faction=="Ballas") return new[]{"g_m_y_ballaeast_01","g_m_y_ballaorig_01","g_m_y_ballasout_01"};
            if(faction=="Vagos") return new[]{"g_m_y_mexgang_01","g_m_y_mexgoon_01","g_m_y_mexgoon_02"};
            return new[]{"a_m_y_stbla_01","a_m_y_stbla_02","a_m_y_stlat_01"};
        }
        public static bool Alive(Ped p) { return p!=null && p.Exists() && p.IsAlive; }
        public static string ScenePause(Ped player,DirectorSettings settings)
        {
            if(Function.Call<bool>(Hash.IS_SCREEN_FADED_OUT)) return "Game loading or screen transition";
            if(Game.IsPaused) return "Game paused";
            if(Game.IsCutsceneActive) return "Cutscene active";
            if(!Alive(player)) return "Player unavailable or dead";
            if(settings.protectMissions && Game.IsMissionActive) return "Story mission protected";
            if(Function.Call<int>(Hash.GET_INTERIOR_FROM_ENTITY,player.Handle)!=0) return "Player indoors";
            if(!Game.Player.CanControlCharacter) return "Player control unavailable";
            if(player.IsInVehicle() && player.CurrentVehicle!=null && player.CurrentVehicle.Speed>25) return "Player travelling too fast for street encounters";
            return null;
        }
        public void Tick(Ped player,string pause)
        {
            DateTime now=DateTime.UtcNow;
            PausedReason=pause ?? (!Settings.enabled?"Disabled by director controls":null);
            if(now<nextPulse) return;
            nextPulse=now.AddMilliseconds(250);
            placementBudget=WorldRules.PlacementCandidatesPerPulse; spawnedThisPulse=false;
            if(pause!=null)
            {
                // Ending owned encounters prevents combat spilling into a cutscene, mission or interior.
                if(pause!="Game paused"&&pause!="Dialogue keyboard open") Clear("Scene changed: "+pause);
                else foreach(Encounter e in encounters) { e.Started=e.Started.AddMilliseconds(250); e.StateAt=e.StateAt.AddMilliseconds(250); }
                return;
            }
            RefreshBlips();
            foreach(Encounter e in encounters.ToArray()) Advance(e,player,now);
            if(!Settings.enabled) return;
            if(now>=nextTaunt)
            {
                nextTaunt=now.AddSeconds(8+random.Next(10));
                OwnedPed mouth=Peds.Where(p=>p.Alive && !p.Witness && !p.Retired && p.Ped.Position.DistanceTo(player.Position)<20).FirstOrDefault();
                if(Settings.ambientTaunts && random.Next(100)<Settings.ambientHostility)
                {
                    Ped speaker=mouth==null?World.GetNearbyPeds(player,12).FirstOrDefault(p=>Alive(p)&&p.IsHuman&&p.Handle!=player.Handle&&!p.IsPersistent&&!p.IsInVehicle()&&!p.IsInCombat&&!p.IsAnySpeechPlaying):mouth.Ped;
                    // Ambient speech is ephemeral: no ambient task, persistent flag, relationship or weapon is changed.
                    if(speaker!=null) { speaker.PlayAmbientSpeech("GENERIC_INSULT_HIGH",SpeechModifier.ForceShouted); emit("street_taunt","A nearby pedestrian shouted an insult.",null,Faction(speaker)); }
                }
            }
            if(now<nextEvent || encounters.Count>=Settings.maxActiveEvents) return;
            nextEvent=now.AddSeconds(Settings.eventIntervalSeconds+random.Next(0,16));
            Territory nearby=Territories.Where(t=>Location(t).DistanceTo(player.Position)<260 && t.challenger==null).OrderBy(t=>Location(t).DistanceToSquared(player.Position)).FirstOrDefault();
            if(Settings.turfWars && nearby!=null && random.Next(100)<Settings.gangAggression)
            {
                string attacker=WorldRules.Factions.Where(f=>f!=nearby.owner).OrderBy(f=>random.Next()).First();
                string error=StartTurf(player,nearby.id,attacker,null,now.AddSeconds(20));
                if(error!=null) emit("encounter_skipped",error,nearby.id,null);
            }
            else if(Settings.streetFights && random.Next(100)<Settings.ambientHostility)
            {
                string error=StartStreet(player,null,now.AddSeconds(20));
                if(error!=null) emit("encounter_skipped",error,null,null);
            }
        }
        public string StartTurf(Ped player,string district,string attacker,string command,DateTime expiry)
        {
            Territory territory=Territories.FirstOrDefault(t=>t.id==district);
            if(territory==null) return "Unknown district.";
            if(!WorldRules.Factions.Contains(attacker)) return "Unknown attacking faction.";
            if(attacker==territory.owner) return "The attacker already owns this district.";
            if(territory.challenger!=null || encounters.Any(e=>e.Territory==territory)) return "A battle or its cleanup is already active in this district.";
            if(!Settings.turfWars) return "Turf wars are disabled.";
            if(Location(territory).DistanceTo(player.Position)>350) return "Move within 350 metres of "+territory.name+".";
            // Pick a streamed battle site inside the turf near the player, not a distant unloaded center.
            Vector3 toward=player.Position-Location(territory);
            float distance=toward.Length();
            if(distance>0) toward.Normalize();
            Vector3 center=distance>70?Location(territory)+toward*Math.Min(145,distance-35):Location(territory);
            if(center.DistanceTo(player.Position)>120) return "Move closer to the district so its sidewalks are streamed and within safe spawn range.";
            return Prepare(player,"turf_war",territory,attacker,territory.owner,center,command,expiry);
        }
        public string StartStreet(Ped player,string command,DateTime expiry)
        {
            if(!Settings.streetFights) return "Street fights are disabled.";
            double angle=random.NextDouble()*Math.PI*2;
            Vector3 center=player.Position+new Vector3((float)Math.Cos(angle)*28,(float)Math.Sin(angle)*28,0);
            return Prepare(player,"street_fight",null,"Locals","Rivals",center,command,expiry);
        }
        private string Prepare(Ped player,string type,Territory territory,string attacker,string defender,Vector3 center,string command,DateTime expiry)
        {
            if(!Settings.enabled) return "Enable the director first.";
            string pause=ScenePause(player,Settings); if(pause!=null) return pause+".";
            if(encounters.Count>=Settings.maxActiveEvents) return "Active event limit reached.";
            if(encounters.Any(e=>e.Center.DistanceTo(center)<45)) return "Another encounter is too close to this scene.";
            int free=Settings.maxSpawnedPeds-encounters.Sum(e=>e.Planned);
            int team=type=="turf_war"?Math.Min(Settings.gangAggression>=70?4:3,free/2):1;
            if(free<2 || (type=="turf_war"&&team<2)) return "Owned pedestrian limit reached.";
            int witnesses=Settings.civilianPanic>0 && free>team*2?1:0;
            var encounter=new Encounter { Type=type,Territory=territory,Attacker=attacker,Defender=defender,Center=center,PerTeam=team,Witnesses=witnesses,Command=command,Expires=expiry,PlacementPhase=random.NextDouble()*Math.PI*2 };
            for(int i=0;i<encounter.Planned;i++)
            {
                string faction=i<team?attacker:i<team*2?defender:"Civilian";
                string[] names=ModelNames(faction); Model model=new Model(names[random.Next(names.Length)]);
                if(!model.IsValid || !model.IsPed) { foreach(Model old in encounter.Models) old.MarkAsNoLongerNeeded(); return "An encounter model is unavailable in this game build."; }
                model.Request(); encounter.Models.Add(model);
            }
            encounters.Add(encounter);
            if(territory!=null) territory.challenger=attacker;
            emit("encounter_preparing","Street scene preparing near "+(territory==null?"the player":territory.name),territory==null?null:territory.id,attacker);
            return null;
        }
        private void Advance(Encounter e,Ped player,DateTime now)
        {
            if(e.Center.DistanceTo(player.Position)>180) { End(e,"Player left the streamed encounter area; ownership unchanged",false,null); return; }
            if(e.State=="streaming")
            {
                if(now>=e.Expires || now-e.Started>TimeSpan.FromSeconds(20)) { End(e,"Model or scene preparation timed out. "+PlacementDiagnostic(e),false,null); return; }
                if(!e.Models.All(m=>m.IsLoaded)) return;
                if(e.Peds.Count<e.Planned)
                {
                    if(spawnedThisPulse||placementBudget<=0) return;
                    int i=e.Peds.Count; Vector3 position; bool exhausted;
                    if(!Place(e,player,i,out position,out exhausted))
                    { if(exhausted) End(e,"No clear, ground-safe sidewalk spawn position. "+PlacementDiagnostic(e),false,null); return; }
                    Ped ped=World.CreatePed(e.Models[i],position,(float)random.Next(360));
                    if(ped==null || !ped.Exists()) { End(e,"Game could not create encounter pedestrian",false,null); return; }
                    var own=new OwnedPed { Ped=ped,Handle=ped.Handle,Model=ped.Model.Hash,Attacker=i<e.PerTeam,Witness=i>=e.PerTeam*2,Faction=i<e.PerTeam?e.Attacker:i<e.PerTeam*2?e.Defender:"Civilian" };
                    // Track immediately so subsequent setup failure still permits ownership-safe cleanup.
                    e.Peds.Add(own);
                    spawnedThisPulse=true;
                    ped.IsPersistent=true; ped.BlockPermanentEvents=true; ped.Accuracy=15+Settings.gangAggression/4;
                    ped.Armor=e.Type=="turf_war"?15:0;
                    ped.Weapons.Give(e.Type=="turf_war"&&!own.Witness && random.Next(100)<Settings.gangAggression?WeaponHash.Pistol:WeaponHash.Unarmed,90,true,true);
                    if(Settings.blips && !own.Witness) AddPedBlip(own);
                    return;
                }
                foreach(Model model in e.Models) model.MarkAsNoLongerNeeded(); e.Models.Clear();
                e.State="confrontation"; e.StateAt=now; e.Started=now;
                foreach(OwnedPed p in e.Peds.Where(p=>p.Alive&&!p.Witness))
                {
                    OwnedPed opponent=e.Peds.FirstOrDefault(other=>other.Attacker!=p.Attacker&&!other.Witness&&other.Alive);
                    if(opponent!=null) p.Ped.Task.TurnTo(opponent.Ped,4000);
                    if(Settings.ambientTaunts) p.Ped.PlayAmbientSpeech("GENERIC_INSULT_HIGH",SpeechModifier.Shouted);
                }
                if(e.Command!=null) { acknowledge(e.Command,true,"Encounter participants spawned; confrontation underway."); e.Command=null; }
                emit("encounter_started",e.Type=="turf_war"?e.Attacker+" are challenging "+e.Defender+" in "+e.Territory.name:"A street argument is turning violent",e.Territory==null?null:e.Territory.id,e.Attacker);
                return;
            }
            if(e.State=="clearing") { if(now-e.StateAt>TimeSpan.FromSeconds(18)) Remove(e); return; }
            if(e.State=="confrontation" && now-e.StateAt<TimeSpan.FromSeconds(4)) return;
            e.State="fighting";
            // Missing handles are not deaths. Do not award a turf based on streaming/despawn uncertainty.
            if(e.Peds.Any(p=>!p.Exists)) { End(e,"A participant streamed out; result unverified and ownership unchanged",false,null); return; }
            int attackers=e.Peds.Count(p=>p.Attacker&&!p.Witness&&!p.Retired&&p.Alive);
            int defenders=e.Peds.Count(p=>!p.Attacker&&!p.Witness&&!p.Retired&&p.Alive);
            string winner=WorldRules.Winner(attackers,defenders,true,false);
            if(winner!=null) { End(e,(winner=="attacker"?e.Attacker:e.Defender)+" won the street encounter",true,winner); return; }
            if(attackers==0&&defenders==0) { End(e,"Both sides were eliminated or withdrew; ownership unchanged",true,null); return; }
            if(now-e.Started>TimeSpan.FromSeconds(150)) { End(e,"Battle timed out with both sides present; ownership unchanged",true,null); return; }
            foreach(OwnedPed p in e.Peds.Where(p=>p.Alive&&!p.Retired))
            {
                if(now<p.NextTask) continue;
                p.NextTask=now.AddSeconds(6);
                OwnedPed opponent=e.Peds.Where(other=>other.Alive&&!other.Witness&&!other.Retired&&other.Attacker!=p.Attacker).OrderBy(other=>other.Ped.Position.DistanceToSquared(p.Ped.Position)).FirstOrDefault();
                if(opponent==null) continue;
                if(p.Witness)
                {
                    if(random.Next(100)<Settings.civilianPanic) { p.Ped.Task.FleeFrom(opponent.Ped,50,12000); p.Retired=true; }
                    else p.Ped.Task.LookAt(opponent.Ped,3000);
                }
                else if(Settings.tacticalRetreat && p.Ped.Health<35)
                {
                    p.Retired=true;
                    if(random.Next(100)<45) p.Ped.Task.HandsUp(15000); else p.Ped.Task.FleeFrom(opponent.Ped,60,18000);
                    emit("retreat",p.Faction+" fighter "+(p.Handle)+" withdrew at low health",e.Territory==null?null:e.Territory.id,p.Faction);
                }
                else p.Ped.Task.CombatTimed(opponent.Ped,6500,TaskCombatFlags.PreventChangingTarget);
            }
        }
        private static string PlacementDiagnostic(Encounter e)
        { return "Spawn "+Math.Min(e.Peds.Count+1,e.Planned)+"/"+e.Planned+": tried="+e.NextCandidate+", nav="+e.NavFailures+", ground="+e.GroundFailures+", occupied="+e.ClearanceFailures+", range="+e.RangeFailures+", height="+e.HeightFailures+", repeated="+e.DuplicateCandidates+"."; }
        private bool Place(Encounter e,Ped player,int index,out Vector3 position,out bool exhausted)
        {
            position=Vector3.Zero;
            exhausted=false;
            if(e.PlacementIndex!=index)
            {
                e.PlacementIndex=index; e.NextCandidate=0; e.NavFailures=0; e.GroundFailures=0;
                e.ClearanceFailures=0; e.RangeFailures=0; e.HeightFailures=0; e.DuplicateCandidates=0; e.SampledPositions.Clear();
            }
            int limit=Math.Min(WorldRules.PlacementCandidates,e.NextCandidate+placementBudget);
            while(e.NextCandidate<limit)
            {
                placementBudget--;
                var offset=WorldRules.PlacementOffset(index,e.PerTeam,e.NextCandidate++,e.PlacementPhase);
                Vector3 desired=e.Center+new Vector3(offset.Item1,offset.Item2,3);
                Vector3 safe;
                if(!World.GetSafePositionForPed(desired,out safe,GTA.GetSafePositionFlags.OnlyPavement|GTA.GetSafePositionFlags.NotInterior|GTA.GetSafePositionFlags.NotWater)) { e.NavFailures++; continue; }
                string cell=Math.Round(safe.X).ToString(System.Globalization.CultureInfo.InvariantCulture)+":"+Math.Round(safe.Y).ToString(System.Globalization.CultureInfo.InvariantCulture)+":"+Math.Round(safe.Z).ToString(System.Globalization.CultureInfo.InvariantCulture);
                if(!e.SampledPositions.Add(cell)) { e.DuplicateCandidates++; continue; }
                float ground;
                bool found=World.GetGroundHeight(safe+new Vector3(0,0,3),out ground,GetGroundHeightMode.Normal);
                if(!found) { e.GroundFailures++; continue; }
                if(Math.Abs(ground-safe.Z)>3.5) { e.HeightFailures++; continue; }
                if(!WorldRules.SafePlacement(safe.DistanceTo(player.Position),safe.DistanceTo(desired),ground-safe.Z,true,true)) { e.RangeFailures++; continue; }
                bool clear=e.Peds.All(p=>!p.Exists || p.Ped.Position.DistanceTo(safe)>2.5f)
                    && World.GetNearbyPeds(safe,2.5f).Length==0 && World.GetNearbyVehicles(safe,4.5f).Length==0;
                if(!clear) { e.ClearanceFailures++; continue; }
                position=new Vector3(safe.X,safe.Y,ground+0.15f); return true;
            }
            exhausted=e.NextCandidate>=WorldRules.PlacementCandidates;
            return false;
        }
        private void End(Encounter e,string message,bool linger,string winner)
        {
            if(!encounters.Contains(e)) return;
            if(e.Territory!=null)
            {
                e.Territory.challenger=null;
                if(winner!=null)
                { e.Territory.owner=winner=="attacker"?e.Attacker:e.Defender; e.Territory.wins=Math.Min(1000000,e.Territory.wins+1); e.Territory.heat=Math.Min(100,e.Territory.heat+15); persist(); }
            }
            if(e.Command!=null) { acknowledge(e.Command,false,message); e.Command=null; }
            emit(winner==null?"encounter_ended":e.Type=="turf_war"?"turf_result":"encounter_result",message,e.Territory==null?null:e.Territory.id,winner==null?null:winner=="attacker"?e.Attacker:e.Defender);
            if(linger)
            {
                e.State="clearing"; e.StateAt=DateTime.UtcNow;
                foreach(OwnedPed p in e.Peds.Where(p=>p.Alive)) { p.Retired=true; p.Ped.Task.WanderAround(e.Center,35); }
            }
            else Remove(e);
        }
        private void Remove(Encounter e)
        {
            foreach(OwnedPed p in e.Peds)
            {
                try { if(p.Blip!=null&&p.Blip.Exists()) p.Blip.Delete(); } catch { }
                try { if(p.Exists) { p.Ped.Task.ClearAll(); p.Ped.Delete(); } }
                catch { try { if(p.Exists) p.Ped.MarkAsNoLongerNeeded(); } catch { emit("cleanup_warning","An owned pedestrian cleanup failed; game exit releases the scene.",null,null); } }
            }
            foreach(Model model in e.Models) { try { model.MarkAsNoLongerNeeded(); } catch { } }
            encounters.Remove(e);
        }
        public void Clear(string reason)
        { foreach(Encounter e in encounters.ToArray()) End(e,reason,false,null); }
        public void Dispose()
        { Clear("Director unloaded"); foreach(Blip b in territoryBlips.Values) if(b.Exists()) b.Delete(); territoryBlips.Clear(); }
        private static Vector3 Location(Territory t) { return new Vector3(t.x,t.y,t.z); }
        private static BlipColor Color(string faction) { return faction=="Families"?BlipColor.Green:faction=="Ballas"?BlipColor.Purple:faction=="Vagos"?BlipColor.Yellow:BlipColor.Orange; }
        private static void AddPedBlip(OwnedPed p)
        { p.Blip=p.Ped.AddBlip(); p.Blip.Name="LLS "+p.Faction; p.Blip.Color=Color(p.Faction); p.Blip.Scale=0.65f; }
        private void RefreshBlips()
        {
            if(!Settings.blips || !Settings.enabled)
            { foreach(Blip b in territoryBlips.Values) if(b.Exists()) b.Delete(); territoryBlips.Clear(); }
            else foreach(Territory t in Territories)
            {
                Blip blip;
                if(!territoryBlips.TryGetValue(t.id,out blip) || !blip.Exists())
                { blip=World.CreateBlip(Location(t)); territoryBlips[t.id]=blip; blip.Name="LLS: "+t.name; blip.Scale=0.65f; blip.IsShortRange=true; }
                blip.Color=Color(t.owner);
            }
            foreach(OwnedPed p in Peds)
            {
                if(!Settings.blips && p.Blip!=null) { if(p.Blip.Exists()) p.Blip.Delete(); p.Blip=null; }
                else if(Settings.blips && !p.Witness && p.Exists && (p.Blip==null||!p.Blip.Exists())) AddPedBlip(p);
            }
        }
        public object Snapshot()
        {
            return new { enabled=Settings.enabled, pausedReason=PausedReason, settings=Settings.Snapshot(), ownedPedCount=OwnedCount,
                territories=Territories.Select(t=>t.Snapshot()).ToArray(), activeEvents=encounters.Select(e=>new {
                    id=e.Id,type=e.Type,districtId=e.Territory==null?null:e.Territory.id,attacker=e.Attacker,defender=e.Defender,state=e.State,
                    attackerAlive=e.Peds.Count(p=>p.Attacker&&!p.Witness&&p.Alive),defenderAlive=e.Peds.Count(p=>!p.Attacker&&!p.Witness&&p.Alive),startedAt=e.Started.ToString("o") }).ToArray() };
        }
    }
}
