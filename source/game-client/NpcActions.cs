using System;
using System.Collections.Generic;
using System.Linq;
using GTA;
using GTA.Math;
using GTA.Native;

namespace LivingLosSantosV2
{
    public sealed partial class EnhancedClient
    {
        private sealed class ActionLease
        {
            public string Id,JobId,Type,Epoch,NpcId,Dictionary,Clip,Phase="pending";
            public Ped Ped;public int Handle,Model,VehicleHandle,VehicleModel,Duration;
            public DateTime Queued=DateTime.UtcNow,Until,NextAt;
            public bool Started,Replied,Phone,PickedUp,CrimeObserved;
            public ScriptTaskNameHash? Task;public Vector3 Destination;
            public Model Resource;public bool ResourceRequested;
            public Prop Parcel;public int ParcelHandle,ParcelModel;public Blip Blip;
            public readonly List<WorldDirector.OwnedPed> Backup=new List<WorldDirector.OwnedPed>();
        }
        private readonly List<ActionLease> npcActions=new List<ActionLease>();
        private readonly List<WorldDirector.OwnedPed> cleanupPeds=new List<WorldDirector.OwnedPed>();
        private int ActionOwnedCount {get{return npcActions.Sum(a=>a.Backup.Count(p=>p.Exists))+cleanupPeds.Count(p=>p.Exists);}}
        private IEnumerable<Ped> ActionPeds {get{return npcActions.SelectMany(a=>a.Backup).Concat(cleanupPeds).Where(p=>p.Exists).Select(p=>p.Ped);}}
        private bool ActionOwned(Ped ped){return ped!=null&&npcActions.SelectMany(a=>a.Backup).Concat(cleanupPeds).Any(p=>p.Exists&&p.Handle==ped.Handle&&p.Model==ped.Model.Hash);}
        private bool ModOwns(Ped ped){return director.IsOwned(ped)||ActionOwned(ped);}
        private bool ScriptProtected(Ped ped){return ped.IsPersistent&&!ModOwns(ped)&&!NotableOwned(ped);}
        private bool SafeVehicle(Ped ped,Ped player)
        {
            if(!ped.IsInVehicle())return true;
            Vehicle v=ped.CurrentVehicle;
            return npcSettings.Flag("conversation.vehicleEnabled")&&v!=null&&v.Exists()&&!v.IsPersistent&&v.IsDriveable&&v.Speed<=npcSettings.Number("conversation.vehicleMaxSpeed")&&(!player.IsInVehicle()||player.CurrentVehicle==null||player.CurrentVehicle.Handle!=v.Handle);
        }
        private string[] AvailableActions(Ped ped,Ped player)
        {
            bool vehicle=ped.IsInVehicle(),safe=SafeVehicle(ped,player);var result=new List<string>();
            foreach(string type in ActionPolicy.Names){if(ActionPolicy.Guard(type,ped.Exists(),ped.IsAlive,ped.IsHuman,true,ScriptProtected(ped),vehicle,safe,ped.Position.DistanceTo(player.Position),npcSettings.Number("conversation.walkAwayMeters"),npcSettings.Flag("action."+type))!=null)continue;
                if(type=="CALL_911"&&(!npcSettings.Flag("safety.allowPoliceResponse")||Game.Player.Wanted.WantedLevel==0&&DateTime.UtcNow-recentPlayerCrime>TimeSpan.FromSeconds(20)))continue;
                if(type=="CALL_FACTION_BACKUP"&&(!npcSettings.Flag("combat.backupEnabled")||!WorldRules.Factions.Contains(director.Faction(ped))||director.OwnedCount+ActionOwnedCount+2>director.Settings.maxSpawnedPeds))continue;
                if(type=="DRAW_WEAPON"&&(ped.Weapons.BestWeapon==null||ped.Weapons.BestWeapon.Hash==WeaponHash.Unarmed))continue;
                if(type=="ASK_FOR_RIDE"){Vehicle car=player.CurrentVehicle;if(!npcSettings.Flag("vehicles.lifts.enabled")||car==null||!car.Exists()||car.Speed>1||!car.IsSeatFree(VehicleSeat.Passenger))continue;}
                if(type=="HONK_AT_PLAYER"||type=="DRIVE_AWAY"){Vehicle car=ped.CurrentVehicle;if(car==null||car.Driver==null||car.Driver.Handle!=ped.Handle||type=="DRIVE_AWAY"&&!car.IsEngineRunning)continue;}
                if(type=="LEAVE_VEHICLE_TO_CONFRONT"&&ped.CurrentVehicle.Speed>1)continue;
                if(type=="OFFER_SIDE_GIG"&&npcActions.Any(a=>a.Type==type))continue;
                result.Add(type);
            }return result.ToArray();
        }
        private string QueueNpcAction(Ped ped,Ped player,string type,int duration,string id,string jobId)
        {
            string guard=ActionPolicy.Guard(type,ped!=null&&ped.Exists(),WorldDirector.Alive(ped),ped!=null&&ped.Exists()&&ped.IsHuman,true,ped!=null&&ped.Exists()&&ScriptProtected(ped),ped!=null&&ped.Exists()&&ped.IsInVehicle(),ped!=null&&ped.Exists()&&SafeVehicle(ped,player),ped==null?Double.PositiveInfinity:ped.Position.DistanceTo(player.Position),npcSettings.Number("conversation.walkAwayMeters"),npcSettings.Flag("action."+type));
            if(guard!=null)return guard;
            if(npcActions.Count>=8)return "Action capacity reached.";
            if(type=="CALL_911"&&!npcSettings.Flag("safety.allowPoliceResponse"))return "Police response disabled.";
            if(type=="CALL_911"&&Game.Player.Wanted.WantedLevel==0&&DateTime.UtcNow-recentPlayerCrime>TimeSpan.FromSeconds(20))return "No observed player crime for a police report.";
            if(type=="CALL_FACTION_BACKUP"&&(!npcSettings.Flag("combat.backupEnabled")||!WorldRules.Factions.Contains(director.Faction(ped))))return "Faction backup unavailable for this NPC or setting.";
            if(type=="CALL_FACTION_BACKUP"&&director.OwnedCount+ActionOwnedCount+2>director.Settings.maxSpawnedPeds)return "Owned population cap reached.";
            if(type=="OFFER_SIDE_GIG"&&npcActions.Any(a=>a.Type==type))return "A side errand is already active.";
            foreach(var old in npcActions.Where(a=>a.Handle==ped.Handle&&a.Model==ped.Model.Hash).ToArray())EndAction(old,"Replaced by a newer action.");
            var lease=new ActionLease{Id=id,JobId=jobId,Type=type,Epoch=sceneEpoch,NpcId=NpcId(ped),Ped=ped,Handle=ped.Handle,Model=ped.Model.Hash,Duration=type=="CALL_FACTION_BACKUP"?Math.Max(5000,duration):duration,Until=DateTime.UtcNow.AddMilliseconds(duration),CrimeObserved=Game.Player.Wanted.WantedLevel>0||DateTime.UtcNow-recentPlayerCrime<TimeSpan.FromSeconds(20)};
            if(ped.IsInVehicle()){lease.VehicleHandle=ped.CurrentVehicle.Handle;lease.VehicleModel=ped.CurrentVehicle.Model.Hash;}
            string clip=null,dict="gestures@m@standing@casual";
            if(type=="INTIMIDATE"||type=="THREATEN_FROM_CAR")clip="gesture_bring_it_on";
            if(type=="HANDSHAKE_RESPECT")clip="gesture_bye_soft";
            if(type=="WAVE_OFF")clip="gesture_bye_soft";
            if(type=="APOLOGISE")clip="gesture_shrug_soft";
            if(type=="PLEAD"){dict="oddjobs@towingpleadingbase";clip="base";}
            if(type=="BEG"){dict="misstrevor2ig_5c";clip="plead_loop";}
            if(type=="SIT_DOWN_TALK"){dict="amb@world_human_picnic@male@base";clip="base";}
            if(type=="LEAN_AND_SMOKE"){dict="amb@world_human_leaning@male@wall@back@smoking@base";clip="base";}
            if(type=="ASK_FOR_RIDE")clip="gesture_come_here_soft";
            if(type=="SELL_TIP"||type=="GIVE_DIRECTIONS")clip="gesture_point";
            if(clip!=null){lease.Dictionary=dict;lease.Clip=clip;var animation=new CrClipDictionary(dict);if(!animation.Exists)return "Required game animation dictionary is unavailable.";animation.Request();}
            if(type=="CALL_FACTION_BACKUP"){lease.Resource=new Model(WorldDirector.ModelNames(director.Faction(ped))[0]);if(!lease.Resource.IsValid||!lease.Resource.IsPed)return "Backup model unavailable.";lease.Resource.Request();lease.ResourceRequested=true;}
            if(type=="OFFER_SIDE_GIG"){lease.Resource=new Model("prop_cs_cardbox_01");if(!lease.Resource.IsValid)return "Parcel model unavailable.";lease.Resource.Request();lease.ResourceRequested=true;}
            npcActions.Add(lease);return null;
        }
        private bool ActionEntityValid(ActionLease a,Ped player,bool vehicleRequired)
        {
            if(a.Epoch!=sceneEpoch||!WorldDirector.Alive(player)||!WorldDirector.Alive(a.Ped)||a.Ped.Handle!=a.Handle||a.Ped.Model.Hash!=a.Model||ScriptProtected(a.Ped)||a.Ped.Position.DistanceTo(player.Position)>Math.Max(30,npcSettings.Number("conversation.walkAwayMeters")))return false;
            if(vehicleRequired&&a.VehicleHandle!=0){var v=a.Ped.CurrentVehicle;if(!a.Ped.IsInVehicle()||v==null||!v.Exists()||v.Handle!=a.VehicleHandle||v.Model.Hash!=a.VehicleModel||v.IsPersistent)return false;}
            return true;
        }
        private void TickNpcActions(Ped player,string pause)
        {
            int starts=1;
            foreach(var owned in cleanupPeds.Take(2).ToArray())try{if(owned.Exists)owned.Ped.Delete();cleanupPeds.Remove(owned);}catch{ }
            foreach(var a in npcActions.ToArray())try{
                if(pause!=null||!ActionEntityValid(a,player,a.Type!="LEAVE_VEHICLE_TO_CONFRONT")||!npcSettings.Flag("action."+a.Type)){EndAction(a,"Action cancelled by scene, identity or settings change.");continue;}
                DateTime now=DateTime.UtcNow;
                if(!a.Started){if(now-a.Queued>TimeSpan.FromSeconds(3)){EndAction(a,"Action resources did not stream before deadline.");continue;}if(starts==0)continue;if(a.Dictionary!=null&&!new CrClipDictionary(a.Dictionary).IsLoaded)continue;if(a.ResourceRequested&&!a.Resource.IsLoaded)continue;starts--;StartNpcAction(a,player);continue;}
                if(a.Type=="CALL_911"&&a.Phase=="calling"&&now>=a.NextAt){if(a.Ped.GetScriptTaskStatus(ScriptTaskNameHash.UseMobilePhone)==ScriptTaskStatus.Performing&&ActionPolicy.MayRaiseWanted(npcSettings.Flag("safety.allowPoliceResponse"),(int)npcSettings.Number("safety.maxPoliceResponseWanted"),Game.Player.Wanted.WantedLevel,a.CrimeObserved)){Game.Player.Wanted.SetWantedLevel(Math.Min((int)npcSettings.Number("safety.maxPoliceResponseWanted"),Game.Player.Wanted.WantedLevel+1),false);Game.Player.Wanted.ApplyWantedLevelChangeNow(false);Emit("police_report","NPC completed a bounded phone report of observed player crime.",null,null);}a.Phase="reported";}
                if(a.Type=="CALL_FACTION_BACKUP"&&a.Backup.Count<2&&now>=a.NextAt){a.NextAt=now.AddMilliseconds(500);SpawnBackup(a,player);}
                if(a.Type=="LEAVE_VEHICLE_TO_CONFRONT"&&a.Phase=="exiting"&&!a.Ped.IsInVehicle()){a.Ped.Task.GoTo(player,new Vector3(0,2,0),Math.Min(5000,a.Duration));a.Task=ScriptTaskNameHash.GoToEntityOffset;a.Phase="confronting";}
                if(a.Type=="OFFER_SIDE_GIG")AdvanceErrand(a,player);
                if(now>=a.Until)EndAction(a,a.Type=="OFFER_SIDE_GIG"?"Errand timed out.":"Task duration ended.");
            }catch(Exception ex){EndAction(a,"Action failed: "+ex.GetType().Name);}
        }
        private void StartNpcAction(ActionLease a,Ped player)
        {
            Ped p=a.Ped;string type=a.Type;
            if(!ActionEntityValid(a,player,true)||!SafeVehicle(p,player))throw new InvalidOperationException("Action context changed before task start.");
            if(type=="LEAN_AND_SMOKE"){var ray=World.Raycast(p.Position+new Vector3(0,0,.8f),p.Position-p.ForwardVector*.9f+new Vector3(0,0,.8f),IntersectFlags.Map|IntersectFlags.Objects,p);if(!ray.DidHit||Math.Abs(ray.SurfaceNormal.Z)>.4f)throw new InvalidOperationException("No nearby wall supports a leaning pose.");}
            if(type=="SIT_DOWN_TALK"&&(!GroundDestination(p.Position,player.Position,Math.Max(3,p.Position.DistanceTo(player.Position)+1),out a.Destination,p.Handle)||World.GetNearbyVehicles(p.Position,3).Length>0))throw new InvalidOperationException("No clear safe sitting ground.");
            if(type=="ASK_FOR_RIDE"){var car=player.CurrentVehicle;if(!npcSettings.Flag("vehicles.lifts.enabled")||car==null||!car.Exists()||car.Speed>1||!car.IsSeatFree(VehicleSeat.Passenger))throw new InvalidOperationException("A stopped player vehicle with a free passenger seat is required; the request does not force entry.");}
            if(a.Dictionary!=null){if(!p.IsInVehicle())p.Task.TurnTo(player,600);var flags=AnimationFlags.AbortOnWeaponDamage;if(type!="SIT_DOWN_TALK"&&type!="BEG"&&type!="LEAN_AND_SMOKE")flags|=AnimationFlags.UpperBodyOnly|AnimationFlags.Secondary;p.Task.PlayAnimation(a.Dictionary,a.Clip,4,-4,a.Duration,flags,0);}
            else if(type=="TALK_CASUAL"){p.Task.LookAt(player,a.Duration);a.Task=ScriptTaskNameHash.LookAtEntity;if(!p.IsInVehicle()){p.Task.TurnTo(player,a.Duration);a.Task=ScriptTaskNameHash.TurnPedToFaceEntity;}}
            else if(type=="SURRENDER"){p.Task.HandsUp(a.Duration);a.Task=ScriptTaskNameHash.HandsUp;}
            else if(type=="FLEE_PANICKED"){p.Task.FleeFrom(player,35,a.Duration);a.Task=ScriptTaskNameHash.SmartFleePed;}
            else if(type=="TAKE_COVER"){Function.Call(Hash.TASK_SEEK_COVER_FROM_PED,p.Handle,player.Handle,a.Duration,false);a.Task=ScriptTaskNameHash.SeekCoverFromPed;}
            else if(type=="ATTACK_MELEE"){RememberWeapon(p,a.Duration,WeaponHash.Unarmed);p.Weapons.Select(WeaponHash.Unarmed,true);p.Task.CombatTimed(player,a.Duration,TaskCombatFlags.PreventChangingTarget);a.Task=ScriptTaskNameHash.CombatTimed;}
            else if(type=="DRAW_WEAPON"){Weapon weapon=p.Weapons.BestWeapon;if(weapon==null||weapon.Hash==WeaponHash.Unarmed)throw new InvalidOperationException("No existing weapon to draw.");RememberWeapon(p,a.Duration,weapon.Hash);p.Weapons.Select(weapon);p.Task.AimGunAtEntity(player,a.Duration,false);a.Task=ScriptTaskNameHash.AimGunAtEntity;}
            else if(type=="USE_PHONE"||type=="CALL_911"||type=="CALL_FACTION_BACKUP"){p.Task.UseMobilePhone(a.Duration);a.Phone=true;a.Task=ScriptTaskNameHash.UseMobilePhone;a.Phase="calling";a.NextAt=DateTime.UtcNow.AddMilliseconds(Math.Min(3000,a.Duration/2));}
            else if(type=="FOLLOW"){p.Task.FollowToOffsetFromEntity(player,new Vector3(1,-2,0),1,a.Duration,2,true);a.Task=ScriptTaskNameHash.FollowToOffsetOfEntity;}
            else if(type=="LEAD_TO"){if(!LocalDestination(p,player,15,out a.Destination))throw new InvalidOperationException("No nearby navigable destination.");p.Task.FollowNavMeshTo(a.Destination,null,a.Duration,1,FollowNavMeshFlags.KeepToPavements | FollowNavMeshFlags.NeverEnterWater,0);a.Task=ScriptTaskNameHash.FollowNavMeshToCoord;AddActionBlip(a,a.Destination,"Safe pavement meeting point");}
            else if(type=="OFFER_SIDE_GIG"){if(!LocalDestination(p,player,18,out a.Destination))throw new InvalidOperationException("No safe parcel location.");a.Parcel=World.CreateProp(a.Resource,a.Destination,false,true);if(a.Parcel==null||!a.Parcel.Exists())throw new InvalidOperationException("Parcel creation failed.");a.ParcelHandle=a.Parcel.Handle;a.ParcelModel=a.Parcel.Model.Hash;a.Parcel.IsPersistent=true;AddActionBlip(a,a.Destination,"Collect the parcel");p.Task.LookAt(a.Parcel,3000);a.Until=DateTime.UtcNow.AddSeconds(npcSettings.Number("director.scenarioTimeoutSeconds"));Caption("Errand: collect the marked parcel and return to this NPC.",6000);}
            else if(type=="HONK_AT_PLAYER"){if(p.CurrentVehicle.Driver==null||p.CurrentVehicle.Driver.Handle!=p.Handle)throw new InvalidOperationException("Only the current driver can honk.");Function.Call(Hash.START_VEHICLE_HORN,p.CurrentVehicle.Handle,Math.Min(1200,a.Duration),0,false);}
            else if(type=="LEAVE_VEHICLE_TO_CONFRONT"){if(p.CurrentVehicle.Speed>1)throw new InvalidOperationException("Vehicle must be stopped before exit.");p.Task.LeaveVehicle(p.CurrentVehicle,LeaveVehicleFlags.None);a.Task=ScriptTaskNameHash.LeaveVehicle;a.Phase="exiting";}
            else if(type=="DRIVE_AWAY"){if(p.CurrentVehicle.Driver==null||p.CurrentVehicle.Driver.Handle!=p.Handle||!p.CurrentVehicle.IsEngineRunning)throw new InvalidOperationException("A running, safe driver vehicle is required.");p.Task.CruiseWithVehicle(p.CurrentVehicle,Math.Min(8,(float)npcSettings.Number("conversation.vehicleMaxSpeed")+2),VehicleDrivingFlags.DrivingModeStopForVehicles);a.Task=ScriptTaskNameHash.VehicleDriveWander;}
            else throw new InvalidOperationException("No actual task mapped to action.");
            if(type=="SELL_TIP"||type=="GIVE_DIRECTIONS"){if(!LocalDestination(p,player,20,out a.Destination))throw new InvalidOperationException("No safe nearby pavement meeting point.");AddActionBlip(a,a.Destination,"Safe pavement meeting point");Caption("The NPC marked a nearby safe pavement meeting point.",4000);}
            a.Started=true;if(type!="OFFER_SIDE_GIG")a.Until=DateTime.UtcNow.AddMilliseconds(a.Duration);
            if(type!="CALL_FACTION_BACKUP")ActionOutcome(a,true,"Game task issued; physical completion is not implied.");
        }
        private void SpawnBackup(ActionLease a,Ped player)
        {
            if(director.OwnedCount+ActionOwnedCount>=director.Settings.maxSpawnedPeds||!npcSettings.Flag("combat.backupEnabled"))throw new InvalidOperationException("Backup population or setting limit reached.");
            Vector3 position;if(!GroundDestination(a.Ped.Position+new Vector3(a.Backup.Count==0?14:-14,8,0),player.Position,35,out position)||position.DistanceTo(player.Position)<8)throw new InvalidOperationException("No safe backup arrival position.");
            Ped p=World.CreatePed(a.Resource,position);if(p==null||!p.Exists()||!p.IsHuman)throw new InvalidOperationException("Backup spawn failed.");
            var owned=new WorldDirector.OwnedPed{Ped=p,Handle=p.Handle,Model=p.Model.Hash,Faction=director.Faction(a.Ped)};a.Backup.Add(owned);p.IsPersistent=true;p.BlockPermanentEvents=true;p.Task.FollowToOffsetFromEntity(a.Ped,new Vector3(a.Backup.Count==1?2:-2,-2,0),2,Math.Min(15000,a.Duration),2,true);
            if(a.Backup.Count==2)ActionOutcome(a,true,"Two owned backup NPCs spawned and received arrival tasks.");
        }
        private void AdvanceErrand(ActionLease a,Ped player)
        {
            if(!a.PickedUp&&a.Parcel!=null&&a.Parcel.Exists()&&a.Parcel.Handle==a.ParcelHandle&&a.Parcel.Model.Hash==a.ParcelModel&&player.Position.DistanceTo(a.Parcel.Position)<2){a.Parcel.Delete();a.Parcel=null;a.PickedUp=true;if(a.Blip!=null&&a.Blip.Exists())a.Blip.Delete();a.Blip=a.Ped.AddBlip();a.Blip.Name="Return the parcel";Caption("Parcel collected. Return to the marked NPC.",4000);}
            if(a.PickedUp&&player.Position.DistanceTo(a.Ped.Position)<2.5f){Witness("deal",a.Ped);Emit("side_gig_completed","Parcel returned to the same NPC.",null,director.Faction(a.Ped));Caption("Errand complete: parcel returned.",4500);EndAction(a,"Errand completed.");}
        }
        private bool LocalDestination(Ped ped,Ped player,float radius,out Vector3 destination){for(int i=0;i<4;i++){double angle=i*Math.PI/2;Vector3 requested=ped.Position+new Vector3((float)Math.Cos(angle)*radius,(float)Math.Sin(angle)*radius,0);if(GroundDestination(requested,player.Position,radius+20,out destination)&&destination.DistanceTo(ped.Position)>5)return true;}destination=Vector3.Zero;return false;}
        private static bool GroundDestination(Vector3 requested,Vector3 player,float maxDistance,out Vector3 result,int excludedPed=0)
        {result=Vector3.Zero;Vector3 safe;if(!World.GetSafePositionForPed(requested,out safe,GetSafePositionFlags.OnlyPavement|GetSafePositionFlags.NotInterior|GetSafePositionFlags.NotWater))return false;float ground;if(!World.GetGroundHeight(safe+new Vector3(0,0,3),out ground,GetGroundHeightMode.Normal)||Math.Abs(ground-safe.Z)>2.5||safe.DistanceTo(requested)>12||safe.DistanceTo(player)>maxDistance||World.GetNearbyVehicles(safe,2).Length>0||World.GetNearbyPeds(safe,1.3f).Any(p=>p.Handle!=excludedPed))return false;safe.Z=ground;result=safe;return true;}
        private void AddActionBlip(ActionLease a,Vector3 position,string name){if(a.Blip!=null&&a.Blip.Exists())a.Blip.Delete();a.Blip=World.CreateBlip(position);a.Blip.Name=name;a.Blip.Color=BlipColor.Yellow;}
        private void ActionOutcome(ActionLease a,bool applied,string message){if(a.Replied)return;a.Replied=true;RecordActionOutcome(a.Id,a.JobId,applied,message);}
        private void RecordActionOutcome(string id,string jobId,bool applied,string message){if(id==null)return;aiOutcomes.RemoveAll(x=>(string)x["actionId"]==id);if(aiOutcomes.Count>=128)aiOutcomes.RemoveAt(0);aiOutcomes.Add(new Dictionary<string,object>{{"actionId",id},{"jobId",jobId},{"status",applied?"applied":"rejected"},{"message",ResponsePolicy.CleanText(message,240)}});}
        private void EndAction(ActionLease a,string reason)
        {
            Func<bool> sameActor=()=>a.Ped!=null&&a.Ped.Exists()&&a.Ped.Handle==a.Handle&&a.Ped.Model.Hash==a.Model&&!ScriptProtected(a.Ped);
            var releases=new List<Action>{
                ()=>{if(!a.Replied)ActionOutcome(a,false,reason);},
                ()=>{if(sameActor()&&a.Dictionary!=null&&Function.Call<bool>(Hash.IS_ENTITY_PLAYING_ANIM,a.Handle,a.Dictionary,a.Clip,3))a.Ped.Task.StopScriptedAnimationTask(new CrClipAsset(a.Dictionary,a.Clip),null);},
                ()=>{if(sameActor()&&a.Phone&&a.Ped.GetScriptTaskStatus(ScriptTaskNameHash.UseMobilePhone)==ScriptTaskStatus.Performing)a.Ped.Task.PutAwayMobilePhone();},
                ()=>{if(sameActor()&&a.Task.HasValue&&a.Ped.GetScriptTaskStatus(a.Task.Value)==ScriptTaskStatus.Performing){if(a.Task==ScriptTaskNameHash.LookAtEntity)a.Ped.Task.ClearLookAt();else a.Ped.Task.ClearAll();}},
                ()=>{if(a.Dictionary!=null)new CrClipDictionary(a.Dictionary).MarkAsNoLongerNeeded();},
                ()=>{if(a.ResourceRequested)a.Resource.MarkAsNoLongerNeeded();},
                ()=>{if(a.Blip!=null&&a.Blip.Exists())a.Blip.Delete();},
                ()=>{if(a.Parcel!=null&&a.Parcel.Exists()&&a.Parcel.Handle==a.ParcelHandle&&a.Parcel.Model.Hash==a.ParcelModel)a.Parcel.Delete();}
            };
            foreach(var owned in a.Backup){var entry=owned;releases.Add(()=>{try{if(entry.Exists)entry.Ped.Delete();}catch{if(!cleanupPeds.Contains(entry))cleanupPeds.Add(entry);throw;}});}
            int failures=0;
            CleanupPolicy.Run(releases,ex=>{if(failures++<3)Log("Action cleanup "+a.Type+": "+ex.GetType().Name);},()=>npcActions.Remove(a));
            Emit("npc_action_ended",a.Type+": "+reason,null,null);
        }        private void ClearNpcActions(string reason){foreach(var action in npcActions.ToArray())EndAction(action,reason);}
    }
}



