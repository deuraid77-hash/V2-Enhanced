using System;
using System.Collections.Generic;
using System.Linq;
using GTA;

namespace LivingLosSantosV2
{
    // Step 4 game-side vehicle scenarios. Detection reads observed entities only and
    // never spawns, warps or deletes anything, so the scenario layer cannot leak
    // entities. Execution reuses QueueNpcAction, so every beat passes the same guards,
    // leases and receipts as a conversation action.
    public sealed partial class EnhancedClient
    {
        private sealed class ScenarioRun { public string JobId,Scenario,Source; public Ped Ped; public Queue<ScenarioBeat> Beats; public DateTime NextAt,Deadline; }
        private const float VehicleScanMeters=25f;
        private const double ScenarioBeatSeconds=3.5;
        private readonly ScenarioGate scenarioGate=new ScenarioGate();
        private readonly Dictionary<string,Dictionary<string,object>> scenarioFacts=new Dictionary<string,Dictionary<string,object>>();
        private readonly Dictionary<string,Ped> scenarioPeds=new Dictionary<string,Ped>();
        private Dictionary<int,int> vehicleHealthSeen=new Dictionary<int,int>();
        private readonly HashSet<string> creditedContacts=new HashSet<string>();
        private ScenarioRun scenarioRun;
        private DateTime nextVehicleScan=DateTime.MinValue;

        private static float Bounded(float value){return Single.IsNaN(value)||Single.IsInfinity(value)?0f:Math.Max(0f,Math.Min(200f,value));}

        // Sent as npc.vehicle; the companion uses it to decide vehicle-compatible actions.
        private Dictionary<string,object> DescribeVehicle(Ped ped)
        {
            if(!ped.IsInVehicle())return null;
            Vehicle v=ped.CurrentVehicle;if(v==null||!v.Exists())return null;
            Ped player=Game.Player.Character;
            int seat=(int)ped.SeatIndex;if(seat<-1||seat>15)seat=v.Driver!=null&&v.Driver.Handle==ped.Handle?-1:0;
            bool playerVehicle=WorldDirector.Alive(player)&&player.IsInVehicle()&&player.CurrentVehicle!=null&&player.CurrentVehicle.Handle==v.Handle;
            return new Dictionary<string,object>{{"id",v.Handle+":"+v.Model.Hash},{"handle",v.Handle},{"modelHash",v.Model.Hash},{"seat",seat},{"speed",Bounded(v.Speed)},{"engineRunning",v.IsEngineRunning},{"isPlayerVehicle",playerVehicle},{"protected",v.IsPersistent}};
        }

