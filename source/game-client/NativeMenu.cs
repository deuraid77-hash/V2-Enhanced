using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Windows.Forms;
using GTA;
using GTA.Native;
using GTA.UI;
using Control=GTA.Control;
using Screen=GTA.UI.Screen;
using Font=GTA.UI.Font;

namespace LivingLosSantosV2
{
    // Draw/input/entity inspection runs only from EnhancedClient.Tick. Requests contain managed data.
    internal sealed class NativeMenu
    {
        private sealed class Row {public string Label,Value,Help,SettingKey;public Action Activate;public Action<int> Adjust;}
        private readonly NpcSettingsState settings;
        private readonly Func<Dictionary<string,object>> world,diagnostics;
        private readonly Func<Dictionary<string,object>[]> inspect;
        private readonly Action<MenuRequest> submit;
        private readonly Action panic;
        private readonly ProfileFiles files;
        private readonly ConcurrentQueue<Keys> keys=new ConcurrentQueue<Keys>();
        private readonly MenuNavigation nav=new MenuNavigation();
        private readonly List<Row> rows=new List<Row>();
        private readonly Dictionary<string,object> draft=new Dictionary<string,object>(),worldDraft=new Dictionary<string,object>();
        private readonly DraftRevision draftBase=new DraftRevision(),worldDraftBase=new DraftRevision();
        private readonly List<Dictionary<string,object>> profiles=new List<Dictionary<string,object>>();
        private readonly List<string> paragraphs=new List<string>();
        private Dictionary<string,object> proposal,status=new Dictionary<string,object>();
        private string filter="",message="",jobId,jobKind;
        private DateTime editAt=DateTime.MinValue,nextPoll=DateTime.MinValue,nextRepeat=DateTime.MinValue,statusAt=DateTime.MinValue;
        private int serverRevision=-1,serverWorldRevision=-1,generation,pollErrors;
        private bool requestPending,pollPending,captureReady,draftBlocked,jobSubmitting,proposalApplying;
        private Action<string> keyboardResult;
        private VirtualKeyboard virtualKeyboard;private Action<string> virtualDone;private string virtualPurpose;
        private float mouseX=-1,mouseY=-1;
        private MenuLayout layout;
        private readonly TextElement[] text=new TextElement[40];
        private readonly ContainerElement panel=new ContainerElement(),highlight=new ContainerElement(),stripe=new ContainerElement();
        public bool IsOpen {get{return nav.Open;}}
        public bool KeyboardOpen {get{return keyboardResult!=null;}}
        public bool Capturing {get{return nav.Capturing;}}
        public bool ControlsMasked {get;private set;}
        private static readonly int[] CapturedControls={222,223,224,225,226,227,228,229,230,231,232,233,234,235,236};
        public NativeMenu(NpcSettingsState values,Func<Dictionary<string,object>> worldState,Func<Dictionary<string,object>> debug,Func<Dictionary<string,object>[]> npcs,Action<MenuRequest> request,Action stop,string profileFolder)
        {settings=values;world=worldState;diagnostics=debug;inspect=npcs;submit=request;panic=stop;files=new ProfileFiles(profileFolder);for(int i=0;i<text.Length;i++)text[i]=new TextElement("",PointF.Empty,.3f,Color.White,Font.ChaletLondon,Alignment.Left,false,true);}
        public void Queue(Keys key) {if(keys.Count<32)keys.Enqueue(key);}
        public void Toggle() {if(IsOpen)Close();else{nav.Show();generation++;message="Refreshing live settings...";Refresh();}}
        public void Close()
        {
            nav.Close();ControlsMasked=false;generation++;keys.ClearSafe();
            CancelAi();
            virtualKeyboard=null;virtualDone=null;
            if(KeyboardOpen){keyboardResult=null;Function.Call(Hash.CANCEL_ONSCREEN_KEYBOARD);}
        }
        private void CancelAi(){if(jobId!=null){Request("DELETE","api/ai/menu/jobs/"+jobId,null,(r,e)=>{});jobId=null;}if(proposal!=null&&!proposalApplying){string id=Wire.Text(proposal,"id",128);Request("POST","api/ai/advisor/proposals/"+id+"/reject",new Dictionary<string,object>(),(r,e)=>{});proposal=null;}}
        public void PanicStop(){generation++;CancelAi();keys.ClearSafe();nav.Capturing=false;nav.CaptureKey=null;virtualKeyboard=null;virtualDone=null;if(KeyboardOpen){keyboardResult=null;Function.Call(Hash.CANCEL_ONSCREEN_KEYBOARD);}if(IsOpen){nav.Close();nav.Show();message="Panic stop applied. Menu remains available.";}}
        public void Tick(bool mustClose)
        {
            ControlsMasked=false;
            if(mustClose&&IsOpen){Close();return;}
            if(!IsOpen)return;
            serverRevision=Math.Max(serverRevision,settings.Revision); serverWorldRevision=Math.Max(serverWorldRevision,WorldRevision());
            if(!draftBlocked&&!KeyboardOpen&&!nav.Capturing&&!requestPending&&(draft.Count>0||worldDraft.Count>0)&&DateTime.UtcNow-editAt>TimeSpan.FromMilliseconds(350))Flush();
            PollJob();
            if(KeyboardOpen){int state=Function.Call<int>(Hash.UPDATE_ONSCREEN_KEYBOARD);if(state!=0){var done=keyboardResult;keyboardResult=null;if(state==1){string value=ResponsePolicy.CleanText(Function.Call<string>(Hash.GET_ONSCREEN_KEYBOARD_RESULT),600);if(value.Length>0)done(value);}}return;}
            BuildRows();layout=MenuLayout.Compute(Screen.ScaledWidth,Screen.SafeZoneSizeProfile,(float)settings.Number("controls.menuScale"),(float)settings.Number("controls.menuX"),(float)settings.Number("controls.menuY"));nav.Fit(rows.Count,layout.VisibleRows);
            HandleKeys();
            if(!IsOpen)return;
            HandleController();HandleMouse();
            if(!IsOpen)return;
            BuildRows();nav.Fit(rows.Count,layout.VisibleRows);
            foreach(int c in MenuControlMask.ForMenu(Game.LastInputMethod==InputMethod.GamePad,nav.Capturing))Game.DisableControlThisFrame((Control)c);ControlsMasked=true;
            Draw();
        }
        private void Request(string method,string route,Dictionary<string,object> body,Action<Dictionary<string,object>,string> done)
        {submit(new MenuRequest{Method=method,Route=route,Body=body,Done=done});}
        private void Local(Func<Dictionary<string,object>> work,Action<Dictionary<string,object>,string> done) {submit(new MenuRequest{LocalWork=work,Done=done});}
        private void Refresh()
        {
            Request("GET","api/settings?catalog=false",null,(r,e)=>{if(e!=null){message=e;return;}serverRevision=Wire.Integer(r,"revision",0,Int32.MaxValue);var w=Wire.Map(Wire.Value(r,"world"));serverWorldRevision=Wire.Integer(w,"revision",0,Int32.MaxValue);message="Settings synced from companion.";});
            RefreshProfiles();
        }
        private void RefreshProfiles() {Request("GET","api/profiles",null,(r,e)=>{if(e!=null){message=e;return;}profiles.Clear();profiles.AddRange(Wire.Maps(Wire.Value(r,"profiles")).Take(40));});}
        private int WorldRevision() {return Wire.Integer(world(),"revision",0,Int32.MaxValue);}
        private Dictionary<string,object> WorldValues() {return Wire.Map(Wire.Value(world(),"settings"));}
        private Dictionary<string,object> NpcValues() {return (Dictionary<string,object>)settings.Snapshot();}
        private object Value(SettingDefinition spec,bool isWorld) {object value;var changes=isWorld?worldDraft:draft;if(changes.TryGetValue(spec.Key,out value))return value;return (isWorld?WorldValues():NpcValues())[spec.Key];}
        private void Change(SettingDefinition spec,object value,bool isWorld)
        {
            try {
                if(!isWorld){var combined=NpcValues();foreach(var p in draft)combined[p.Key]=p.Value;string conflict=spec.Key.StartsWith("controls.",StringComparison.Ordinal)?MenuRules.BindingConflict(spec.Key,value,combined):null;if(conflict!=null)throw new InvalidOperationException(conflict);combined[spec.Key]=value;SettingsCatalog.Validate(combined);}
                else {var merged=WorldValues();foreach(var p in worldDraft)merged[p.Key]=p.Value;merged[spec.Key]=value;DirectorSettings.Parse(merged);}
                (isWorld?worldDraftBase:draftBase).Begin(isWorld?serverWorldRevision:serverRevision);(isWorld?worldDraft:draft)[spec.Key]=value;editAt=DateTime.UtcNow;message=draftBlocked?"Draft retained; use Review pending edits to rebase and apply.":"Draft change; applying after input settles.";Feedback(false);
            }catch(Exception ex){message=ex is InvalidOperationException?ex.Message:"Setting value rejected.";}
        }
        private void Flush()
        {
            if(serverRevision<0||serverWorldRevision<0){message="Wait for the companion settings revision.";return;}
            bool isWorld=worldDraft.Count>0;var batch=MenuRules.Clone(isWorld?worldDraft:draft);requestPending=true;
            var basis=isWorld?worldDraftBase:draftBase;if(basis.Value<0)basis.Begin(isWorld?serverWorldRevision:serverRevision);
            var body=new Dictionary<string,object>{{"settings",batch},{"source","game"},{"expectedRevision",basis.Value}};
            Request("PATCH",isWorld?"api/world/config?compact=true":"api/settings",body,(r,e)=>{
                requestPending=false;
                if(e!=null){draftBlocked=true;message=e.Contains("409")?"Changed elsewhere. Draft preserved; Review pending edits to refresh and rebase.":e+" Draft preserved; review to retry.";return;}
                int revision;try{revision=MenuRules.ConfigRevision(r,isWorld);}catch{draftBlocked=true;message="Invalid settings acknowledgement. Draft retained for explicit review.";return;}MenuRules.FinishSubmission(isWorld?worldDraft:draft,batch,true);basis.Submitted(revision,(isWorld?worldDraft:draft).Count>0);if(isWorld)serverWorldRevision=revision;else serverRevision=revision;
                message="Saved revision "+revision+"; waiting for game acknowledgement.";
            });
        }
        private void RebaseDraft()
        {
            if(requestPending){message="Wait for the submitted request.";return;}draftBlocked=true;requestPending=true;
            Request("GET","api/settings?catalog=false",null,(r,e)=>{requestPending=false;if(e!=null){message=e;return;}try{var npc=Wire.Map(Wire.Value(r,"settings"));foreach(var p in draft)npc[p.Key]=p.Value;SettingsCatalog.Validate(npc);var w=Wire.Map(Wire.Value(r,"world"));var values=Wire.Map(Wire.Value(w,"settings"));foreach(var p in worldDraft)values[p.Key]=p.Value;DirectorSettings.Parse(values);serverRevision=Wire.Integer(r,"revision",0,Int32.MaxValue);serverWorldRevision=Wire.Integer(w,"revision",0,Int32.MaxValue);draftBase.Rebase(serverRevision);worldDraftBase.Rebase(serverWorldRevision);draftBlocked=false;editAt=DateTime.UtcNow;message="Draft rebased and validated; applying after input settles.";}catch(InvalidOperationException ex){message="Draft still needs adjustment: "+ex.Message;}});
        }
        private void Add(string label,string value,string help,Action action=null,Action<int> adjust=null,string settingKey=null) {rows.Add(new Row{Label=label,Value=value??"",Help=help??"",Activate=action,Adjust=adjust,SettingKey=settingKey});}
        private void Enter(string page) {nav.Enter(page);Feedback(false);}
        private void BuildRows()
        {
            rows.Clear();
            if(nav.Page=="home"){
                Add("Search all settings",filter.Length==0?"Type to search":filter,"Search setting names and help text.",()=>TextInput("Search settings",filter,v=>{filter=v;Enter("search");}));
                if(draft.Count+worldDraft.Count>0)Add("Review pending edits",draftBlocked?"Action required":"Pending", "Review retained changes. A failed request never discards your edits.",()=>Enter("drafts"));
                foreach(string group in SettingsCatalog.All.Select(s=>s.Group).Distinct()){string g=group;Add(g,"Settings", "Open "+g+" settings.",()=>Enter("group:"+g));}
                Add("World director","14 live settings","Original world settings have their own revision.",()=>Enter("world"));
                Add("Profiles and presets",profiles.Count.ToString(),"Apply, save, rename, delete, export or import a full profile.",()=>{RefreshProfiles();Enter("profiles");});
                Add("AI Settings Advisor","Preview first","Describe the change you want. Nothing applies until you accept the proposal.",()=>TextInput("What would you like to change?","",v=>StartAi("advisor",new Dictionary<string,object>{{"intent",v}})));
                Add("NPC inspector",inspect().Length+" observed","Real observed NPC mind, physical state and working transcript.",()=>Enter("inspect"));
                Add("AI usage and connection","Refresh on open","Queue, budget, recent jobs and provider availability, with observation time.",()=>{RefreshStatus();Enter("status");});
                Add("Diagnostics and self-test","Local evidence","Version guard, measured Tick costs and menu/input diagnostics.",()=>Enter("diagnostics"));
                Add("Panic stop","Cancel owned work","Cancels owned AI and scenarios. Menu remains available.",()=>Confirm("Stop NPC and world work now?",()=>{PanicStop();panic();}));
                Add("Close menu","Back / Escape","Release every menu control mask.",Close);return;
            }
            if(nav.Page.StartsWith("group:",StringComparison.Ordinal)||nav.Page=="search"||nav.Page=="world") {
                var specs=nav.Page=="world"?WorldDefinitions():nav.Page=="search"?SettingsCatalog.All.Concat(WorldDefinitions()).Where(s=>(s.Label+" "+s.Key+" "+s.Tooltip).IndexOf(filter,StringComparison.OrdinalIgnoreCase)>=0).ToArray():SettingsCatalog.All.Where(s=>s.Group==nav.Page.Substring(6)).ToArray();
                if(nav.Page=="search"){Add("Change search",filter,"Search every setting's label and help text.",()=>TextInput("Search settings",filter,v=>{filter=v;nav.Selected=nav.Scroll=0;}));Add("Clear search","Show all", "Clear the query without requiring an empty keyboard submission.",()=>{filter="";nav.Selected=nav.Scroll=0;});}
                foreach(var definition in specs){var spec=definition;bool isWorld=spec.Group=="World director";object value=Value(spec,isWorld);string label=spec.Key.Contains("controller")||spec.Key.EndsWith("menuModifier",StringComparison.Ordinal)?InputLabels.Button((int)NpcMind.Number(value),settings.Text("controls.promptStyle")=="playstation"):MenuRules.Display(value);
                    Add(spec.Label,label,spec.Tooltip+" Default: "+MenuRules.Display(spec.Default)+(spec.Kind=="number"?" Range "+spec.Min+"–"+spec.Max:""),()=>Edit(spec,isWorld),d=>{if(spec.Kind=="boolean"||spec.Kind=="number"||spec.Options.Length>0)Change(spec,MenuRules.Step(spec,Value(spec,isWorld),d),isWorld);},isWorld?"world."+spec.Key:spec.Key);}
                if(specs.Length==0)Add("No matching settings","","Use a shorter search phrase.");return;
            }
            if(nav.Page=="drafts") {foreach(var p in draft)Add(p.Key,MenuRules.Display(p.Value),"Retained NPC setting edit.");foreach(var p in worldDraft)Add("world."+p.Key,MenuRules.Display(p.Value),"Retained world setting edit.");Add("Refresh and rebase edits","Explicit retry","Refreshes both revisions and validates this draft against current server values before applying.",RebaseDraft);Add("Discard pending edits","Keep server values","Drops only unsent draft changes.",()=>{if(requestPending){message="Wait for the submitted request before discarding.";return;}draft.Clear();worldDraft.Clear();draftBase.Clear();worldDraftBase.Clear();draftBlocked=false;nav.Back();});return;}
            if(nav.Page=="profiles"){
                Add("Save current as...","Custom profile","Saves the current NPC and world settings, including controller bindings.",()=>TextInput("New custom profile name","",v=>Request("POST","api/profiles",new Dictionary<string,object>{{"name",v}},ProfileReply)));
                Add("Import local profile","Profiles folder","Select a bounded JSON file from the fixed LocalAppData Profiles folder.",()=>Local(()=>new Dictionary<string,object>{{"files",files.List()}},(r,e)=>{if(e!=null){message=e;return;}paragraphs.Clear();paragraphs.AddRange(((System.Collections.IEnumerable)r["files"]).Cast<object>().Select(Convert.ToString));Enter("imports");}));
                foreach(var p in profiles){string name=Wire.Text(p,"name",40);Add(name,Wire.Boolean(p,"builtin")?"Preset":"Custom","Open this profile's actions.",()=>Enter("profile:"+name));}return;
            }
            if(nav.Page.StartsWith("profile:",StringComparison.Ordinal)){
                string name=nav.Page.Substring(8),route="api/profiles/"+Uri.EscapeDataString(name);bool builtin=profiles.Any(p=>(string)p["name"]==name&&Wire.Boolean(p,"builtin"));
                Add("Apply "+name,"Both revisions","Applies NPC and world settings together. A stale revision rejects the complete operation.",()=>Confirm("Apply profile "+name+"?",()=>Request("POST",route+"/apply",new Dictionary<string,object>{{"expectedRevision",serverRevision},{"expectedWorldRevision",serverWorldRevision}},BundleReply)));
                Add("Export JSON","Local profile folder","Writes only this profile's settings. No keys, transcript or game save is exported.",()=>Request("GET",route+"/export",null,(r,e)=>{if(e!=null){message=e;return;}var profile=Wire.Map(Wire.Value(r,"profile"));Local(()=>new Dictionary<string,object>{{"path",files.Write(name,profile)}},(data,error)=>message=error??"Export saved in LocalAppData / LivingLosSantos / Enhanced / Profiles.");}));
                if(!builtin){Add("Rename profile","","Choose a unique custom profile name.",()=>TextInput("Rename profile",name,v=>Request("PATCH",route,new Dictionary<string,object>{{"name",v}},(r,e)=>{ProfileReply(r,e);if(e==null){nav.Back();}})));Add("Delete profile","Confirm","Deletes the stored custom profile; current settings remain active.",()=>Confirm("Delete custom profile "+name+"?",()=>Request("DELETE",route,null,(r,e)=>{ProfileReply(r,e);if(e==null)nav.Back();})));}return;
            }
            if(nav.Page=="imports") {foreach(string filename in paragraphs.ToArray()){string n=filename;Add(n,"Import","Validates the complete profile before saving it; importing does not apply it.",()=>Local(()=>new Dictionary<string,object>{{"profile",files.Read(n)}},(r,e)=>{if(e!=null){message=e;return;}Request("POST","api/profiles/import",r,ProfileReply);}));}if(rows.Count==0)Add("No JSON profiles found","","Place an exported profile in LocalAppData / LivingLosSantos / Enhanced / Profiles.");return;}
            if(nav.Page=="inspect"){foreach(var npc in inspect()){string id=Wire.Text(npc,"id",128);Add(Wire.Text(npc,"name",80),MenuRules.Display(npc["health"])+" health","Inspect current observations. Names are observed labels until AI persona hydration is enabled.",()=>Enter("npc:"+id));}if(rows.Count==0)Add("No observed NPCs","","Return to a visible outdoor Story Mode scene.");return;}
            if(nav.Page.StartsWith("npc:",StringComparison.Ordinal)){var n=inspect().FirstOrDefault(x=>(string)x["id"]==nav.Page.Substring(4));if(n==null){Add("NPC no longer observed","","No stale handle is used.");return;}foreach(string key in new[]{"name","faction","health","weapon","distance","recentDamage","inCombat","owned","observationAgeSeconds"}){object v;if(n.TryGetValue(key,out v))Add(key,MenuRules.Display(v),"Observed NPC "+key+".");}var mind=Wire.Map(Wire.Value(n,"mind"));foreach(var p in mind)Add("Mind / "+p.Key,MenuRules.Display(p.Value),"Current bounded NPC mental state.");Add("Working transcript","Open","Actual session conversation. Persistent notable memory is a later stage.",()=>{paragraphs.Clear();object raw;if(n.TryGetValue("history",out raw))foreach(var h in Wire.Maps(raw))paragraphs.Add(Wire.Text(h,"role",8)+": "+ResponsePolicy.CleanText(h["text"],800));Enter("transcript");});Add("Memory note",ResponsePolicy.CleanText(n.ContainsKey("memory")?n["memory"]:"",80),ResponsePolicy.CleanText(n.ContainsKey("memory")?n["memory"]:"No note recorded.",400));return;}
            if(nav.Page=="status") {Add("Refresh status",statusAt==DateTime.MinValue?"Not observed":Math.Floor((DateTime.UtcNow-statusAt).TotalSeconds)+" seconds ago","Snapshot observed at "+(statusAt==DateTime.MinValue?"never":statusAt.ToString("u"))+". Select to refresh; no provider request.",RefreshStatus);foreach(var spec in SettingsCatalog.All.Where(s=>s.Key.StartsWith("ai.",StringComparison.Ordinal)&&s.Key.EndsWith("Model",StringComparison.Ordinal)))Add(spec.Label,settings.Text(spec.Key),"Configured model; availability is shown in the refreshed account status.");Add("Test AI connection","Metered request","Sends a small explicit provider check within the shared budget.",()=>StartAi("connection",new Dictionary<string,object>()));FlattenStatus(status,"",0);return;}
            if(nav.Page=="diagnostics") {Add("Export sanitized diagnostics","Save report","Saves observed versions, settings and bounded error codes without credentials or transcripts.",()=>Request("POST","api/diagnostics/export",new Dictionary<string,object>(),(r,e)=>message=e??("Exported "+Wire.Text(r,"filename",160)+" ("+Wire.Integer(r,"bytes",0,1048576)+" bytes)")));foreach(var p in diagnostics())Add(p.Key,MenuRules.Display(p.Value),"Actual local diagnostic value: "+MenuRules.Display(p.Value));Add("Explain a diagnostic","AI analysis","Reads safe diagnostic summaries without keys or private transcripts.",()=>StartAi("diagnose",new Dictionary<string,object>()));Add("Menu self-test","Run","Checks layout bounds, settings metadata, state release, sound and optional vibration.",SelfTest);Add("Input conflict guide","Open","Reserved console, stock game controls and scoped masks.",()=>{paragraphs.Clear();paragraphs.AddRange(new[]{"F4 remains SHVDN console; F8 remains director toggle.","F6/F7 overlap stock character shortcuts: consumed only by valid mod actions.","Controller menu: hold RB + View. Panic: hold RB + R3.","D-pad Right starts talk. Reply wheel is scheduled for the next conversation stage.","L3 push-to-talk is opt-in and only captured during a conversation.","Combat, aiming, weapon wheel, phone, cutscene and pause guards prevent unsafe activation.","Only the menu's used controls are disabled for its current frame. Closing, pause, abort and errors release them.","Other mods may bind these controls. Rebind in Controls and verify on your physical controller."});Enter("help");});return;}
            if(nav.Page=="proposal") {if(proposal==null){Add("No active proposal","","Ask the Settings Advisor from the home page.");return;}Add("Advisor summary","",Wire.Text(proposal,"summary",1200));foreach(var change in Wire.Maps(Wire.Value(proposal,"changes")))Add(Wire.Text(change,"label",100),MenuRules.Display(change["before"])+" → "+MenuRules.Display(change["after"]),Wire.Text(change,"reason",600));Add("Accept proposal","Explicit apply","Applies exactly the previewed NPC and world changes, only while both revisions are current.",AcceptProposal);Add("Reject proposal","Keep current settings","Discards this proposal.",RejectProposal);return;}
            if(nav.Page=="confirm"){Add("Confirm","",confirmText);Add("Cancel","","Keep the current state.");return;}
            if(nav.Page=="transcript"||nav.Page=="help"||nav.Page=="answer"){foreach(string line in paragraphs)Add(MenuRules.Clip(line,58),"",line);if(rows.Count==0)Add("Nothing recorded","","No synthetic history is shown.");return;}
        }
        private Action confirmAction;private string confirmText;
        private void Confirm(string prompt,Action action){confirmText=prompt;confirmAction=action;Enter("confirm");}
        private void Edit(SettingDefinition spec,bool isWorld)
        {
            if(!isWorld&&spec.Key.StartsWith("controls.",StringComparison.Ordinal)&&(spec.Key.EndsWith("Key",StringComparison.Ordinal)||spec.Key.Contains("controller")||spec.Key.EndsWith("menuModifier",StringComparison.Ordinal))){nav.Capturing=true;nav.CaptureKey=spec.Key;captureReady=false;message="Release the select button, then press the new "+(spec.Key.EndsWith("Key",StringComparison.Ordinal)?"keyboard key":"controller button")+". Escape cancels.";return;}
            if(spec.Kind=="boolean"||spec.Options.Length>0){Change(spec,MenuRules.Step(spec,Value(spec,isWorld),1),isWorld);return;}
            TextInput(spec.Label,MenuRules.Display(Value(spec,isWorld)),v=>{object result=v;if(spec.Kind=="number"){double parsed;if(!Double.TryParse(v,NumberStyles.Float,CultureInfo.InvariantCulture,out parsed)){message="Use a number with a decimal point.";return;}result=parsed;}Change(spec,result,isWorld);});
        }
        private void TextInput(string purpose,string initial,Action<string> done){message=purpose;if(Game.LastInputMethod==InputMethod.GamePad){virtualKeyboard=new VirtualKeyboard(initial,600);virtualDone=done;virtualPurpose=purpose;Enter("text");return;}keyboardResult=done;Function.Call(Hash.DISPLAY_ONSCREEN_KEYBOARD,0,"FMMC_KEY_TIP8","",ResponsePolicy.CleanText(initial,600),"","","",600);}
        private void FinishVirtual(bool accept){string value=virtualKeyboard.Value;var done=virtualDone;virtualKeyboard=null;virtualDone=null;nav.Back();if(accept&&value.Trim().Length>0)done(value.Trim());}
        private void Activate(){if(virtualKeyboard!=null){string result=virtualKeyboard.Select();if(result!=null)FinishVirtual(result=="done");Feedback(true);return;}if(nav.Page=="confirm"){if(nav.Selected==0){var action=confirmAction;nav.Back();confirmAction=null;action();}else nav.Back();return;}if(nav.Selected>=0&&nav.Selected<rows.Count&&rows[nav.Selected].Activate!=null){rows[nav.Selected].Activate();Feedback(true);}}
        private void Move(int delta){if(virtualKeyboard!=null)virtualKeyboard.Move(0,delta);else nav.Move(delta,nav.Page=="confirm"?2:rows.Count,layout.VisibleRows);Feedback(false);}
        private void Adjust(int direction){if(virtualKeyboard!=null){virtualKeyboard.Move(direction,0);return;}if(nav.Selected>=0&&nav.Selected<rows.Count&&rows[nav.Selected].Adjust!=null)rows[nav.Selected].Adjust(direction);}
        private void Back(){if(virtualKeyboard!=null){FinishVirtual(false);return;}if(nav.Page=="proposal"&&proposal!=null){RejectProposal();return;}nav.Back();if(!IsOpen)Close();Feedback(false);}
        private void HandleKeys()
        {
            Keys key;int count=0;while(count++<16&&keys.TryDequeue(out key)){
                if(key==Keys.Escape||key==Keys.Back){Back();continue;}
                if(nav.Capturing){if(nav.CaptureKey.EndsWith("Key",StringComparison.Ordinal)){var spec=SettingsCatalog.All.First(s=>s.Key==nav.CaptureKey);Change(spec,key.ToString(),false);if(draft.ContainsKey(spec.Key))nav.Capturing=false;}continue;}
                if(key.ToString()==settings.Text("controls.menuKey")){Close();return;}
                if(key==Keys.Up)Move(-1);else if(key==Keys.Down)Move(1);else if(key==Keys.Left)Adjust(-1);else if(key==Keys.Right)Adjust(1);else if(key==Keys.Enter)Activate();else if(key==Keys.PageDown)Move(layout.VisibleRows);else if(key==Keys.PageUp)Move(-layout.VisibleRows);else if(key==Keys.F1)ExplainSelected();
            }
        }
        private static bool Pressed(int c){return Game.IsControlPressed((Control)c)||Function.Call<bool>(Hash.IS_DISABLED_CONTROL_PRESSED,0,c);}
        private static bool Just(int c){return Game.IsControlJustPressed((Control)c)||Function.Call<bool>(Hash.IS_DISABLED_CONTROL_JUST_PRESSED,0,c);}
        private void HandleController()
        {
            if(Game.LastInputMethod!=InputMethod.GamePad)return;
            if(nav.Capturing&&!nav.CaptureKey.EndsWith("Key",StringComparison.Ordinal)){bool any=CapturedControls.Any(Pressed);if(!captureReady){captureReady=!any;return;}foreach(int c in CapturedControls)if(Just(c)){var spec=SettingsCatalog.All.First(s=>s.Key==nav.CaptureKey);Change(spec,c,false);if(draft.ContainsKey(spec.Key))nav.Capturing=false;return;}return;}
            if(nav.Capturing)return;
            if(Just(202)){Back();return;}if(Just(201))Activate();if(Just(203))ExplainSelected();
            int direction=Pressed(172)?-1:Pressed(173)?1:0;
            float axis=Game.GetDisabledControlValueNormalized((Control)196);if(direction==0&&Math.Abs(axis)>settings.Number("controls.deadzone"))direction=axis>0?1:-1;
            if(direction!=0&&(Just(172)||Just(173)||DateTime.UtcNow>=nextRepeat)){Move(direction);nextRepeat=DateTime.UtcNow.AddMilliseconds(180);}
            if(Just(174))Adjust(-1);if(Just(175))Adjust(1);
        }
        private void HandleMouse()
        {
            if(Game.LastInputMethod!=InputMethod.MouseAndKeyboard||nav.Capturing)return;
            Function.Call(Hash.SET_MOUSE_CURSOR_THIS_FRAME);
            float x=Game.GetDisabledControlValueNormalized((Control)239)*Screen.ScaledWidth,y=Game.GetDisabledControlValueNormalized((Control)240)*720;
            if(virtualKeyboard!=null){float cell=(layout.Width-36*layout.Scale)/10;int column=(int)((x-layout.X-18*layout.Scale)/cell),line=(int)((y-layout.Y-layout.HeaderHeight)/layout.RowHeight);int key=(line+virtualKeyboard.FirstRow)*10+column;if(x>=layout.X+18*layout.Scale&&x<layout.X+layout.Width-18*layout.Scale&&y>=layout.Y+layout.HeaderHeight&&line>=0&&line<layout.VisibleRows&&column>=0&&column<10&&key<virtualKeyboard.Count){if(Math.Abs(x-mouseX)>1||Math.Abs(y-mouseY)>1){virtualKeyboard.Selected=key;mouseX=x;mouseY=y;}if(Just(237)){virtualKeyboard.Selected=key;Activate();}}if(Just(238))Back();if(virtualKeyboard!=null){if(Just(241))Move(-1);if(Just(242))Move(1);}return;}
            int row=layout.RowAt(x,y,nav.Scroll,rows.Count);
            if(row>=0&&(Math.Abs(x-mouseX)>1||Math.Abs(y-mouseY)>1)){nav.Selected=row;mouseX=x;mouseY=y;}
            if(Just(237)&&row>=0){nav.Selected=row;Activate();}if(Just(238))Back();if(Just(241))Move(-1);if(Just(242))Move(1);
        }
        private void Draw()
        {
            nav.Fit(rows.Count,layout.VisibleRows);float s=layout.Scale;int alpha=(int)(settings.Number("controls.menuOpacity")*255);
            Color accent=settings.Text("controls.accent")=="amber"?Color.FromArgb(255,230,181,69):settings.Text("controls.accent")=="white"?Color.White:Color.FromArgb(255,84,222,220);
            Box(panel,layout.X,layout.Y,layout.Width,layout.Height,Color.FromArgb(alpha,14,20,27));Box(stripe,layout.X,layout.Y,5*s,layout.Height,accent);
            int index=0;Text(ref index,"LIVING LOS SANTOS",layout.X+18*s,layout.Y+12*s,.46f*s,Color.White);
            Text(ref index,MenuRules.Clip(nav.Breadcrumb,75),layout.X+18*s,layout.Y+46*s,.27f*s,accent);
            if(virtualKeyboard!=null){virtualKeyboard.Fit(layout.VisibleRows);float cell=(layout.Width-36*s)/10;for(int k=virtualKeyboard.FirstRow*10;k<Math.Min(virtualKeyboard.Count,(virtualKeyboard.FirstRow+layout.VisibleRows)*10);k++){float x=layout.X+18*s+(k%10)*cell,y=layout.Y+layout.HeaderHeight+(k/10-virtualKeyboard.FirstRow)*layout.RowHeight;if(k==virtualKeyboard.Selected)Box(highlight,x,y,cell-2*s,layout.RowHeight,Color.FromArgb(230,44,65,80));var item=text[k%text.Length];item.Caption=virtualKeyboard.Label(k);item.Position=new PointF(x+3*s,y+5*s);item.Scale=.24f*s;item.Color=k==virtualKeyboard.Selected?accent:Color.White;item.Alignment=Alignment.Left;item.WrapWidth=0;item.ScaledDraw();}index=0;float foot=layout.Y+layout.HeaderHeight+layout.VisibleRows*layout.RowHeight+8*s;Text(ref index,MenuRules.Clip(virtualPurpose+" ("+virtualKeyboard.Value.Length+"/"+virtualKeyboard.Limit+"): "+(virtualKeyboard.Value.Length>180?"…"+virtualKeyboard.Value.Substring(virtualKeyboard.Value.Length-180):virtualKeyboard.Value),235),layout.X+18*s,foot,.26f*s,Color.White,false,layout.Width-36*s);Text(ref index,"D-pad Move • "+Button(223)+" Type • "+Button(225)+" Cancel • select Done to submit",layout.X+18*s,layout.Y+layout.Height-25*s,.23f*s,accent);return;}
            for(int i=0;i<layout.VisibleRows&&nav.Scroll+i<rows.Count;i++){int row=nav.Scroll+i;float y=layout.Y+layout.HeaderHeight+i*layout.RowHeight;bool selected=row==nav.Selected;if(selected)Box(highlight,layout.X+8*s,y,layout.Width-16*s,layout.RowHeight,Color.FromArgb(220,44,65,80));Text(ref index,MenuRules.Clip(rows[row].Label,44),layout.X+18*s,y+4*s,.29f*s,selected?Color.White:Color.FromArgb(230,215,221,227));Text(ref index,MenuRules.Clip(rows[row].Value,26),layout.X+layout.Width-18*s,y+4*s,.27f*s,accent,true);}
            float footer=layout.Y+layout.HeaderHeight+layout.VisibleRows*layout.RowHeight+8*s;
            string tooltip=nav.Capturing?message:rows.Count>0?rows[nav.Selected].Help:"";
            Text(ref index,MenuRules.Clip(tooltip,235),layout.X+18*s,footer,.25f*s,Color.FromArgb(245,199,210,217),false,layout.Width-36*s);
            string sync=draftBlocked?"Draft needs review":draft.Count+worldDraft.Count>0?"Draft pending":requestPending?"Saving...":settings.Revision<serverRevision||WorldRevision()<serverWorldRevision?"Saved; pending game application":"Applied NPC r"+Math.Max(0,settings.Revision)+" / world r"+WorldRevision();
            Text(ref index,MenuRules.Clip(sync+" • "+message,115),layout.X+18*s,footer+57*s,.22f*s,accent,false,layout.Width-36*s);
            Text(ref index,Game.LastInputMethod==InputMethod.GamePad?"D-pad / stick Move • "+Button(223)+" Select • "+Button(225)+" Back • "+Button(224)+" Explain":"↑ ↓ Move • ← → Change • Enter Select • Esc Back • F1 Explain",layout.X+18*s,layout.Y+layout.Height-22*s,.22f*s,Color.White);
        }
        private static void Box(ContainerElement box,float x,float y,float width,float height,Color color){box.Position=new PointF(x,y);box.Size=new SizeF(width,height);box.Color=color;box.ScaledDraw();}
        private void Text(ref int index,string caption,float x,float y,float scale,Color color,bool right=false,float wrap=0){if(index>=text.Length)return;var item=text[index++];item.Caption=ResponsePolicy.CleanText(caption,600);item.Position=new PointF(x,y);item.Scale=scale;item.Color=color;item.Alignment=right?Alignment.Right:Alignment.Left;item.WrapWidth=wrap;item.ScaledDraw();}
        private void Feedback(bool accepted){if(settings.Flag("general.menuSounds"))Function.Call(Hash.PLAY_SOUND_FRONTEND,-1,accepted?"SELECT":"NAV_UP_DOWN","HUD_FRONTEND_DEFAULT_SOUNDSET",true);if(accepted&&settings.Flag("controls.vibration")&&Game.IsVibrationEnabled&&Game.LastInputMethod==InputMethod.GamePad)Function.Call(Hash.SET_CONTROL_SHAKE,0,70,40);}
        private void ProfileReply(Dictionary<string,object> response,string error){if(error!=null){message=error;return;}profiles.Clear();profiles.AddRange(Wire.Maps(Wire.Value(response,"profiles")).Take(40));message="Profile saved. Current game settings are unchanged until Apply.";}
        private void BundleReply(Dictionary<string,object> response,string error){if(error!=null){message=error.Contains("409")?"Profile rejected because settings changed elsewhere. Refresh and retry.":error;Refresh();return;}serverRevision=Wire.Integer(response,"revision",0,Int32.MaxValue);serverWorldRevision=Wire.Integer(Wire.Map(Wire.Value(response,"world")),"revision",0,Int32.MaxValue);if(draft.Count+worldDraft.Count>0)draftBlocked=true;message=draftBlocked?"Profile applied; pending edits need explicit review and rebase.":"Profile saved; waiting for both game revisions.";}
        private void RefreshStatus(){Request("GET","api/ai/status",null,(r,e)=>{if(e!=null){message=e;return;}status=r;statusAt=DateTime.UtcNow;message="Companion status refreshed.";});}
        private void FlattenStatus(Dictionary<string,object> data,string prefix,int depth){foreach(var p in data){if(rows.Count>=100)return;var map=p.Value as Dictionary<string,object>;if(map!=null&&depth<3){FlattenStatus(map,prefix+p.Key+" / ",depth+1);continue;}if(p.Value is string||p.Value is bool||p.Value is int||p.Value is double||p.Value is decimal||p.Value is long)Add(MenuRules.Clip(prefix+p.Key,55),MenuRules.Display(p.Value),prefix+p.Key+": "+MenuRules.Display(p.Value));else if(p.Value is System.Collections.IEnumerable&&depth<3){int i=0;foreach(object entry in (System.Collections.IEnumerable)p.Value){if(i++>=16||rows.Count>=100)break;var item=entry as Dictionary<string,object>;if(item!=null)FlattenStatus(item,prefix+p.Key+"["+i+"] / ",depth+1);else Add(prefix+p.Key+"["+i+"]",MenuRules.Display(entry),"Companion status array entry observed at "+statusAt.ToString("u"));}}}}
        private string Button(int id){return InputLabels.Button(id,settings.Text("controls.promptStyle")=="playstation");}
        private void StartAi(string kind,Dictionary<string,object> context)
        {
            if(jobId!=null||jobSubmitting){message="Another menu AI job is pending; close the menu to cancel it.";return;}int currentGeneration=generation;message="AI "+kind+" queued; awaiting result.";jobSubmitting=true;
            Request("POST","api/ai/menu/jobs",new Dictionary<string,object>{{"requestId",Guid.NewGuid().ToString()},{"kind",kind},{"context",context}},(r,e)=>{jobSubmitting=false;if(e!=null){if(generation==currentGeneration)message=e;return;}var job=Wire.Map(Wire.Value(r,"job"));string id=Wire.Text(job,"id",128);if(!IsOpen||generation!=currentGeneration){Request("DELETE","api/ai/menu/jobs/"+id,null,(a,b)=>{});return;}jobKind=kind;jobId=id;pollErrors=0;nextPoll=DateTime.MinValue;});
        }
        private void PollJob()
        {
            if(jobId==null||pollPending||DateTime.UtcNow<nextPoll)return;pollPending=true;string id=jobId;
            Request("GET","api/ai/menu/jobs/"+id,null,(r,e)=>{pollPending=false;nextPoll=DateTime.UtcNow.AddMilliseconds(750);if(jobId!=id)return;if(e!=null){message=e;pollErrors++;nextPoll=DateTime.UtcNow.AddSeconds(Math.Min(5,pollErrors));if(pollErrors>=3){Request("DELETE","api/ai/menu/jobs/"+id,null,(a,b)=>{});jobId=null;message="AI status unavailable after three tries; cancellation requested.";}return;}pollErrors=0;var job=Wire.Map(Wire.Value(r,"job"));string state=Wire.Text(job,"status",32);if(state=="failed"||state=="cancelled"||state=="rejected"){message="AI "+state+": "+ResponsePolicy.CleanText(job.ContainsKey("reasonCode")?job["reasonCode"]:"unknown",120);jobId=null;return;}if(state!="completed")return;jobId=null;var result=Wire.Map(Wire.Value(job,"result"));if(jobKind=="advisor"){proposal=Wire.Map(Wire.Value(result,"proposal"));Enter("proposal");}else{paragraphs.Clear();foreach(var p in result){if(p.Value is string||p.Value is bool||p.Value is int||p.Value is double)paragraphs.Add(p.Key+": "+MenuRules.Display(p.Value));else if(p.Key=="findings")foreach(var finding in Wire.Maps(p.Value))paragraphs.Add(Wire.Text(finding,"severity",16)+": "+Wire.Text(finding,"message",600));}Enter("answer");}message="AI result received. Advice has not been applied.";});
        }
        private void ExplainSelected(){if(nav.Selected<0||nav.Selected>=rows.Count)return;string key=rows[nav.Selected].SettingKey;if(key==null){message="This row has local help below. Select a setting for AI explanation.";return;}StartAi("explain",new Dictionary<string,object>{{"settingKey",key}});}
        private void AcceptProposal(){if(proposal==null||proposalApplying)return;var p=proposal;proposalApplying=true;Request("POST","api/ai/advisor/proposals/"+Wire.Text(p,"id",128)+"/accept",new Dictionary<string,object>{{"expectedRevision",Wire.Integer(p,"expectedRevision",0,Int32.MaxValue)},{"expectedWorldRevision",Wire.Integer(p,"expectedWorldRevision",0,Int32.MaxValue)}},(r,e)=>{proposalApplying=false;if(e!=null){message=e;return;}proposal=null;BundleReply(MenuRules.AdvisorBundle(r),null);if(IsOpen&&nav.Page=="proposal")nav.Back();});}
        private void RejectProposal(){if(proposal==null||proposalApplying)return;string id=Wire.Text(proposal,"id",128);proposal=null;Request("POST","api/ai/advisor/proposals/"+id+"/reject",new Dictionary<string,object>(),(r,e)=>message=e??"Proposal rejected. No setting changed.");nav.Back();}
        private void SelfTest(){paragraphs.Clear();try{SettingsCatalog.Validate(SettingsCatalog.Defaults());var p=MenuLayout.Compute(Screen.ScaledWidth,Screen.SafeZoneSizeProfile,(float)settings.Number("controls.menuScale"),0,0);if(p.X<0||p.Y<0||p.Y+p.Height>720)throw new InvalidOperationException("Layout bounds failed.");var state=new MenuNavigation();state.Show();state.Capturing=true;state.Close();if(state.Open||state.Capturing)throw new InvalidOperationException("Control release state failed.");paragraphs.Add("VERIFIED now: generated defaults, current layout bounds and close/capture state checks passed.");paragraphs.Add("Measured current viewport width: "+Screen.ScaledWidth+"; safe-zone ratio: "+Screen.SafeZoneSizeProfile+".");paragraphs.Add("Native drawing is active on this page. Visually check clipping, contrast and every input device.");paragraphs.Add("Select played enabled menu sound and optional controller vibration; perception requires your confirmation.");paragraphs.Add("No NPC, vehicle, weapon or world state was created by this self-test.");Feedback(true);}catch(Exception ex){paragraphs.Add("Self-test failed: "+ex.GetType().Name);}Enter("answer");}
        public static SettingDefinition[] WorldDefinitions()
        {
            var list=new List<SettingDefinition>();var defaults=new DirectorSettings().Snapshot();
            foreach(var p in defaults){bool boolean=p.Value is bool;double min=0,max=100;if(p.Key=="eventIntervalSeconds"){min=30;max=300;}if(p.Key=="maxActiveEvents"){min=1;max=3;}if(p.Key=="maxSpawnedPeds"){min=4;max=24;}
                list.Add(new SettingDefinition{Key=p.Key,Label=System.Text.RegularExpressions.Regex.Replace(p.Key,"([a-z])([A-Z])","$1 $2"),Group="World director",Kind=boolean?"boolean":"number",Default=p.Value,Min=min,Max=max,Step=1,Options=new string[0],Tooltip="Live world director setting. " + (p.Key=="maxSpawnedPeds"?"Lowering this removes owned encounters to meet the budget.":p.Key=="protectMissions"?"Story protection also follows the overhaul Safety setting.":"Applied by the original world director through its acknowledged revision."),Consumer="game"});}return list.ToArray();
        }
    }
    internal static class QueueExtensions {public static void ClearSafe<T>(this ConcurrentQueue<T> queue){T value;while(queue.TryDequeue(out value)){} }}
}
