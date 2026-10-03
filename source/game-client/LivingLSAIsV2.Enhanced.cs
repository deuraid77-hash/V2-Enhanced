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
[assembly: System.Reflection.AssemblyTitle("Living Los Santos 4 Enhanced NPC Foundation")]
[assembly: System.Reflection.AssemblyVersion("4.0.0.0")]
[assembly: System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.8")]
namespace LivingLosSantosV2
{
    public sealed partial class EnhancedClient : Script
    {
        private const string PluginVersion="4.0.0-mind-enhanced";
        private readonly string runtimeId="lls4-"+Guid.NewGuid().ToString("N");
        private string sceneEpoch=Guid.NewGuid().ToString("N"), registeredEpoch;
        private readonly NpcSettingsState npcSettings=new NpcSettingsState();
        private readonly InputRouter input=new InputRouter();
        private readonly AiUpdateGate updateGate=new AiUpdateGate();
        private readonly HashSet<string> executedActions=new HashSet<string>();
        private readonly TickMetrics metrics=new TickMetrics();
        private RuntimeCompatibility compatibility;
        private readonly List<string> aiReceipts=new List<string>();
        private readonly List<Dictionary<string,object>> aiOutcomes=new List<Dictionary<string,object>>();
        private readonly Dictionary<string,int> factionStandings=new Dictionary<string,int>(),districtStandings=new Dictionary<string,int>();
        private ActiveJob conversation;
        private int sentFrame,acceptedFrame;
        private readonly List<WeaponLease> weaponLeases=new List<WeaponLease>();
        private string lastHardPause;
        private int lastPlayerHandle;
        private bool panic;
        private DateTime keyboardReleasedUntil=DateTime.MinValue, recentGunfire=DateTime.MinValue, nextScan=DateTime.MinValue;
        private readonly List<Dictionary<string,object>> observedNpcs=new List<Dictionary<string,object>>();
        private readonly Queue<Ped> scanCandidates=new Queue<Ped>();
        private DateTime lastScanStarted=DateTime.MinValue;
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
        private sealed class NpcMemory { public Ped Ped; public int Model,LastHealth; public DateTime LastUsed; public readonly List<Dictionary<string,object>> History=new List<Dictionary<string,object>>(); public string Note=""; public readonly NpcMind Mind=new NpcMind();public Dictionary<string,object> Identity;public MindHydration Hydration; }
        private sealed class SeenNpc { public Ped Ped; public int Handle,Model; public DateTime At; }
        private sealed class ActiveJob { public Ped Ped; public int Handle,Model,RequiredFrame,Attempts; public string RequestId=Guid.NewGuid().ToString(),JobId,Epoch,NpcId,Utterance,QuickJobId,QuickOptionId; public Dictionary<string,object>[] History; public DateTime Deadline,NextSubmit; public bool Submitted; }
        private sealed class WeaponLease { public Ped Ped; public int Handle,Model; public WeaponHash Original,Selected; public DateTime Until; }
        private sealed class Completion
        { public bool Job; public int Frame; public string Error,Epoch,RequestId,Kind; public string[] EventIds,AckIds,ReceiptIds,OutcomeIds,MindOutcomeIds,WitnessIds; public Dictionary<string,object> Response; }
        public EnhancedClient()
        {
            if(!String.Equals(System.Diagnostics.Process.GetCurrentProcess().ProcessName,"GTA5_Enhanced",StringComparison.OrdinalIgnoreCase)) { stopping=true; transport.Dispose(); return; }
            string executable=System.Diagnostics.Process.GetCurrentProcess().MainModule.FileName;
            compatibility=RuntimeCompatibility.Inspect(executable,Path.Combine(Path.GetDirectoryName(executable),"ScriptHookVDotNet3.dll"));
            director=new WorldDirector(Emit,Acknowledge,SaveCampaign);
            director.ExternalPedCount=()=>ActionOwnedCount;
            campaign=new CampaignStore(Path.Combine(dataDirectory,"campaign-v3.json"));
            try { director.Settings=campaign.Load(director.Territories); }
            catch(Exception ex) { Log("Campaign restore rejected: "+ex.GetType().Name); try { Log("Rejected campaign preserved at "+campaign.PreserveRejected()); } catch { campaign=null; Log("Unable to preserve rejected campaign; campaign writes disabled this session."); } Emit("campaign_warning","Campaign restore rejected; original data preserved. Defaults are active.",null,null); }
            Tick+=OnTick; KeyDown+=OnKeyDown; Aborted+=OnAborted;
            InitializeMenu();
            Log("Client "+PluginVersion+" started; protocol4; EXE "+compatibility.GameFileVersion+"; SDK "+compatibility.ApiVersion+"; tested="+compatibility.Supported+"; 15 second readiness grace.");
        }
        private void OnKeyDown(object sender,KeyEventArgs args)
        {
            if(stopping)return;
            if(replyWheel&&args.KeyCode.ToString()!=npcSettings.Text("controls.panicKey")&&args.KeyCode.ToString()!=npcSettings.Text("controls.menuKey")){if(replyKeys.Count<24)replyKeys.Enqueue(args.KeyCode);return;}
            if(nativeMenu!=null&&nativeMenu.IsOpen&&args.KeyCode.ToString()!=npcSettings.Text("controls.panicKey")){if(!nativeMenu.KeyboardOpen)nativeMenu.Queue(args.KeyCode);return;}
            input.Queue(args.KeyCode);
        }
        private void OnTick(object sender,EventArgs args)
        {
            if(stopping) return;
            metrics.Begin();
            try
            {
                // All native functions and GTA entity access execute on the script Tick thread.
                if(Function.Call<bool>(Hash.NETWORK_IS_GAME_IN_PROGRESS)||Function.Call<bool>(Hash.NETWORK_IS_SESSION_ACTIVE)) { Log("Online session detected; disposing Story Mode director."); OnAborted(this,EventArgs.Empty); return; }
                DateTime now=DateTime.UtcNow;
                Ped player=Game.Player.Character;
                string pause=EffectivePause(player);
                storyModeReady=pause==null;
                UpdateScene(player,pause);
                bool canMenu=nativeMenu.IsOpen||CanOpenMenu(player);
                foreach(string action in input.Poll(npcSettings,keyboardTarget!=null||nativeMenu.KeyboardOpen,storyModeReady&&!nativeMenu.IsOpen&&canMenu,canMenu)) {
                    if(action=="panic") { panic=true; pause="Panic stop active; restart the script to resume"; storyModeReady=false; UpdateScene(player,pause); CancelConversation("Panic stop"); CancelKeyboard(); nativeMenu.PanicStop(); director.Clear("Panic stop"); promptRequested=false; toggleRequested=false; Caption("Panic stop: owned scenarios and AI cancelled.",5000); break; }
                    else if(action=="talk"&&!dialoguePending&&keyboardTarget==null) promptRequested=true;
                    else if(action=="director") toggleRequested=true;
                    else if(action=="menu") ToggleMenu(player);
                    else if(action=="wheel"){Ped target=talkSession!=null&&SessionValid(player)?talkSession.Ped:PickTalkTarget(player);if(target!=null)OpenReplyWheel(target,player);}
                }
                if(toggleRequested) { toggleRequested=false; if(storyModeReady) { director.Toggle(); Caption("Street director "+(director.Settings.enabled?"ON":"OFF"),2500); } }
                PollKeyboard(player);
                DrainCompleted(player,pause);
                pause=EffectivePause(player); storyModeReady=pause==null; UpdateScene(player,pause);
                CheckConversation(player,pause);
                TickNpcActions(player,pause);
                TickMind(player,pause);
                TickConversationUI(player,pause);
                TickPtt(player,pause);
                RestoreWeapons(pause!=null);
                var directorTimer=System.Diagnostics.Stopwatch.StartNew();
                director.Tick(player,pause);
                directorTimer.Stop(); metrics.DirectorMs=directorTimer.Elapsed.TotalMilliseconds; metrics.GameFrameMs=Game.LastFrameTime*1000;
                if(storyModeReady&&promptRequested)
                {
                    promptRequested=false;
                    Ped target=talkSession!=null&&SessionValid(player)?talkSession.Ped:PickTalkTarget(player);
                    if(target==null) Caption("Look at or approach an available NPC within the conversation range.",3000);
                    else if(input.Controller)OpenReplyWheel(target,player);
                    else if(BeginTalkSession(target,player)){keyboardTarget=new SeenNpc{Ped=target,Handle=target.Handle,Model=target.Model.Hash,At=now};Function.Call(Hash.DISPLAY_ONSCREEN_KEYBOARD,0,"FMMC_KEY_TIP8","","","","","",240);}
                }
                if((scanCandidates.Count>0||now>=nextScan)&&metrics.HasBudget(npcSettings.Number("performance.tickBudgetMs"))) Scan(player); else if(scanCandidates.Count>0||now>=nextScan) metrics.Deferred++;
                TickMenu(player);
                if(!exchangePending&&now>=nextExchange) { nextExchange=now.AddSeconds(1); Exchange(player); }
            }
            catch(Exception ex)
            {
                promptRequested=false;
                try {nativeMenu.Close();}catch{}
                if(DateTime.UtcNow>=nextErrorLog) { nextErrorLog=DateTime.UtcNow.AddSeconds(10); Log("Tick failure "+ex.GetType().Name+" at "+(ex.TargetSite==null?"unknown":ex.TargetSite.DeclaringType.FullName+"."+ex.TargetSite.Name)); Emit("runtime_error","A director operation failed. See the local diagnostic log.",null,null); }
                try { director.Clear("Encounter cancelled after runtime error"); } catch { Log("Cleanup requires script abort or game exit."); }
            }
            finally { metrics.End(); }
        }
        private bool Interactable(Ped ped,Ped player,float range)
        { return WorldDirector.Alive(player)&&WorldDirector.Alive(ped)&&ped.Handle!=player.Handle&&ped.IsHuman&&!ScriptProtected(ped)&&SafeVehicle(ped,player)&&!ped.IsInCombat&&ped.Position.DistanceTo(player.Position)<=range; }
        private string NpcId(Ped ped) { return runtimeId+":"+ped.Handle+":"+ped.Model.Hash; }
        private string EffectivePause(Ped player)
        {
            if(!compatibility.Supported) return compatibility.Reason;
            if(npcSettings.Flag("general.safeMode")) return "Safe mode active";
            if(panic) return "Panic stop active; restart the script to resume";
            if(!npcSettings.Flag("general.enabled")) return "NPC overhaul disabled";
            if(DateTime.UtcNow<readyAt) return "Starting director: waiting for Story Mode to settle";
            if(npcSettings.Flag("safety.protectMissions")&&Game.IsMissionActive) return "Story mission protected";
            string pause=WorldDirector.ScenePause(player,director.Settings);
            if((keyboardTarget!=null||nativeMenu!=null&&nativeMenu.KeyboardOpen||DateTime.UtcNow<keyboardReleasedUntil)&&pause=="Player control unavailable")return "Dialogue keyboard open";
            return pause??(nativeMenu!=null&&nativeMenu.IsOpen?"Native menu open":replyWheel?"Reply wheel open":null);
        }
        private void StartDialogue(Ped target,Ped player,string utterance,string command)
        {
            if(dialoguePending) { if(command!=null) Acknowledge(command,false,"Another dialogue request is pending."); return; }
            if(!BeginTalkSession(target,player)){if(command!=null)Acknowledge(command,false,"Conversation target or turn limit is unavailable.");return;}
            NpcMemory memory=Memory(target,true);
            conversation=new ActiveJob{Ped=target,Handle=target.Handle,Model=target.Model.Hash,Epoch=sceneEpoch,NpcId=NpcId(target),Utterance=utterance,History=WorkingHistory.Snapshot(memory.History),Deadline=DateTime.UtcNow.AddSeconds(npcSettings.Number("conversation.timeoutSeconds")),RequiredFrame=sentFrame+1};
            dialoguePending=true;
            Observe(target); nextExchange=DateTime.MinValue;
            if(command!=null) Acknowledge(command,true,"Dialogue queued against the observed NPC. The result will appear as a world event.");
            Caption("Waiting for the NPC reply...",1800);
        }
        private void UpdateScene(Ped player,string pause)
        {
            bool hard=pause!=null&&pause!="Game paused"&&pause!="Dialogue keyboard open"&&pause!="Native menu open"&&pause!="Reply wheel open";
            int handle=player!=null&&player.Exists()?player.Handle:0;
            if((hard&&lastHardPause!=pause)||(lastPlayerHandle!=0&&handle!=lastPlayerHandle)) {
                sceneEpoch=Guid.NewGuid().ToString("N"); registeredEpoch=null; CancelConversation("Scene changed"); CancelKeyboard(); observedNpcs.Clear(); scanCandidates.Clear(); seen.Clear(); nextScan=DateTime.MinValue;
            }
            lastHardPause=hard?pause:null; lastPlayerHandle=handle;
        }
        private void CheckConversation(Ped player,string pause)
        {
            if(conversation==null) return;
            if(conversation.Epoch!=sceneEpoch||DateTime.UtcNow>=conversation.Deadline||pause!=null&&pause!="Dialogue keyboard open"||!ValidJobTarget(conversation,player)) { CancelConversation("Conversation cancelled because the scene or NPC changed."); return; }
            if(!conversation.Submitted&&registeredEpoch==sceneEpoch&&acceptedFrame>=conversation.RequiredFrame&&DateTime.UtcNow>=conversation.NextSubmit) {
                conversation.Submitted=true;
                conversation.Attempts++;
                var context=new Dictionary<string,object>{{"trigger","player_talk"},{"history",conversation.History}};if(conversation.QuickJobId!=null)context["quickReply"]=new{jobId=conversation.QuickJobId,optionId=conversation.QuickOptionId};else context["playerUtterance"]=conversation.Utterance;
                var packet=new {requestId=conversation.RequestId,runtimeId=runtimeId,sceneEpoch=sceneEpoch,kind="conversation",lane="A",npcIds=new[]{conversation.NpcId},context=context};
                Send("api/ai/jobs",serializer.Serialize(packet),new Completion{Job=true,Epoch=sceneEpoch,RequestId=conversation.RequestId});
            }
        }
        private bool ValidJobTarget(ActiveJob job,Ped player)
        { return WorldDirector.Alive(player)&&job.Ped!=null&&job.Ped.Exists()&&AiUpdateGate.EntityAllowed(job.Handle,job.Model,job.Ped.Handle,job.Ped.Model.Hash,true,job.Ped.IsAlive,job.Ped.IsHuman,ScriptProtected(job.Ped),false,job.Ped.Position.DistanceTo(player.Position),npcSettings.Number("conversation.walkAwayMeters"))&&SafeVehicle(job.Ped,player)&&(!npcSettings.Flag("conversation.interruptOnDanger")||!job.Ped.IsInCombat&&!player.IsInCombat); }
        private void CancelConversation(string reason)
        {
            ActiveJob job=conversation; conversation=null; dialoguePending=false; promptRequested=false;
            if(job==null) return;
            if(job.JobId!=null) CancelRemote(job.JobId);
            Emit("dialogue_cancelled",reason,null,null);
        }
        private void CancelRemote(string id)
        { Task.Run(async delegate { try { await transport.CancelJobAsync(id,cancellation.Token).ConfigureAwait(false); } catch { } }); }
        private void DrainCompleted(Ped player,string pause)
        {
            Completion item; int count=0;
            while(count++<8&&completed.TryDequeue(out item))
            {
                if(item.Job)
                {
                    if(item.Kind=="quickReplies"){try{ReceiveQuickJob(item);}catch(Exception ex){Log("Quick reply request rejected: "+ex.GetType().Name);quickJob=null;}continue;}
                    try
                    {
                        if(item.Error!=null) throw new InvalidOperationException(item.Error);
                        string jobId=Wire.Text(Wire.Map(Wire.Value(item.Response,"job")),"id",128);
                        if(conversation==null||conversation.RequestId!=item.RequestId||sceneEpoch!=item.Epoch) { CancelRemote(jobId); continue; }
                        conversation.JobId=jobId;
                        string status=Wire.Text(Wire.Map(Wire.Value(item.Response,"job")),"status",32);
                        if(status=="cancelled"||status=="rejected"||status=="failed") CancelConversation("AI job no longer available: "+status);
                    }
                    catch(InvalidOperationException ex) { if(conversation!=null&&conversation.RequestId==item.RequestId) { if(conversation.Attempts<2&&item.Error!=null&&!item.Error.StartsWith("Dashboard HTTP 4",StringComparison.Ordinal)) { conversation.Submitted=false; conversation.NextSubmit=DateTime.UtcNow.AddSeconds(1); } else { CancelConversation(ex.Message); Caption(ex.Message,3500); } } }
                    continue;
                }
                exchangePending=false;
                if(item.Error!=null) { if(DateTime.UtcNow>=nextErrorLog) { nextErrorLog=DateTime.UtcNow.AddSeconds(20); Log(item.Error); } continue; }
                try
                {
                    if(!Wire.Boolean(item.Response,"success")||Wire.Integer(item.Response,"protocol",4,4)!=4) throw new InvalidOperationException("Companion protocol4 required; update the companion before NPC AI is available.");
                    pendingEvents.RemoveAll(e=>item.EventIds.Contains((string)e["id"])); acknowledgements.RemoveAll(e=>item.AckIds.Contains((string)e["id"]));
                    aiReceipts.RemoveAll(id=>item.ReceiptIds.Contains(id)); aiOutcomes.RemoveAll(a=>item.OutcomeIds.Contains((string)a["actionId"]));
                    if(item.MindOutcomeIds!=null)mindOutcomes.RemoveAll(a=>item.MindOutcomeIds.Contains((string)a["commitId"]));if(item.WitnessIds!=null)witnessedEvents.RemoveAll(a=>item.WitnessIds.Contains((string)a["id"]));
                    if(item.Epoch==sceneEpoch) { registeredEpoch=sceneEpoch; acceptedFrame=Math.Max(acceptedFrame,item.Frame); }
                    var config=Wire.Map(Wire.Value(item.Response,"config")); int revision=Wire.Integer(config,"revision",0,Int32.MaxValue);
                    if(revision!=appliedRevision)
                    { DirectorSettings settings=DirectorSettings.Parse(Wire.Map(Wire.Value(config,"settings"))); director.Apply(settings); appliedRevision=revision; Emit("settings_applied","Director settings revision "+revision+" applied in game.",null,null); }
                    var npcConfig=Wire.Map(Wire.Value(item.Response,"npcSettings"));
                    npcSettings.Apply(Wire.Integer(npcConfig,"revision",0,Int32.MaxValue),Wire.Map(Wire.Value(npcConfig,"settings")));
                    pause=EffectivePause(player); UpdateScene(player,pause);
                    ConsumeReputation(item.Response);
                    foreach(var update in Wire.Maps(Wire.Value(item.Response,"aiUpdates")).Take(32)) ConsumeAi(update,player,pause);
                    foreach(var command in Wire.Maps(Wire.Value(item.Response,"commands")).Take(32)) Dispatch(command,player,pause);
                }
                catch(Exception ex) { Log("Exchange response rejected: "+ex.GetType().Name+(ex is InvalidOperationException?" "+ResponsePolicy.CleanText(ex.Message,240):"")); }
            }
        }
        private void ConsumeAi(Dictionary<string,object> update,Ped player,string pause)
        {
            string id=null;
            try {
                // A fast provider can finish before its POST response reaches the game thread.
                // Leave that update unreceipted so the companion redelivers after the job ID is known.
                string initialKind=Wire.Text(update,"kind",32);if((initialKind=="conversation"||initialKind=="speech")&&conversation!=null&&conversation.JobId==null||initialKind=="quickReplies"&&quickJob!=null&&quickJob.JobId==null) return;
                id=Wire.Text(update,"id",128); string error;
                if(!updateGate.TryClaim(update,runtimeId,sceneEpoch,DateTime.UtcNow,out error)) return;
                string jobId=Wire.Text(update,"jobId",128),kind=Wire.Text(update,"kind",32),status=Wire.Text(update,"status",32),source=Wire.Text(update,"source",80);
                var payload=Wire.Map(Wire.Value(update,"payload"));
                if(kind=="persona"||kind=="memory"){if(pause==null&&npcSettings.Flag("memory.enabled")&&(status=="completed"||status=="fallback"))ConsumeMindUpdate(update,payload,player);return;}
                if(kind=="quickReplies"){if(status=="completed"||status=="fallback")ConsumeQuickReplies(update,payload,player);return;}
                if(conversation==null||conversation.JobId!=jobId||!ValidJobTarget(conversation,player)||pause!=null) return;
                if(kind=="speech") { Caption("NPC ["+ResponsePolicy.CleanText(source,40)+"]: "+ResponsePolicy.CleanText(Wire.Text(payload,"speech",800),800),6000); return; }
                if(status=="failed"||status=="cancelled"||status=="rejected") { CancelConversation("AI job "+status+"."); return; }
                if(kind!="conversation"||(status!="completed"&&status!="fallback")) return;
                string speech=ResponsePolicy.CleanText(Wire.Text(payload,"speech",800),800);
                if(speech.Length==0) throw new InvalidOperationException("NPC speech is empty after sanitization.");
                NpcMemory memory=Memory(conversation.Ped,true);
                var delta=Wire.Map(Wire.Value(payload,"mindDelta"));
                // Validate all final-state fields before applying any mental changes or GTA action.
                var candidate=new NpcMind{Fear=memory.Mind.Fear,Aggression=memory.Mind.Aggression,Morale=memory.Mind.Morale,Trust=memory.Mind.Trust,Respect=memory.Mind.Respect,Mood=memory.Mind.Mood}; candidate.Apply(delta);
                NpcMind.Delta(delta,"factionRepDelta",20);NpcMind.Delta(delta,"districtRepDelta",20);
                var actions=Wire.Maps(Wire.Value(payload,"actions")).Take(9).ToArray(); if(actions.Length>8) throw new InvalidOperationException("Too many AI actions.");
                var notes=Wire.Maps(Wire.Value(payload,"memoryEvents")).Take(4).ToArray(); if(notes.Length>3) throw new InvalidOperationException("Too many memory events.");
                foreach(var note in notes) { Wire.Text(note,"type",40); Wire.Text(note,"text",160); }
                string tone=Wire.Text(payload,"voiceTone",80);
                memory.Mind.Apply(delta); memory.Mind.VoiceTone=ResponsePolicy.CleanText(tone,80);
                object commit;if(payload.TryGetValue("memoryCommitId",out commit)&&commit!=null)MindOutcome(NpcMind.RequireString(commit),jobId,conversation.NpcId,true,memory.Mind);
                ProtectNotable(conversation.Ped);
                foreach(var note in notes) memory.Note=ResponsePolicy.CleanText(note["text"],160);
                memory.History.Add(new Dictionary<string,object>{{"role","player"},{"text",conversation.Utterance}}); memory.History.Add(new Dictionary<string,object>{{"role","npc"},{"text",speech}}); while(memory.History.Count>24) memory.History.RemoveAt(0);
                foreach(var action in actions) ExecuteAiAction(action,jobId,conversation,player);
                Caption("NPC ["+ResponsePolicy.CleanText(source,40)+"]: "+speech,10000); Emit("dialogue","NPC "+conversation.Handle+" ["+ResponsePolicy.CleanText(source,40)+"]: "+speech,null,director.Faction(conversation.Ped));
                conversation=null; dialoguePending=false;
                if(talkSession!=null){talkSession.Turns++;talkSession.IdleUntil=DateTime.UtcNow.AddSeconds(npcSettings.Number("conversation.timeoutSeconds"));if(talkSession.Turns>=(int)npcSettings.Number("conversation.maxTurns"))EndTalkSession("Conversation turn limit reached.",true);}
            } catch(InvalidOperationException ex) { Log("AI update rejected: "+ex.Message); CancelConversation("AI result rejected by local validation."); }
            finally { if(id!=null&&!aiReceipts.Contains(id)) { if(aiReceipts.Count>=256) aiReceipts.RemoveAt(0); aiReceipts.Add(id); } }
        }
        private static void AddReputation(Dictionary<string,int> reputation,string key,int delta)
        { int value; reputation.TryGetValue(key,out value); reputation[key]=NpcMind.Clamp(value+delta,-100,100); }
        private void ExecuteAiAction(Dictionary<string,object> action,string jobId,ActiveJob job,Ped player)
        {
            string id=null; bool applied=false; string message="Action rejected.";
            try {
                id=Wire.Text(action,"actionId",128);
                if(executedActions.Contains(id)) return;
                if(Wire.Text(action,"jobId",128)!=jobId||Wire.Text(action,"runtimeId",128)!=runtimeId||Wire.Text(action,"sceneEpoch",128)!=sceneEpoch||Wire.Text(action,"npcId",128)!=job.NpcId||Wire.Timestamp(action,"expiresAt")<=DateTime.UtcNow||Wire.Integer(action,"expectedHandle",1,Int32.MaxValue)!=job.Handle||Wire.Integer(action,"expectedModelHash",Int32.MinValue,Int32.MaxValue)!=job.Model||!ValidJobTarget(job,player)) throw new InvalidOperationException("Action identity, expiry or entity state changed.");
                string type=Wire.Text(action,"type",40);
                if(!ResponsePolicy.IsSupportedAction(type)) throw new InvalidOperationException("Action executor not enabled in this foundation build.");
                if(!npcSettings.Flag("action."+type)) throw new InvalidOperationException("Action disabled by settings.");
                if(executedActions.Count>=2048) throw new InvalidOperationException("Session action ledger full; reload the script to start a new session.");
                executedActions.Add(id);
                var parameters=Wire.Map(Wire.Value(action,"parameters")); int duration=parameters.ContainsKey("durationMs")?Wire.Integer(parameters,"durationMs",500,15000):5000;
                message=QueueNpcAction(job.Ped,player,type,duration,id,jobId);if(message==null)return;
            } catch(Exception ex) { message=ex is InvalidOperationException?ex.Message:"Game task failed: "+ex.GetType().Name; }
            RecordActionOutcome(id,jobId,applied,message);
        }
        private void Dispatch(Dictionary<string,object> command,Ped player,string pause)
        {
            string id=null;
            try
            {
                id=Wire.Text(command,"id",128); string error;
                if(!commands.TryClaim(command,runtimeId,DateTime.UtcNow,out error)) { if(error!=null) Acknowledge(id,false,error); return; }
                string type=Wire.Text(command,"type",32); var payload=Wire.Map(Wire.Value(command,"payload"));
                if(type=="clear_events") { director.Clear("Cleared from the live portal"); ClearNpcActions("Cleared from the live portal"); Acknowledge(id,true,"Owned encounters cleared."); return; }
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
                    if(!seen.TryGetValue(npcId,out target)||DateTime.UtcNow-target.At>TimeSpan.FromSeconds(5)||!target.Ped.Exists()||target.Ped.Handle!=target.Handle||target.Ped.Model.Hash!=target.Model||!target.Ped.IsOnScreen||!Interactable(target.Ped,player,(float)npcSettings.Number("conversation.rangeMeters"))) { Acknowledge(id,false,"NPC is no longer visible, within the configured conversation range, or available."); return; }
                    StartDialogue(target.Ped,player,text,id); return;
                }
                Acknowledge(id,false,"Unsupported game command.");
            }
            catch(Exception ex) { if(id!=null) Acknowledge(id,false,ex is InvalidOperationException?ex.Message:"Game command could not be applied."); Log("Command rejected: "+ex.GetType().Name); }
        }
        private void Scan(Ped player)
        {
            DateTime now=DateTime.UtcNow;
            if(!WorldDirector.Alive(player)||Function.Call<bool>(Hash.IS_SCREEN_FADED_OUT)) { observedNpcs.Clear(); scanCandidates.Clear(); return; }
            if(scanCandidates.Count==0) {
                foreach(int handle in memories.Where(m=>now-m.Value.LastUsed>TimeSpan.FromSeconds(npcSettings.Number("memory.workingMemorySeconds"))).Select(m=>m.Key).ToArray()) memories.Remove(handle);
                foreach(string id in seen.Where(s=>now-s.Value.At>TimeSpan.FromSeconds(5)).Select(s=>s.Key).ToArray()) seen.Remove(id);
                observedNpcs.RemoveAll(n=>!seen.ContainsKey((string)n["id"]));
                var nearby=World.GetNearbyPeds(player,75).Where(p=>p.Exists()&&p.IsHuman&&p.Handle!=player.Handle);
                var all=director.Peds.Where(p=>p.Exists).Select(p=>p.Ped).Concat(ActionPeds).Concat(nearby).GroupBy(p=>p.Handle).Select(g=>g.First()).OrderBy(p=>conversation!=null&&p.Handle==conversation.Handle?0:1).ThenBy(p=>p.Position.DistanceToSquared(player.Position)).Take(Math.Min(32,(int)npcSettings.Number("performance.trackedNpcCap")));
                foreach(Ped ped in all) scanCandidates.Enqueue(ped);
                lastScanStarted=now; nextScan=now.AddSeconds(1/Math.Max(1,npcSettings.Number("performance.scansPerSecond")));
            }
            if(player.IsShooting) recentGunfire=now;
            int remaining=4;
            while(scanCandidates.Count>0&&remaining-->0&&metrics.HasBudget(npcSettings.Number("performance.tickBudgetMs"))) { Ped ped=scanCandidates.Dequeue(); if(ped.Exists()&&ped.IsHuman&&ped.Position.DistanceTo(player.Position)<=100) Observe(ped); }
            if(now-lastScanStarted>TimeSpan.FromSeconds(2)) { scanCandidates.Clear(); nextScan=now; }
        }
        private void Observe(Ped ped)
        {
            if(ped.IsShooting) recentGunfire=DateTime.UtcNow;
            string id=NpcId(ped); observedNpcs.RemoveAll(n=>(string)n["id"]==id);
            observedNpcs.Insert(0,Describe(ped));
            while(observedNpcs.Count>Math.Min(32,npcSettings.Number("performance.trackedNpcCap"))) observedNpcs.RemoveAt(observedNpcs.Count-1);
            seen[id]=new SeenNpc{Ped=ped,Handle=ped.Handle,Model=ped.Model.Hash,At=DateTime.UtcNow};
        }
        private void Exchange(Ped player)
        {
            bool available=WorldDirector.Alive(player)&&!Function.Call<bool>(Hash.IS_SCREEN_FADED_OUT);
            var npcs=new List<Dictionary<string,object>>(available?observedNpcs.Where(n=>seen.ContainsKey((string)n["id"])&&DateTime.UtcNow-seen[(string)n["id"]].At<TimeSpan.FromSeconds(3)):Enumerable.Empty<Dictionary<string,object>>());
            foreach(var npc in npcs) { NpcMemory memory; if(memories.TryGetValue((int)npc["handle"],out memory)) { npc["mind"]=memory.Mind.Snapshot(); npc["fear"]=memory.Mind.Fear; npc["aggression"]=memory.Mind.Aggression; npc["morale"]=memory.Mind.Morale; npc["memory"]=memory.Note; npc["longTermMemory"]=memory.Note; } }
            var events=pendingEvents.Take(50).ToArray(); var acks=acknowledgements.Take(50).ToArray();
            var receipts=aiReceipts.Take(64).ToArray(); var outcomes=aiOutcomes.Take(32).ToArray();
            var mindAcks=mindOutcomes.Take(32).ToArray();var witnesses=witnessedEvents.Take(16).ToArray();
            var packet=new Dictionary<string,object>{{"protocol",4},{"runtimeId",runtimeId},{"sceneEpoch",sceneEpoch},{"pluginVersion",PluginVersion},{"gameVersion",compatibility.GameFileVersion},{"sdkGameVersion",Game.FileVersion.ToString()},
                {"appliedRevision",Math.Max(0,appliedRevision)},{"player",available?DescribePlayer(player):null},{"environment",available?DescribeEnvironment(player):null},
                {"npcs",npcs.ToArray()},{"director",director.Snapshot()},{"events",events},{"acknowledgements",acks},{"appliedNpcRevision",Math.Max(0,npcSettings.Revision)},
                {"aiReceipts",receipts},{"aiOutcomes",outcomes},{"aiMindOutcomes",mindAcks},{"witnessedEvents",witnesses},{"appliedMemoryRevision",appliedMemoryRevision},{"appliedReputationRevision",appliedReputationRevision},{"compatibility",compatibility.Snapshot(Game.FileVersion.ToString())},{"tickMetrics",metrics.Snapshot()},{"inputDevice",input.Controller?"controller":"keyboard"}};
            string json=serializer.Serialize(packet);
            // The server's limit is UTF-8 bytes, while JavaScriptSerializer limits characters.
            // Keep unsent acknowledgements/events queued; send a smaller observed NPC subset if required.
            while(Encoding.UTF8.GetByteCount(json)>120000)
            {
                if(events.Length>0) { events=events.Take(events.Length/2).ToArray(); packet["events"]=events; }
                else if(acks.Length>0) { acks=acks.Take(acks.Length/2).ToArray(); packet["acknowledgements"]=acks; }
                else if(outcomes.Length>0) { outcomes=outcomes.Take(outcomes.Length/2).ToArray(); packet["aiOutcomes"]=outcomes; }
                else if(mindAcks.Length>0) { mindAcks=mindAcks.Take(mindAcks.Length/2).ToArray();packet["aiMindOutcomes"]=mindAcks; }
                else if(witnesses.Length>0) { witnesses=witnesses.Take(witnesses.Length/2).ToArray();packet["witnessedEvents"]=witnesses; }
                else if(receipts.Length>0) { receipts=receipts.Take(receipts.Length/2).ToArray(); packet["aiReceipts"]=receipts; }
                else if(npcs.Count>0) { npcs.RemoveAt(npcs.Count-1); packet["npcs"]=npcs.ToArray(); }
                else throw new InvalidOperationException("World snapshot exceeded the local exchange budget.");
                json=serializer.Serialize(packet);
            }
            exchangePending=true;
            Send("api/runtime/exchange",json,new Completion{Frame=++sentFrame,Epoch=sceneEpoch,EventIds=events.Select(e=>(string)e["id"]).ToArray(),AckIds=acks.Select(e=>(string)e["id"]).ToArray(),ReceiptIds=receipts,OutcomeIds=outcomes.Select(a=>(string)a["actionId"]).ToArray(),MindOutcomeIds=mindAcks.Select(a=>(string)a["commitId"]).ToArray(),WitnessIds=witnesses.Select(a=>(string)a["id"]).ToArray()});
        }
        private Dictionary<string,object> Describe(Ped ped)
        {
            NpcMemory memory=Memory(ped,true); string faction=director.Faction(ped); int damage=Math.Max(0,memory.LastHealth-ped.Health); memory.LastHealth=ped.Health;
            return new Dictionary<string,object>{{"id",NpcId(ped)},{"handle",ped.Handle},{"name",SpeakerName(ped)},{"faction",faction},{"factionVerified",faction!="Civilian/Unknown"},
                {"archetype",faction=="Civilian/Unknown"?"Nearby pedestrian; affiliation unknown":"Observed "+faction+" pedestrian"},{"position",Position(ped.Position)},{"health",ped.Health},{"alive",ped.IsAlive},
                {"modelHash",ped.Model.Hash},{"identity",ObserveIdentity(ped,memory)},{"inVehicle",ped.IsInVehicle()},{"availableActions",AvailableActions(ped,Game.Player.Character)},{"inCombat",ped.IsInCombat},{"owned",ModOwns(ped)},{"weapon",ped.Weapons.Current==null?"Unarmed":ped.Weapons.Current.Hash.ToString()},{"memory",memory.Note},
                {"mind",memory.Mind.Snapshot()},{"fear",memory.Mind.Fear},{"aggression",memory.Mind.Aggression},{"morale",memory.Mind.Morale},{"longTermMemory",memory.Note},
                {"recentDamage",Math.Min(10000,damage)},{"recentEvents",damage>0?new[]{"Observed health loss: "+damage}:new string[0]},{"distance",ped.Position.DistanceTo(Game.Player.Character.Position)}};
        }
        private NpcMemory Memory(Ped ped,bool create)
        {
            NpcMemory memory;
            if(memories.TryGetValue(ped.Handle,out memory)&&memory.Model!=ped.Model.Hash) { memories.Remove(ped.Handle); memory=null; }
            if(memory==null&&create) { if(memories.Count>=Math.Max(32,npcSettings.Number("memory.maxNpcs"))) memories.Remove(memories.OrderBy(m=>m.Value.LastUsed).First().Key); memory=new NpcMemory{Ped=ped,Model=ped.Model.Hash,LastHealth=ped.Health}; memories[ped.Handle]=memory; }
            if(memory!=null&&create) memory.LastUsed=DateTime.UtcNow; return memory;
        }
        private static object Position(Vector3 p) { return new {x=p.X,y=p.Y,z=p.Z}; }
        private void PollKeyboard(Ped player)
        {
            if(keyboardTarget==null) return;
            int state=Function.Call<int>(Hash.UPDATE_ONSCREEN_KEYBOARD);
            if(state==0) return;
            SeenNpc target=keyboardTarget; keyboardTarget=null;
            keyboardReleasedUntil=DateTime.UtcNow.AddMilliseconds(350);
            if(state!=1) return;
            string text=ResponsePolicy.CleanText(Function.Call<string>(Hash.GET_ONSCREEN_KEYBOARD_RESULT),240);
            if(text.Length>0&&!panic&&compatibility.Supported&&!npcSettings.Flag("general.safeMode")&&npcSettings.Flag("general.enabled")&&WorldDirector.Alive(player)&&target.Ped.Exists()&&target.Ped.Handle==target.Handle&&target.Ped.Model.Hash==target.Model&&Interactable(target.Ped,player,(float)npcSettings.Number("conversation.walkAwayMeters"))&&(!(director.Settings.protectMissions||npcSettings.Flag("safety.protectMissions"))||!Game.IsMissionActive))
                StartDialogue(target.Ped,player,text,null);
        }
        private void CancelKeyboard() { if(keyboardTarget!=null) { keyboardTarget=null; Function.Call(Hash.CANCEL_ONSCREEN_KEYBOARD); } }
        private object DescribePlayer(Ped p) { return new {wantedLevel=Game.Player.Wanted.WantedLevel,weaponDrawn=p.IsArmed(WeaponCheckFlags.IncludeGun),weaponDrawnName=p.Weapons.Current==null?"Unarmed":p.Weapons.Current.Hash.ToString(),stance=p.IsShooting?"Shooting":p.IsAiming?"Aiming":p.IsInCombat?"Combat":p.IsInVehicle()?"In vehicle":p.IsSprinting?"Sprinting":p.IsDucking?"Crouching":"Casual",factionStandings=new Dictionary<string,int>(factionStandings),districtStandings=new Dictionary<string,int>(districtStandings),position=Position(p.Position)}; }
        private object DescribeEnvironment(Ped p) { return new {weather=World.Weather.ToString(),timeOfDay=GTA.Chrono.GameClock.Hour+":"+GTA.Chrono.GameClock.Minute.ToString("D2"),district=World.GetZoneLocalizedName(p.Position),nearbyGunfire=DateTime.UtcNow-recentGunfire<TimeSpan.FromSeconds(4)}; }
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
        private void RememberWeapon(Ped ped,int duration,WeaponHash selected)
        { var old=weaponLeases.FirstOrDefault(x=>x.Handle==ped.Handle&&x.Model==ped.Model.Hash); if(old!=null) { old.Until=DateTime.UtcNow.AddMilliseconds(duration); old.Selected=selected; return; } if(weaponLeases.Count>=16) throw new InvalidOperationException("Temporary weapon lease limit reached."); weaponLeases.Add(new WeaponLease{Ped=ped,Handle=ped.Handle,Model=ped.Model.Hash,Original=ped.Weapons.Current==null?WeaponHash.Unarmed:ped.Weapons.Current.Hash,Selected=selected,Until=DateTime.UtcNow.AddMilliseconds(duration)}); }
        private void RestoreWeapons(bool all)
        { foreach(var lease in weaponLeases.ToArray()) if(all||DateTime.UtcNow>=lease.Until||!lease.Ped.Exists()) { try { if(lease.Ped.Exists()&&lease.Ped.Handle==lease.Handle&&lease.Ped.Model.Hash==lease.Model&&lease.Ped.IsAlive&&lease.Ped.Weapons.Current!=null&&lease.Ped.Weapons.Current.Hash==lease.Selected) lease.Ped.Weapons.Select(lease.Original,true); } finally { weaponLeases.Remove(lease); } } }
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
            CancelConversation("Script unloading");
            try{EndTalkSession("Script unloading",false);}catch{}
            try { CancelKeyboard(); } catch { }
            try { if(nativeMenu!=null)nativeMenu.Close(); } catch { }
            try { ClearNpcActions("Script unloading"); ReleaseNotables(true); } catch { }
            try { RestoreWeapons(true); } catch { Log("A temporary weapon selection could not be restored during abort."); }
            try { director.Dispose(); SaveCampaign(); } catch(Exception ex) { Log("Abort cleanup: "+ex.GetType().Name); }
            cancellation.Cancel(); transport.Dispose(); Completion item; while(completed.TryDequeue(out item)) {}
            memories.Clear(); seen.Clear(); Log("Director stopped.");
        }
    }
}