        private void TickVehicles(Ped player,string pause)
        {
            DateTime now=DateTime.UtcNow;
            if(pause!=null){if(scenarioRun!=null)EndScenario("Vehicle scenario paused: "+pause);return;}
            TickScenarioRun(player,now);
            if(now<nextVehicleScan)return;
            nextVehicleScan=now.AddSeconds(1);
            scenarioGate.Expire(now);
            foreach(string id in scenarioFacts.Keys.Where(k=>!scenarioGate.Offered(k)).ToArray()){scenarioFacts.Remove(id);scenarioPeds.Remove(id);}
            if(scenarioRun!=null||!WorldDirector.Alive(player)||npcSettings.Number("vehicles.maxActive")<1||!metrics.HasBudget(npcSettings.Number("performance.tickBudgetMs")))return;
            Vehicle playerCar=player.IsInVehicle()?player.CurrentVehicle:null;if(playerCar!=null&&!playerCar.Exists())playerCar=null;
            Vehicle impactCar=playerCar??player.LastVehicle;if(impactCar!=null&&!impactCar.Exists())impactCar=null;
            int wanted=Game.Player.Wanted.WantedLevel;
            float playerSpeed=Bounded(playerCar!=null?playerCar.Speed:player.Speed);
            bool seatFree=playerCar!=null&&playerCar.IsSeatFree(VehicleSeat.Passenger);
            double windowMeters=npcSettings.Number("vehicles.windowTalkMeters"),chatSpeed=npcSettings.Number("conversation.vehicleMaxSpeed");
            var health=new Dictionary<int,int>();
            foreach(Ped ped in World.GetNearbyPeds(player,VehicleScanMeters).Where(p=>p.Exists()&&p.IsHuman&&p.Handle!=player.Handle).OrderBy(p=>p.Position.DistanceToSquared(player.Position)).Take(16))
            {
                if(!metrics.HasBudget(npcSettings.Number("performance.tickBudgetMs")))break;
                if(!ped.IsAlive)continue;
                bool inVehicle=ped.IsInVehicle();Vehicle car=inVehicle?ped.CurrentVehicle:null;
                if(inVehicle&&(car==null||!car.Exists()))continue;
                int previous;bool hadHealth=vehicleHealthSeen.TryGetValue(ped.Handle,out previous);health[ped.Handle]=ped.Health;
                Vehicle near=inVehicle?car:ped.LastVehicle;if(near!=null&&(!near.Exists()||near.Position.DistanceTo(ped.Position)>8))near=null;
                bool contact=false;
                if(inVehicle&&playerCar!=null&&car.Handle!=playerCar.Handle&&(car.IsTouching(playerCar)||car.HasBeenDamagedBy(playerCar)))
                {
                    // HasBeenDamagedBy is sticky; credit each vehicle once per session window.
                    string key=car.Handle+":"+car.Model.Hash;
                    if(!creditedContacts.Contains(key)){contact=true;if(creditedContacts.Count>=128)creditedContacts.Clear();creditedContacts.Add(key);}
                }
                string faction=director.Faction(ped);
                var facts=new VehiclePolicy.Facts{
                    PlayerInVehicle=playerCar!=null,NpcInVehicle=inVehicle,
                    NpcIsDriver=inVehicle&&car.Driver!=null&&car.Driver.Handle==ped.Handle,
                    SharesPlayerVehicle=inVehicle&&playerCar!=null&&car.Handle==playerCar.Handle,
                    Contact=contact,PlayerJacking=player.IsJacking,NpcBeingJacked=ped.IsBeingJacked,
                    HitByPlayerVehicle=!inVehicle&&impactCar!=null&&hadHealth&&ped.Health<previous&&ped.HasBeenDamagedBy(impactCar),
                    NpcIsCop=ped.PedType==PedType.Cop,NpcGang=WorldRules.Factions.Contains(faction),
                    VehicleBroken=near!=null&&(!near.IsDriveable||near.EngineHealth<300f),
                    PlayerSeatFree=seatFree,NpcProtected=ScriptProtected(ped)||ModOwns(ped),
                    VehicleProtected=near!=null&&near.IsPersistent,NpcInCombat=ped.IsInCombat,
                    PlayerSpeed=playerSpeed,NpcSpeed=Bounded(inVehicle?car.Speed:ped.Speed),Distance=ped.Position.DistanceTo(player.Position),Wanted=wanted};
                string scenario=VehiclePolicy.Classify(facts,windowMeters,chatSpeed,VehicleScanMeters);
                if(scenario==null||!npcSettings.Flag("vehicles."+scenario+".enabled"))continue;
                var opportunity=scenarioGate.Offer(scenario,NpcId(ped),now);
                if(opportunity==null)continue;
                scenarioFacts[opportunity.Id]=new Dictionary<string,object>{{"playerInVehicle",facts.PlayerInVehicle},{"playerSpeed",facts.PlayerSpeed},{"npcSpeed",facts.NpcSpeed},{"wantedLevel",Math.Max(0,Math.Min(5,wanted))},{"contact",facts.Contact},{"npcFaction",ResponsePolicy.CleanText(faction,64).Length==0?"Civilian/Unknown":ResponsePolicy.CleanText(faction,64)}};
                scenarioPeds[opportunity.Id]=ped;
                Observe(ped);
            }
            vehicleHealthSeen=health;
        }

        // Only opportunities whose NPC is in this exact packet are valid for the companion.
        private object[] VehicleOpportunityPacket(IEnumerable<Dictionary<string,object>> npcs)
        {
            var ids=new HashSet<string>(npcs.Select(n=>(string)n["id"]));
            return scenarioGate.Open.Where(o=>ids.Contains(o.NpcId)&&scenarioFacts.ContainsKey(o.Id)).Take(ScenarioGate.MaxOpen)
                .Select(o=>(object)new Dictionary<string,object>{{"id",o.Id},{"scenario",o.Scenario},{"npcIds",new[]{o.NpcId}},{"detectedAt",o.At.ToString("o")},{"facts",scenarioFacts[o.Id]}}).ToArray();
        }

