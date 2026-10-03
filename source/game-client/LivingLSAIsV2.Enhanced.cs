using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Text;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using GTA;
using GTA.Math;
using GTA.Native;
using Screen=GTA.UI.Screen;
[assembly: System.Reflection.AssemblyTitle("Living Los Santos 3 Enhanced World Director")]
[assembly: System.Reflection.AssemblyVersion("3.0.1.0")]
[assembly: System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.8")]
namespace LivingLosSantosV2
{
    public sealed class EnhancedClient : Script
    {
        private const string PluginVersion="3.0.1-enhanced";
        private readonly string runtimeId="lls3-"+Guid.NewGuid().ToString("N");
        private readonly DashboardTransport transport=new DashboardTransport("http://127.0.0.1:3000/");
        private readonly CancellationTokenSource cancellation=new CancellationTokenSource();
        private readonly ConcurrentQueue<Completion> completed=new ConcurrentQueue<Completion>();
        private readonly JavaScriptSerializer serializer=new JavaScriptSerializer {MaxJsonLength=131072,RecursionLimit=24};
        private readonly CommandGate commands=new CommandGate();
        private readonly List<Dictionary<string,object>> pendingEvents=new List<Dictionary<string,object>>(), acknowledgements=new List<Dictionary<string,object>>();
        private readonly Dictionary<int,NpcMemory> memories=new Dictionary<int,NpcMemory>();
        private readonly Dictionary<string,SeenNpc> seen=new Dictionary<string,SeenNpc>();
        private readonly string dataDirectory=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"LivingLosSantos","Enhanced");
        private readonly DateTime readyAt=DateTime.UtcNow.AddSeconds(15);
        private WorldDirector director;
        private CampaignStore campaign;
        private volatile bool stopping;
        private bool dialoguePending,exchangePending,promptRequested,toggleRequested,storyModeReady;
        private SeenNpc keyboardTarget;
        private int appliedRevision=-1;
        private DateTime nextExchange=DateTime.MinValue,nextErrorLog=DateTime.MinValue;
        private readonly object saveLock=new object();
        private string latestCampaign;
        private bool saveRunning;
        private sealed class NpcMemory { public Ped Ped; public int Model; public DateTime LastUsed; public readonly List<Dictionary<string,object>> History=new List<Dictionary<string,object>>(); public string Note=""; }
        private sealed class SeenNpc { public Ped Ped; public int Handle,Model; public DateTime At; }
        private sealed class Completion
        { public bool Dialogue; public Ped Ped; public int Handle,Model; public string Error,Utterance; public string[] EventIds,AckIds; public Dictionary<string,object> Response; }
        public EnhancedClient()
        {
            if(!String.Equals(System.Diagnostics.Process.GetCurrentProcess().ProcessName,"GTA5_Enhanced",StringComparison.OrdinalIgnoreCase)) { stopping=true; transport.Dispose(); return; }
            director=new WorldDirector(Emit,Acknowledge,SaveCampaign);
            campaign=new CampaignStore(Path.Combine(dataDirectory,"campaign-v3.json"));
            try { director.Settings=campaign.Load(director.Territories); }
            catch(Exception ex) { Log("Campaign restore rejected: "+ex.GetType().Name); try { Log("Rejected campaign preserved at "+campaign.PreserveRejected()); } catch { campaign=null; Log("Unable to preserve rejected campaign; campaign writes disabled this session."); } Emit("campaign_warning","Campaign restore rejected; original data preserved. Defaults are active.",null,null); }
            Tick+=OnTick; KeyDown+=OnKeyDown; Aborted+=OnAborted;
            Log("Client "+PluginVersion+" started; protocol3; 15 second readiness grace.");
        }
        private void OnKeyDown(object sender,KeyEventArgs args)
        {
            if(stopping||!storyModeReady) return;
            if(args.KeyCode==Keys.F7&&!dialoguePending&&keyboardTarget==null) promptRequested=true;
            if(args.KeyCode==Keys.F8) toggleRequested=true;
        }
        private void OnTick(object sender,EventArgs args)
        {
            if(stopping) return;
            try
            {
                // All native functions and GTA entity access execute on the script Tick thread.
                if(Function.Call<bool>(Hash.NETWORK_IS_GAME_IN_PROGRESS)||Function.Call<bool>(Hash.NETWORK_IS_SESSION_ACTIVE)) { Log("Online session detected; disposing Story Mode director."); OnAborted(this,EventArgs.Empty); return; }
                DateTime now=DateTime.UtcNow;
                Ped player=Game.Player.Character;
                string pause=WorldDirector.ScenePause(player,director.Settings);
                if(keyboardTarget!=null&&pause=="Player control unavailable") pause="Dialogue keyboard open";
                if(now<readyAt) pause="Starting director: waiting for Story Mode to settle";
                storyModeReady=pause==null;
                if(toggleRequested) { toggleRequested=false; if(storyModeReady) { director.Toggle(); Caption("Street director "+(director.Settings.enabled?"ON":"OFF"),2500); } }
                PollKeyboard(player);
                DrainCompleted(player,pause);
                director.Tick(player,pause);
                if(storyModeReady&&promptRequested)
                {
                    promptRequested=false;
                    Ped target=World.GetNearbyPeds(player,5).Where(p=>Interactable(p,player,5)).OrderBy(p=>p.Position.DistanceToSquared(player.Position)).FirstOrDefault();
                    if(target==null) Caption("Stand within 5 metres of a pedestrian on foot.",3000);
                    else { keyboardTarget=new SeenNpc{Ped=target,Handle=target.Handle,Model=target.Model.Hash,At=now}; Function.Call(Hash.DISPLAY_ONSCREEN_KEYBOARD,0,"FMMC_KEY_TIP8","","","","","",240); }
                }
                if(!exchangePending&&now>=nextExchange) { nextExchange=now.AddSeconds(1); Exchange(player); }
            }
            catch(Exception ex)
            {
                promptRequested=false;
                if(DateTime.UtcNow>=nextErrorLog) { nextErrorLog=DateTime.UtcNow.AddSeconds(10); Log("Tick failure "+ex.GetType().Name+" at "+(ex.TargetSite==null?"unknown":ex.TargetSite.DeclaringType.FullName+"."+ex.TargetSite.Name)); Emit("runtime_error","A director operation failed. See the local diagnostic log.",null,null); }
                try { director.Clear("Encounter cancelled after runtime error"); } catch { Log("Cleanup requires script abort or game exit."); }
            }
        }
        private bool Interactable(Ped ped,Ped player,float range)
        { return WorldDirector.Alive(player)&&WorldDirector.Alive(ped)&&ped.Handle!=player.Handle&&ped.IsHuman&&(!ped.IsPersistent||director.IsOwned(ped))&&!ped.IsInVehicle()&&!ped.IsInCombat&&ped.Position.DistanceTo(player.Position)<=range; }
        private string NpcId(Ped ped) { return runtimeId+":"+ped.Handle+":"+ped.Model.Hash; }
        private void StartDialogue(Ped target,Ped player,string utterance,string command)
        {
            if(dialoguePending) { if(command!=null) Acknowledge(command,false,"Another dialogue request is pending."); return; }
            NpcMemory memory=Memory(target,true);
            var packet=new Dictionary<string,object>{{"npc",Describe(target)},{"player",DescribePlayer(player)},{"environment",DescribeEnvironment(player)},{"playerUtterance",utterance},{"history",memory.History.ToArray()}};
            dialoguePending=true;
            Send("api/dialogue",serializer.Serialize(packet),new Completion {Dialogue=true,Ped=target,Handle=target.Handle,Model=target.Model.Hash,Utterance=utterance});
            if(command!=null) Acknowledge(command,true,"Dialogue dispatched. The result will appear as a world event.");
            Caption("Waiting for the NPC reply...",1800);
        }
        private void DrainCompleted(Ped player,string pause)
        {
            Completion item;
            while(completed.TryDequeue(out item))
            {
                if(item.Dialogue)
                {
                    dialoguePending=false;
                    if(item.Error!=null) { Emit("dialogue_failed",item.Error,null,null); Caption(item.Error,3500); continue; }
                    Ped target=item.Ped;
                    if(pause!=null||!WorldDirector.Alive(player)||target==null||!target.Exists()||target.Handle!=item.Handle||target.Model.Hash!=item.Model||!Interactable(target,player,12)) { Emit("dialogue_discarded","The pedestrian moved away or changed state before replying.",null,null); continue; }
                    try
                    {
                        var response=ResponsePolicy.ParseResult(item.Response); object rawAction; response.TryGetValue("action",out rawAction);
                        string note=ApplyDialogueAction(target,player,ResponsePolicy.Action(rawAction)), speech=ResponsePolicy.CleanText(response["speech"],420);
                        NpcMemory memory=Memory(target,true);
                        memory.History.Add(new Dictionary<string,object>{{"role","player"},{"text",item.Utterance}}); memory.History.Add(new Dictionary<string,object>{{"role","npc"},{"text",speech}});
                        while(memory.History.Count>12) memory.History.RemoveAt(0);
                        object memoryNote; if(response.TryGetValue("memoryNote",out memoryNote)) memory.Note=ResponsePolicy.CleanText(memoryNote,400);
                        Caption("NPC ["+ResponsePolicy.SourceLabel(item.Response)+"]: "+speech+(note.Length==0?"":" ["+note+"]"),10000);
                        Emit("dialogue","NPC "+target.Handle+" ["+ResponsePolicy.SourceLabel(item.Response)+"]: "+speech,null,director.Faction(target));
                    }
                    catch(InvalidOperationException) { Emit("dialogue_failed","The local director returned an invalid dialogue result.",null,null); }
                    continue;
                }
                exchangePending=false;
                if(item.Error!=null) { if(DateTime.UtcNow>=nextErrorLog) { nextErrorLog=DateTime.UtcNow.AddSeconds(20); Log(item.Error); } continue; }
                try
                {
                    if(!Wire.Boolean(item.Response,"success")||Wire.Integer(item.Response,"protocol",3,3)!=3) throw new InvalidOperationException("Protocol mismatch.");
                    pendingEvents.RemoveAll(e=>item.EventIds.Contains((string)e["id"])); acknowledgements.RemoveAll(e=>item.AckIds.Contains((string)e["id"]));
                    var config=Wire.Map(Wire.Value(item.Response,"config")); int revision=Wire.Integer(config,"revision",0,Int32.MaxValue);
                    if(revision!=appliedRevision)
                    { DirectorSettings settings=DirectorSettings.Parse(Wire.Map(Wire.Value(config,"settings"))); director.Apply(settings); appliedRevision=revision; Emit("settings_applied","Director settings revision "+revision+" applied in game.",null,null); }
                    foreach(var command in Wire.Maps(Wire.Value(item.Response,"commands")).Take(32)) Dispatch(command,player,pause);
                }
                catch(Exception ex) { Log("Exchange response rejected: "+ex.GetType().Name); }
            }
        }
        private void Dispatch(Dictionary<string,object> command,Ped player,string pause)
        {
            string id=null;
            try
            {
                id=Wire.Text(command,"id",128); string error;
                if(!commands.TryClaim(command,runtimeId,DateTime.UtcNow,out error)) { if(error!=null) Acknowledge(id,false,error); return; }
                string type=Wire.Text(command,"type",32); var payload=Wire.Map(Wire.Value(command,"payload"));
                if(type=="clear_events") { director.Clear("Cleared from the live portal"); Acknowledge(id,true,"Owned encounters cleared."); return; }
                if(pause!=null||!WorldDirector.Alive(player)) { Acknowledge(id,false,pause??"Player unavailable."); return; }
                if(type=="start_turf_war") { error=director.StartTurf(player,Wire.Text(payload,"districtId",32),Wire.Text(payload,"attacker",32),id,Wire.Timestamp(command,"expiresAt")); if(error!=null) Acknowledge(id,false,error); return; }
                if(type=="start_street_fight") { error=director.StartStreet(player,id,Wire.Timestamp(command,"expiresAt")); if(error!=null) Acknowledge(id,false,error); return; }
                if(type=="set_time") { int hour=Wire.Integer(payload,"hour",0,23); GTA.Chrono.GameClock.Hour=hour; GTA.Chrono.GameClock.Minute=0; Acknowledge(id,true,"Game clock set to "+hour.ToString("D2")+":00."); return; }
                if(type=="set_wanted") { int level=Wire.Integer(payload,"level",0,5); Game.Player.Wanted.SetWantedLevel(level,false); Game.Player.Wanted.ApplyWantedLevelChangeNow(false); Acknowledge(id,true,"Wanted level set to "+level+"."); return; }
                if(type=="set_weather")
                {
                    string name=Wire.Text(payload,"weather",16);
                    var names=new Dictionary<string,Weather>{{"CLEAR",Weather.Clear},{"EXTRASUNNY",Weather.ExtraSunny},{"CLOUDS",Weather.Clouds},{"OVERCAST",Weather.Overcast},{"RAIN",Weather.Raining},{"THUNDER",Weather.ThunderStorm},{"FOGGY",Weather.Foggy},{"SMOG",Weather.Smog}};
                    Weather weather; if(!names.TryGetValue(name,out weather)) throw new InvalidOperationException("Unsupported weather."); World.Weather=weather; Acknowledge(id,true,"Weather set to "+name+"."); return;
                }
                if(type=="talk")
                {
                    string npcId=Wire.Text(payload,"npcId",128), text=ResponsePolicy.CleanText(Wire.Text(payload,"text",240),240); SeenNpc target;
                    if(!seen.TryGetValue(npcId,out target)||DateTime.UtcNow-target.At>TimeSpan.FromSeconds(5)||!target.Ped.Exists()||target.Ped.Handle!=target.Handle||target.Ped.Model.Hash!=target.Model||!target.Ped.IsOnScreen||!Interactable(target.Ped,player,12)) { Acknowledge(id,false,"NPC is no longer visible, nearby, or available for conversation."); return; }
                    StartDialogue(target.Ped,player,text,id); return;
                }
                Acknowledge(id,false,"Unsupported game command.");
            }
            catch(Exception ex) { if(id!=null) Acknowledge(id,false,ex is InvalidOperationException?ex.Message:"Game command could not be applied."); Log("Command rejected: "+ex.GetType().Name); }
        }
        private void Exchange(Ped player)
        {
            DateTime now=DateTime.UtcNow;
            foreach(int handle in memories.Where(m=>!m.Value.Ped.Exists()||m.Value.Ped.Model.Hash!=m.Value.Model||now-m.Value.LastUsed>TimeSpan.FromMinutes(10)).Select(m=>m.Key).ToArray()) memories.Remove(handle);
            foreach(string id in seen.Where(s=>now-s.Value.At>TimeSpan.FromSeconds(10)).Select(s=>s.Key).ToArray()) seen.Remove(id);
            var npcs=new List<Dictionary<string,object>>(); bool available=WorldDirector.Alive(player)&&!Function.Call<bool>(Hash.IS_SCREEN_FADED_OUT);
            if(available)
            {
                var nearby=World.GetNearbyPeds(player,75).Where(p=>p.Exists()&&p.IsHuman&&p.Handle!=player.Handle);
                var all=director.Peds.Where(p=>p.Exists).Select(p=>p.Ped).Concat(nearby).GroupBy(p=>p.Handle).Select(g=>g.First()).OrderBy(p=>p.Position.DistanceToSquared(player.Position)).Take(40);
                foreach(Ped ped in all) { npcs.Add(Describe(ped)); if(ped.IsAlive&&ped.IsOnScreen) seen[NpcId(ped)]=new SeenNpc{Ped=ped,Handle=ped.Handle,Model=ped.Model.Hash,At=now}; }
            }
            var events=pendingEvents.Take(50).ToArray(); var acks=acknowledgements.Take(50).ToArray();
            var packet=new Dictionary<string,object>{{"protocol",3},{"runtimeId",runtimeId},{"pluginVersion",PluginVersion},{"gameVersion",Game.FileVersion.ToString()},
                {"appliedRevision",Math.Max(0,appliedRevision)},{"player",available?DescribePlayer(player):null},{"environment",available?DescribeEnvironment(player):null},
                {"npcs",npcs.ToArray()},{"director",director.Snapshot()},{"events",events},{"acknowledgements",acks}};
            string json=serializer.Serialize(packet);
            // The server's limit is UTF-8 bytes, while JavaScriptSerializer limits characters.
            // Keep unsent acknowledgements/events queued; send a smaller observed NPC subset if required.
            while(Encoding.UTF8.GetByteCount(json)>120000)
            {
                if(events.Length>0) { events=events.Take(events.Length/2).ToArray(); packet["events"]=events; }
                else if(acks.Length>0) { acks=acks.Take(acks.Length/2).ToArray(); packet["acknowledgements"]=acks; }
                else if(npcs.Count>0) { npcs.RemoveAt(npcs.Count-1); packet["npcs"]=npcs.ToArray(); }
                else throw new InvalidOperationException("World snapshot exceeded the local exchange budget.");
                json=serializer.Serialize(packet);
            }
            exchangePending=true;
            Send("api/runtime/exchange",json,new Completion{EventIds=events.Select(e=>(string)e["id"]).ToArray(),AckIds=acks.Select(e=>(string)e["id"]).ToArray()});
        }
        private Dictionary<string,object> Describe(Ped ped)
        {
            NpcMemory memory=Memory(ped,false); string faction=director.Faction(ped);
            return new Dictionary<string,object>{{"id",NpcId(ped)},{"name",(faction=="Civilian/Unknown"?"Pedestrian":faction)+" "+ped.Handle},{"faction",faction},{"factionVerified",faction!="Civilian/Unknown"},
                {"archetype",faction=="Civilian/Unknown"?"Nearby pedestrian; affiliation unknown":"Observed "+faction+" pedestrian"},{"position",Position(ped.Position)},{"health",ped.Health},{"alive",ped.IsAlive},
                {"modelHash",ped.Model.Hash},{"inCombat",ped.IsInCombat},{"owned",director.IsOwned(ped)},{"weapon",ped.Weapons.Current.Hash.ToString()},{"memory",memory==null?"":memory.Note}};
        }
        private NpcMemory Memory(Ped ped,bool create)
        {
            NpcMemory memory;
            if(memories.TryGetValue(ped.Handle,out memory)&&memory.Model!=ped.Model.Hash) { memories.Remove(ped.Handle); memory=null; }
            if(memory==null&&create) { if(memories.Count>=32) memories.Remove(memories.OrderBy(m=>m.Value.LastUsed).First().Key); memory=new NpcMemory{Ped=ped,Model=ped.Model.Hash}; memories[ped.Handle]=memory; }
            if(memory!=null&&create) memory.LastUsed=DateTime.UtcNow; return memory;
        }
        private static object Position(Vector3 p) { return new {x=p.X,y=p.Y,z=p.Z}; }
        private void PollKeyboard(Ped player)
        {
            if(keyboardTarget==null) return;
            int state=Function.Call<int>(Hash.UPDATE_ONSCREEN_KEYBOARD);
            if(state==0) return;
            SeenNpc target=keyboardTarget; keyboardTarget=null;
            if(state!=1) return;
            string text=ResponsePolicy.CleanText(Function.Call<string>(Hash.GET_ONSCREEN_KEYBOARD_RESULT),240);
            if(text.Length>0&&WorldDirector.Alive(player)&&target.Ped.Exists()&&target.Ped.Handle==target.Handle&&target.Ped.Model.Hash==target.Model&&Interactable(target.Ped,player,12)&&(!director.Settings.protectMissions||!Game.IsMissionActive))
                StartDialogue(target.Ped,player,text,null);
        }
        private static object DescribePlayer(Ped p) { return new {wantedLevel=Game.Player.Wanted.WantedLevel,weaponDrawn=p.IsArmed(WeaponCheckFlags.IncludeGun),position=Position(p.Position)}; }
        private static object DescribeEnvironment(Ped p) { return new {weather=World.Weather.ToString(),timeOfDay=GTA.Chrono.GameClock.Hour+":"+GTA.Chrono.GameClock.Minute.ToString("D2"),district=World.GetZoneLocalizedName(p.Position)}; }
        private void Send(string route,string json,Completion completion)
        {
            // Immutable JSON crosses into this worker; all GTA calls remain on Tick.
            Task.Run(async delegate {
                try { completion.Response=await transport.PostAsync(route,json,cancellation.Token).ConfigureAwait(false); }
                catch(OperationCanceledException) { completion.Error="Local request cancelled or timed out."; }
                catch(InvalidOperationException ex) { completion.Error=ex.Message; }
                catch(Exception) { completion.Error="Local companion unavailable; autonomous world director continues."; }
                if(!stopping) completed.Enqueue(completion);
            });
        }
        private void Emit(string type,string message,string district,string faction)
        {
            if(type=="encounter_ended"&&message.Contains("Spawn ")) Log(ResponsePolicy.CleanText(message,240));
            if(pendingEvents.Count>=100) pendingEvents.RemoveAt(0);
            pendingEvents.Add(new Dictionary<string,object>{{"id",Guid.NewGuid().ToString("N")},{"at",DateTime.UtcNow.ToString("o")},{"type",type},{"message",ResponsePolicy.CleanText(message,240)},{"districtId",district},{"faction",faction}});
            if(director!=null&&(type=="encounter_started"||type=="turf_result")) Caption(message,5000);
        }
        private void Acknowledge(string id,bool applied,string message)
        { acknowledgements.RemoveAll(a=>(string)a["id"]==id); if(acknowledgements.Count>=128) acknowledgements.RemoveAt(0); acknowledgements.Add(new Dictionary<string,object>{{"id",id},{"status",applied?"applied":"rejected"},{"message",ResponsePolicy.CleanText(message,240)}}); }
        private void Caption(string message,int duration) { if(director!=null&&director.Settings.subtitles) Screen.ShowSubtitle("LLS: "+message,duration); }
        private static string ApplyDialogueAction(Ped target,Ped player,string action)
        {
            if(!ResponsePolicy.IsSupportedAction(action)) return "Dialogue suggestion; no game action";
            if(action=="SURRENDER") target.Task.HandsUp(5000);
            else if(action=="FLEE_PANICKED") target.Task.FleeFrom(player,35,8000);
            else if(action=="TAKE_COVER") Function.Call(Hash.TASK_SEEK_COVER_FROM_PED,target.Handle,player.Handle,5000,false);
            else if(action=="ATTACK_MELEE") { target.Weapons.Select(WeaponHash.Unarmed,true); target.Task.CombatTimed(player,5000,TaskCombatFlags.PreventChangingTarget); }
            else if(action=="DRAW_WEAPON") { Weapon weapon=target.Weapons.BestWeapon; if(weapon==null||weapon.Hash==WeaponHash.Unarmed) return "No existing weapon to draw"; target.Weapons.Select(weapon); target.Task.AimGunAtEntity(player,3000,false); }
            else if(action=="INTIMIDATE") target.Task.LookAt(player,2000); else target.Task.TurnTo(player,1500); return "";
        }
        private void SaveCampaign()
        {
            if(campaign==null||director==null) return;
            string snapshot=campaign.Serialize(director.Territories,director.Settings);
            lock(saveLock) { latestCampaign=snapshot; if(saveRunning) return; saveRunning=true; }
            // Single writer consumes the newest snapshot in order; an older task cannot overwrite a newer save.
            Task.Run(delegate {
                while(true) { string data; lock(saveLock) { data=latestCampaign; latestCampaign=null; if(data==null) {saveRunning=false;return;} } try { campaign.Save(data); } catch(Exception ex) { Log("Campaign save failed: "+ex.GetType().Name); } }
            });
        }
        private void Log(string message)
        {
            try { lock(saveLock) { Directory.CreateDirectory(dataDirectory); string path=Path.Combine(dataDirectory,"director.log"); if(File.Exists(path)&&new FileInfo(path).Length>262144) File.WriteAllText(path,""); File.AppendAllText(path,DateTime.UtcNow.ToString("o")+" "+message+Environment.NewLine); } } catch { }
        }
        private void OnAborted(object sender,EventArgs args)
        {
            if(stopping) return;
            stopping=true; storyModeReady=false; promptRequested=false;
            try { director.Dispose(); SaveCampaign(); } catch(Exception ex) { Log("Abort cleanup: "+ex.GetType().Name); }
            cancellation.Cancel(); transport.Dispose(); Completion item; while(completed.TryDequeue(out item)) {}
            memories.Clear(); seen.Clear(); Log("Director stopped.");
        }
    }
}
