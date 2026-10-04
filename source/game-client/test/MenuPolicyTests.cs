using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using LivingLosSantosV2;

internal static class MenuPolicyTests
{
    private static void Assert(bool value){if(!value)throw new Exception("Menu assertion failed.");}
    private static void Reject(Action action){bool rejected=false;try{action();}catch{rejected=true;}Assert(rejected);}
    public static void Run(Action<string,Action> check)
    {
        check("menu layout remains in safe zone at all supported scales",delegate{foreach(float width in new[]{960f,1280f,1720f,2560f})foreach(float safe in new[]{.8f,.9f,1f})foreach(float scale in new[]{.7f,1f,1.5f}){var p=MenuLayout.Compute(width,safe,scale,.95f,.95f);float mx=(1-safe)*width/2+12,my=(1-safe)*720/2+12;Assert(p.X>=mx-.01&&p.Y>=my-.01&&p.X+p.Width<=width-mx+.01&&p.Y+p.Height<=720-my+.01&&p.VisibleRows>=3);}});
        check("menu hit testing excludes header footer and outside rows",delegate{var p=MenuLayout.Compute(1280,1,1,0,0);Assert(p.RowAt(p.X+1,p.Y+1,0,20)==-1);Assert(p.RowAt(p.X+1,p.Y+p.HeaderHeight+1,4,20)==4);Assert(p.RowAt(p.X+1,p.Y+p.HeaderHeight+p.VisibleRows*p.RowHeight,0,20)==-1);Assert(p.RowAt(p.X-1,p.Y+p.HeaderHeight,0,20)==-1);});
        check("navigation wraps and scrolls into visible rows",delegate{var n=new MenuNavigation();n.Show();n.Enter("group:Controls");n.Move(-1,20,5);Assert(n.Selected==19&&n.Scroll==15);n.Move(1,20,5);Assert(n.Selected==0&&n.Scroll==0);n.Back();Assert(n.Page=="home");});
        check("close clears capture breadcrumb selection and open state",delegate{var n=new MenuNavigation();n.Show();n.Enter("deep");n.Capturing=true;n.CaptureKey="controls.talkKey";n.Close();Assert(!n.Open&&!n.Capturing&&n.CaptureKey==null&&n.Page=="home"&&n.Scroll==0);n.Show();n.Back();Assert(!n.Open);});
        check("controller keyboard scrolls selected last row without footer overlap",delegate{var k=new VirtualKeyboard("",20);k.Selected=k.Count-1;k.Fit(3);Assert(k.FirstRow>0&&k.Selected/10<k.FirstRow+3);k.Selected=0;k.Fit(3);Assert(k.FirstRow==0);});
        check("controller keyboard input bound delete clear and done",delegate{var k=new VirtualKeyboard("",2);k.Select();k.Move(1,0);k.Select();k.Move(1,0);k.Select();Assert(k.Value=="ab");k.Selected=VirtualKeyboard.Characters.Length;k.Select();Assert(k.Value=="a");k.Selected=VirtualKeyboard.Characters.Length+2;k.Select();Assert(k.Value=="");k.Selected=VirtualKeyboard.Characters.Length+3;Assert(k.Select()=="done");k.Selected++;Assert(k.Select()=="cancel");});
        check("failed settings submission retains exact draft",delegate{var p=new Dictionary<string,object>{{"world.aggression",42}};var sent=MenuRules.Clone(p);MenuRules.FinishSubmission(p,sent,false);Assert(p.Count==1&&(int)p["world.aggression"]==42);MenuRules.FinishSubmission(p,sent,true);Assert(p.Count==0);});
        check("older successful submission preserves newer edit",delegate{var p=new Dictionary<string,object>{{"x",1}};var sent=MenuRules.Clone(p);p["x"]=2;MenuRules.FinishSubmission(p,sent,true);Assert((int)p["x"]==2);});
        check("pending draft keeps original base across external revision",delegate{var basis=new DraftRevision();basis.Begin(3);basis.Begin(4);Assert(basis.Value==3);basis.Rebase(4);Assert(basis.Value==4);basis.Submitted(5,true);Assert(basis.Value==5);basis.Submitted(6,false);Assert(basis.Value==-1);});
        check("world configuration parses nested compact config revision",delegate{Assert(MenuRules.ConfigRevision(new Dictionary<string,object>{{"config",new Dictionary<string,object>{{"revision",7}}}},true)==7);Reject(delegate{MenuRules.ConfigRevision(new Dictionary<string,object>{{"revision",7}},true);});});
        check("advisor accept adapts separate NPC and world snapshots",delegate{var r=MenuRules.AdvisorBundle(new Dictionary<string,object>{{"npcSettings",new Dictionary<string,object>{{"revision",8}}},{"worldConfig",new Dictionary<string,object>{{"revision",9}}}});Assert(MenuRules.ConfigRevision(r,false)==8&&Wire.Integer(Wire.Map(r["world"]),"revision",0,20)==9);});
        check("normal controller menu leaves accelerator and brake available",delegate{var mask=MenuControlMask.ForMenu(true,false);Assert(!mask.Contains(71)&&!mask.Contains(72)&&mask.Contains(172)&&mask.Contains(201));});
        check("binding capture masks every captured physical trigger alias",delegate{var mask=MenuControlMask.ForMenu(true,true);Assert(mask.Contains(71)&&mask.Contains(72)&&mask.Contains(236)&&mask.Distinct().Count()==mask.Length);});
        check("keyboard menu masks only used cursor selection primitives",delegate{var mask=MenuControlMask.ForMenu(false,false);Assert(mask.Contains(237)&&mask.Contains(238)&&!mask.Contains(71)&&!mask.Contains(72)&&!mask.Contains(32));});
        check("controller physical alias cannot duplicate existing talk button",delegate{var s=SettingsCatalog.Defaults();s["controls.controllerWheel"]=235;Reject(delegate{SettingsCatalog.Validate(s);});Assert(MenuRules.BindingConflict("controls.controllerWheel",235,SettingsCatalog.Defaults())!=null);});
        check("controller axes and impossible directional modifier rejected",delegate{Reject(delegate{SettingsCatalog.Validate(new Dictionary<string,object>{{"controls.controllerTalk",219}});});Reject(delegate{SettingsCatalog.Validate(new Dictionary<string,object>{{"controls.menuModifier",232}});});Assert(SettingsCatalog.Validate(SettingsCatalog.Defaults()).Count==SettingsCatalog.All.Length);});
        check("settings stepping clamps number and wraps choice",delegate{var n=new SettingDefinition{Kind="number",Min=0,Max=10,Step=2,Options=new string[0]};Assert((double)MenuRules.Step(n,9,1)==10&&(double)MenuRules.Step(n,1,-1)==0);var s=new SettingDefinition{Kind="select",Options=new[]{"a","b"}};Assert((string)MenuRules.Step(s,"a",-1)=="b");});
        check("menu transport permits compact revision endpoint and diagnostic export",delegate{Assert(DashboardTransport.MenuRouteAllowed("PATCH","api/world/config?compact=true"));Assert(DashboardTransport.MenuRouteAllowed("POST","api/diagnostics/export"));Assert(!DashboardTransport.MenuRouteAllowed("PATCH","api/world/config?arbitrary=true"));Assert(!DashboardTransport.MenuRouteAllowed("GET","http://example.com"));Assert(!DashboardTransport.MenuRouteAllowed("DELETE","api/profiles/%2e%2e%2fsecret"));});
        check("profile files reject traversal device names and oversized payload",delegate{string folder=Path.Combine(Path.GetTempPath(),"LLAI-menu-policy-"+Guid.NewGuid().ToString("N"));var f=new ProfileFiles(folder);Reject(delegate{f.Read("../secret");});Reject(delegate{f.Read("CON");});Reject(delegate{f.Write("Large",new Dictionary<string,object>{{"x",new string('x',140000)}});});Assert(!Directory.Exists(folder));});
        check("profile export roundtrip stays in dedicated folder",delegate{string folder=Path.Combine(Path.GetTempPath(),"LLAI-menu-policy-"+Guid.NewGuid().ToString("N"));var f=new ProfileFiles(folder);try{f.Write("QA profile",new Dictionary<string,object>{{"version",4},{"name","QA profile"}});Assert(f.List().SequenceEqual(new[]{"QA profile"})&&Wire.Integer(f.Read("QA profile"),"version",4,4)==4);}finally{if(Directory.Exists(folder))Directory.Delete(folder,true);}});
        check("simplified menu: <=6 pages, <=8 rows each, every key resolves, world keys by prefix",delegate{
            Assert(MenuPages.Pages.Length<=6);var world=NativeMenuWorldDefinitions();
            foreach(var p in MenuPages.Pages){Assert(p.Items.Length<=8);foreach(var i in p.Items)if(i.Kind=="setting")foreach(var k in i.Keys){var d=MenuPageRules.Definition(k,world);Assert(d.Key==MenuPageRules.StoreKey(k));Assert(MenuPageRules.IsWorld(k)==(Array.IndexOf(world,d)>=0));}}
            // NPC catalog has a group literally named "World director"; those keys must still resolve as NPC settings.
            foreach(var s in SettingsCatalog.All.Where(x=>x.Group=="World director"))Assert(!MenuPageRules.IsWorld(s.Key)&&MenuPageRules.Definition(s.Key,world)==s);
            Reject(delegate{MenuPageRules.Definition("world.notAKey",world);});Reject(delegate{MenuPageRules.Definition("notA.key",world);});
            Assert(MenuPageRules.Page("advanced").Items.Any(i=>i.Id=="restoreDefaults")&&MenuPageRules.Page("advanced").Items.Any(i=>i.Id=="panic"));
        });
        check("city presets match, cycle and validate in both scopes",delegate{
            var npc=SettingsCatalog.Defaults();var world=new DirectorSettings().Snapshot();Assert(MenuPageRules.MatchCityPreset(npc,world)=="Normal");
            var busy=MenuPages.CityPresets.First(p=>p.Name=="Busy");for(int i=0;i<busy.NpcKeys.Length;i++)npc[busy.NpcKeys[i]]=busy.NpcValues[i];Assert(MenuPageRules.MatchCityPreset(npc,world)=="Custom");
            for(int i=0;i<busy.WorldKeys.Length;i++)world[busy.WorldKeys[i]]=busy.WorldValues[i];Assert(MenuPageRules.MatchCityPreset(npc,world)=="Busy");
            Assert(SettingsCatalog.Validate(npc).Count==SettingsCatalog.All.Length);DirectorSettings.Parse(world);
            Assert(MenuPageRules.NextCityPreset("Normal",1).Name=="Busy"&&MenuPageRules.NextCityPreset("Busy",1).Name=="Quiet"&&MenuPageRules.NextCityPreset("Quiet",-1).Name=="Busy"&&MenuPageRules.NextCityPreset("Custom",1).Name=="Normal");
        });
        check("composite rows report Mixed and switch every key together",delegate{Assert(Equals(MenuPageRules.CompositeValue(new List<object>{true,true}),true));Assert(MenuPageRules.CompositeValue(new List<object>{true,false})==null);Assert(MenuPageRules.CompositeNext(null)&&!MenuPageRules.CompositeNext(true)&&MenuPageRules.CompositeNext(false));});
        check("mic test route is whitelisted for POST only",delegate{Assert(DashboardTransport.MenuRouteAllowed("POST","api/ptt/mic-test"));Assert(!DashboardTransport.MenuRouteAllowed("GET","api/ptt/mic-test"));Assert(DashboardTransport.MenuRouteAllowed("POST","api/profiles/Realistic/apply"));});
    }
    // Mirrors NativeMenu.WorldDefinitions (GTA-dependent class) from the GTA-independent DirectorSettings snapshot.
    private static SettingDefinition[] NativeMenuWorldDefinitions(){return new DirectorSettings().Snapshot().Select(p=>new SettingDefinition{Key=p.Key,Label=p.Key,Group="World director",Kind=p.Value is bool?"boolean":"number",Default=p.Value,Options=new string[0]}).ToArray();}
}
