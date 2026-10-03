using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using GTA;
using GTA.Native;

namespace LivingLosSantosV2
{
    public sealed partial class EnhancedClient
    {
        private NativeMenu nativeMenu;
        private readonly ConcurrentQueue<MenuReply> menuReplies=new ConcurrentQueue<MenuReply>();
        private int menuPending;
        private sealed class MenuReply { public MenuRequest Request; public Dictionary<string,object> Data; public string Error; public bool Counted=true; }
        private void InitializeMenu()
        {
            nativeMenu=new NativeMenu(npcSettings,
                ()=>new Dictionary<string,object>{{"revision",Math.Max(0,appliedRevision)},{"settings",director.Settings.Snapshot()}},
                MenuDiagnostics,MenuNpcs,RequestMenu,()=>{panic=true;CancelConversation("Panic stop from menu");director.Clear("Panic stop from menu");RestoreWeapons(true);},Path.Combine(dataDirectory,"Profiles"));
        }
        private Dictionary<string,object>[] MenuNpcs()
        {
            return observedNpcs.Select(n=>{var copy=new Dictionary<string,object>(n);SeenNpc observed;if(seen.TryGetValue((string)n["id"],out observed))copy["observationAgeSeconds"]=Math.Round((DateTime.UtcNow-observed.At).TotalSeconds,1);NpcMemory memory;if(memories.TryGetValue((int)n["handle"],out memory)){copy["mind"]=memory.Mind.Snapshot();copy["history"]=WorkingHistory.Snapshot(memory.History);copy["memory"]=memory.Note;}return copy;}).ToArray();
        }
        private Dictionary<string,object> MenuDiagnostics()
        {
            return new Dictionary<string,object>{{"Client",PluginVersion},{"Protocol",4},{"Executable",compatibility.GameFileVersion},{"SDK assembly",compatibility.ApiVersion},{"SDK game version",Game.FileVersion.ToString()},{"Compatibility",compatibility.Supported?"Matched tested build":compatibility.Reason},{"Tick last ms",Math.Round(metrics.LastMs,3)},{"Director ms",Math.Round(metrics.DirectorMs,3)},{"Game frame ms",Math.Round(metrics.GameFrameMs,3)},{"Deferred scans",metrics.Deferred},{"Observed NPCs",observedNpcs.Count},{"Owned NPCs",director.OwnedCount},{"Pending menu requests",menuPending},{"AI conversation",conversation==null?"None":conversation.JobId??"Registering target"},{"Scene",director.PausedReason??"Story Mode running"},{"Controls masked",nativeMenu!=null&&nativeMenu.ControlsMasked},{"ScriptHookV observed",compatibility.ScriptHookVersion},{"SHVDN loader observed",compatibility.LoaderVersion},{"ScriptHookV SHA256 observed",compatibility.ScriptHookHash},{"SHVDN loader SHA256 observed",compatibility.LoaderHash}};
        }
        private void RequestMenu(MenuRequest request)
        {
            if(menuPending>=8){request.Done(null,"Menu request limit reached. Wait for current requests.");return;}
            string json;try{json=request.Body==null?null:serializer.Serialize(request.Body);}catch(Exception){request.Done(null,"Menu request could not be serialized.");return;}menuPending++;
            Task.Run(async delegate {
                var reply=new MenuReply{Request=request};
                try {if(request.LocalWork!=null)reply.Data=request.LocalWork();else if(request.Route.StartsWith("api/ai/menu/jobs",StringComparison.Ordinal)||request.Route.StartsWith("api/ai/advisor/proposals",StringComparison.Ordinal)){using(var independent=new DashboardTransport("http://127.0.0.1:3000/")){reply.Data=await independent.MenuAsync(request.Method,request.Route,json,CancellationToken.None).ConfigureAwait(false);if(stopping&&request.Method=="POST"&&request.Route=="api/ai/menu/jobs"){string id=Wire.Text(Wire.Map(Wire.Value(reply.Data,"job")),"id",128);await independent.MenuAsync("DELETE","api/ai/menu/jobs/"+id,null,CancellationToken.None).ConfigureAwait(false);}}}else reply.Data=await transport.MenuAsync(request.Method,request.Route,json,cancellation.Token).ConfigureAwait(false);}
                catch(OperationCanceledException){reply.Error="Menu request cancelled or timed out.";}
                catch(InvalidOperationException ex){reply.Error=ResponsePolicy.CleanText(ex.Message,240);}
                catch(Exception){reply.Error="Local menu operation failed; companion or profile file unavailable.";}
                if(!stopping)menuReplies.Enqueue(reply);
            });
        }
        private void TickMenu(Ped player)
        {
            MenuReply reply;int count=0;
            while(count++<8&&menuReplies.TryDequeue(out reply)){if(reply.Counted)menuPending=Math.Max(0,menuPending-1);try{reply.Request.Done(reply.Data,reply.Error);}catch(Exception ex){Log("Menu response rejected: "+ex.GetType().Name);}}
            bool close=!CanOpenMenu(player);
            try{nativeMenu.Tick(close);}catch(Exception ex){Log("Native menu closed after "+ex.GetType().Name);nativeMenu.Close();}
        }
        private void ToggleMenu(Ped player)
        {
            if(nativeMenu.IsOpen){nativeMenu.Close();return;}
            if(!CanOpenMenu(player)){Caption("Close phone/weapon controls and stop safely before opening the menu.",3500);return;}
            CancelKeyboard();EndTalkSession("Conversation ended when the menu opened.",false);nativeMenu.Toggle();
        }
        private bool CanOpenMenu(Ped player){return WorldDirector.Alive(player)&&!Game.IsPaused&&!Game.IsCutsceneActive&&!Function.Call<bool>(Hash.IS_SCREEN_FADED_OUT)&&!player.IsAiming&&!player.IsInCombat&&!Game.IsControlPressed(Control.SelectWeapon)&&!Function.Call<bool>(Hash.IS_PED_RUNNING_MOBILE_PHONE_TASK,player.Handle)&&(!player.IsInVehicle()||player.CurrentVehicle==null||player.CurrentVehicle.Speed<=5);}
    }
}