        private void ConsumeScenario(Dictionary<string,object> update,Dictionary<string,object> payload,Ped player,string pause)
        {
            string jobId=Wire.Text(update,"jobId",128),status=Wire.Text(update,"status",32),source=ResponsePolicy.CleanText(Wire.Text(update,"source",80),40);
            if(status!="completed"&&status!="fallback")return;
            DateTime now=DateTime.UtcNow;
            var beats=ScenarioPlanPolicy.Parse(payload,jobId,runtimeId,sceneEpoch,now);
            string opportunityId=Wire.Text(payload,"opportunityId",64);
            var opportunity=scenarioGate.Consume(opportunityId,now);
            Ped ped;scenarioPeds.TryGetValue(opportunityId,out ped);scenarioPeds.Remove(opportunityId);scenarioFacts.Remove(opportunityId);
            try{ScenarioPlanPolicy.Bind(payload,opportunity,beats);}
            catch(InvalidOperationException ex){foreach(var b in beats)RecordActionOutcome((string)b.Action["actionId"],jobId,false,ex.Message);throw;}
            string reject=pause??(scenarioRun!=null?"Another vehicle scenario is running.":ped==null||!ped.Exists()||!ped.IsAlive||NpcId(ped)!=opportunity.NpcId?"Scenario NPC is no longer available.":null);
            if(reject!=null){foreach(var b in beats)RecordActionOutcome((string)b.Action["actionId"],jobId,false,reject);return;}
            scenarioRun=new ScenarioRun{JobId=jobId,Scenario=opportunity.Scenario,Source=source,Ped=ped,Beats=new Queue<ScenarioBeat>(beats),NextAt=now,Deadline=now.AddSeconds(Math.Max(20,npcSettings.Number("director.scenarioTimeoutSeconds")))};
            Emit("vehicle_scenario","Vehicle scenario "+opportunity.Scenario+" ["+source+"] started with "+beats.Count+" beat(s).",null,director.Faction(ped));
        }

        private void TickScenarioRun(Ped player,DateTime now)
        {
            var run=scenarioRun;if(run==null||now<run.NextAt)return;
            if(now>=run.Deadline){EndScenario("Vehicle scenario timed out.");return;}
            if(run.Beats.Count==0){scenarioRun=null;Emit("vehicle_scenario","Vehicle scenario "+run.Scenario+" finished.",null,null);return;}
            var beat=run.Beats.Dequeue();run.NextAt=now.AddSeconds(ScenarioBeatSeconds);
            string id=(string)beat.Action["actionId"],message;
            try
            {
                if(executedActions.Contains(id))return;
                Ped ped=run.Ped;
                if(ped==null||!ped.Exists()||ped.Handle!=beat.Handle||ped.Model.Hash!=beat.Model||!ped.IsAlive)throw new InvalidOperationException("Scenario NPC changed or is gone.");
                if(Wire.Timestamp(beat.Action,"expiresAt")<=now)throw new InvalidOperationException("Scenario beat expired before it could run.");
                if(!ResponsePolicy.IsSupportedAction(beat.ActionType))throw new InvalidOperationException("Action executor not enabled in this build.");
                if(!npcSettings.Flag("action."+beat.ActionType))throw new InvalidOperationException("Action disabled by settings.");
                if(executedActions.Count>=2048)throw new InvalidOperationException("Session action ledger full; reload the script to start a new session.");
                executedActions.Add(id);
                message=QueueNpcAction(ped,player,beat.ActionType,5000,id,run.JobId);
                if(message==null)
                {
                    Caption(SpeakerName(ped)+" ["+run.Source+"]: "+beat.Speech,(int)(ScenarioBeatSeconds*1000)+1500);
                    QueueVoiceCue(ped,beat.NpcId,beat.Speech,beat.Tone,"vehicle",run.Source,"B");
                    Emit("dialogue","NPC "+ped.Handle+" ["+run.Source+"]: "+beat.Speech,null,director.Faction(ped));
                    return;
                }
            }
            catch(Exception ex){message=ex is InvalidOperationException?ex.Message:"Game task failed: "+ex.GetType().Name;}
            RecordActionOutcome(id,run.JobId,false,message);
            EndScenario(message);
        }

        // Remaining beats get rejected receipts so the companion never waits on them.
        private void EndScenario(string reason)
        {
            var run=scenarioRun;scenarioRun=null;if(run==null)return;
            while(run.Beats.Count>0)RecordActionOutcome((string)run.Beats.Dequeue().Action["actionId"],run.JobId,false,reason);
            Emit("vehicle_scenario","Vehicle scenario "+run.Scenario+" ended: "+ResponsePolicy.CleanText(reason,160),null,null);
        }

        private void ClearVehicleScenarios(string reason)
        {
            EndScenario(reason);
            scenarioGate.Clear();scenarioFacts.Clear();scenarioPeds.Clear();vehicleHealthSeen.Clear();
        }
    }
}
