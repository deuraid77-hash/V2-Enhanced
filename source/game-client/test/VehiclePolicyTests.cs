using System;
using System.Collections.Generic;
using System.Linq;
using LivingLosSantosV2;

internal static class VehiclePolicyTests
{
    private static void Assert(bool value){if(!value)throw new Exception("Vehicle assertion failed.");}
    private static void Reject(Action action){bool rejected=false;try{action();}catch(InvalidOperationException){rejected=true;}Assert(rejected);}
    private static VehiclePolicy.Facts F(Action<VehiclePolicy.Facts> edit){var f=new VehiclePolicy.Facts{Distance=5};edit(f);return f;}
    private static string C(VehiclePolicy.Facts f){return VehiclePolicy.Classify(f,4,5,25);}
    private const string Job="job-1",Runtime="lls4-r",Epoch="e1",Npc="lls4-r:42:-99";
    private static Dictionary<string,object> Beat(string speech,string type,DateTime expires,Action<Dictionary<string,object>> editAction=null)
    {
        var action=new Dictionary<string,object>{{"actionId",Guid.NewGuid().ToString()},{"jobId",Job},{"runtimeId",Runtime},{"sceneEpoch",Epoch},{"npcId",Npc},{"expectedHandle",42},{"expectedModelHash",-99},{"expiresAt",expires.ToString("o")},{"type",type},{"parameters",new Dictionary<string,object>()}};
        if(editAction!=null)editAction(action);
        return new Dictionary<string,object>{{"npcId",Npc},{"expectedHandle",42},{"expectedModelHash",-99},{"speech",speech},{"voiceTone","plain"},{"action",action}};
    }
    private static Dictionary<string,object> Plan(string opportunityId,string scenario,params Dictionary<string,object>[] beats)
    { return new Dictionary<string,object>{{"opportunityId",opportunityId},{"scenario",scenario},{"title","t"},{"beats",beats.Cast<object>().ToArray()}}; }

    public static void Run(Action<string,Action> check)
    {
        check("vehicle classification covers all ten scenarios",delegate{
            Assert(C(F(f=>{f.PlayerJacking=true;f.NpcBeingJacked=true;f.NpcInVehicle=true;}))=="carjack");
            Assert(C(F(f=>{f.HitByPlayerVehicle=true;f.PlayerInVehicle=true;}))=="pedestrianImpact");
            Assert(C(F(f=>{f.SharesPlayerVehicle=true;f.NpcInVehicle=true;f.PlayerInVehicle=true;}))=="passengerChat");
            Assert(C(F(f=>{f.PlayerInVehicle=true;f.NpcInVehicle=true;f.NpcIsDriver=true;f.Contact=true;}))=="roadRage");
            Assert(C(F(f=>{f.NpcIsCop=true;f.Wanted=1;}))=="trafficStop");
            Assert(C(F(f=>{f.NpcGang=true;f.NpcInVehicle=true;f.NpcSpeed=6;f.Distance=20;}))=="driveBy");
            Assert(C(F(f=>{f.VehicleBroken=true;}))=="breakdown");
            Assert(C(F(f=>{f.PlayerInVehicle=true;f.PlayerSeatFree=true;}))=="lifts");
            Assert(C(F(f=>{f.PlayerInVehicle=true;f.NpcInVehicle=true;f.NpcIsDriver=true;f.PlayerSpeed=2;f.NpcSpeed=2;}))=="carToCar");
            Assert(C(F(f=>{f.NpcInVehicle=true;f.Distance=3;}))=="windowTalk");
            Assert(VehiclePolicy.Scenarios.Length==10&&VehiclePolicy.Scenarios.Distinct().Count()==10);
        });
        check("vehicle classification refuses protected combat and distant NPCs",delegate{
            Assert(C(F(f=>{f.NpcInVehicle=true;f.Distance=3;f.NpcProtected=true;}))==null);
            Assert(C(F(f=>{f.NpcInVehicle=true;f.Distance=3;f.NpcInCombat=true;}))==null);
            Assert(C(F(f=>{f.NpcInVehicle=true;f.Distance=3;f.VehicleProtected=true;}))==null);
            Assert(C(F(f=>{f.NpcGang=true;f.NpcInVehicle=true;f.Distance=26;}))==null);
            Assert(C(F(f=>{f.NpcInVehicle=true;f.Distance=Single.NaN;}))==null);
            Assert(C(F(f=>{f.NpcInVehicle=true;f.Distance=5;}))==null); // window range is 4
            Assert(C(F(f=>{f.NpcIsCop=true;f.Wanted=3;}))==null); // only a low wanted level is a stop
            Assert(C(F(f=>{f.PlayerInVehicle=true;f.PlayerSpeed=4;f.PlayerSeatFree=true;}))==null); // moving car is not a lift
            Assert(C(null)==null);
        });
        check("scenario gate enforces cap cooldowns ttl and single claim",delegate{
            var g=new ScenarioGate();var t=new DateTime(2026,1,1,0,0,0,DateTimeKind.Utc);
            var a=g.Offer("windowTalk","n1",t);Assert(a!=null);
            Assert(g.Offer("windowTalk","n2",t)==null); // scenario cooldown
            Assert(g.Offer("carToCar","n1",t)==null); // NPC cooldown
            Assert(g.Offer("invented","n3",t)==null&&g.Offer("lifts","",t)==null);
            Assert(g.Offer("carToCar","n2",t)!=null&&g.Offer("lifts","n3",t)!=null&&g.Offer("roadRage","n4",t)!=null);
            Assert(g.Open.Count==ScenarioGate.MaxOpen&&g.Offer("breakdown","n5",t)==null);
            g.Expire(t.AddSeconds(11));Assert(g.Open.Count==0&&g.Offered(a.Id));
            var claimed=g.Consume(a.Id,t.AddSeconds(20));Assert(claimed!=null&&claimed.NpcId=="n1");
            Assert(g.Consume(a.Id,t.AddSeconds(21))==null);
            var b=g.Offer("windowTalk","n9",t.AddSeconds(46));Assert(b!=null);
            Assert(g.Consume(b.Id,t.AddSeconds(46+61))==null);
            var c=g.Offer("breakdown","n10",t.AddSeconds(200));g.Clear();Assert(g.Consume(c.Id,t.AddSeconds(201))==null&&g.Open.Count==0);
        });
        check("scenario plan validates bounds identity and binding",delegate{
            var now=DateTime.UtcNow;var exp=now.AddSeconds(30);
            var g=new ScenarioGate();var o=g.Offer("roadRage",Npc,now);
            var ok=Plan(o.Id,"roadRage",Beat("Watch it!","HONK_AT_PLAYER",exp),Beat("Idiot.","DRIVE_AWAY",exp));
            var beats=ScenarioPlanPolicy.Parse(ok,Job,Runtime,Epoch,now);Assert(beats.Count==2&&beats[0].ActionType=="HONK_AT_PLAYER"&&beats[0].Handle==42&&beats[0].Model==-99&&beats[0].Tone=="plain");
            ScenarioPlanPolicy.Bind(ok,g.Consume(o.Id,now),beats);
            Reject(delegate{ScenarioPlanPolicy.Bind(ok,g.Consume(o.Id,now),beats);}); // replay
            Reject(delegate{ScenarioPlanPolicy.Parse(Plan(o.Id,"roadRage",Beat("x","INVENTED_ACTION",exp)),Job,Runtime,Epoch,now);});
            Reject(delegate{ScenarioPlanPolicy.Parse(Plan(o.Id,"roadRage",Beat("<~>","TALK_CASUAL",exp)),Job,Runtime,Epoch,now);});
            Reject(delegate{ScenarioPlanPolicy.Parse(Plan(o.Id,"roadRage",Beat("a","TALK_CASUAL",exp),Beat("b","TALK_CASUAL",exp),Beat("c","TALK_CASUAL",exp),Beat("d","TALK_CASUAL",exp),Beat("e","TALK_CASUAL",exp)),Job,Runtime,Epoch,now);});
            Reject(delegate{ScenarioPlanPolicy.Parse(Plan(o.Id,"roadRage"),Job,Runtime,Epoch,now);});
            Reject(delegate{ScenarioPlanPolicy.Parse(Plan(o.Id,"teleport",Beat("a","TALK_CASUAL",exp)),Job,Runtime,Epoch,now);});
            Reject(delegate{ScenarioPlanPolicy.Parse(Plan(o.Id,"roadRage",Beat("a","TALK_CASUAL",exp,x=>x["expectedHandle"]=43)),Job,Runtime,Epoch,now);});
            Reject(delegate{ScenarioPlanPolicy.Parse(Plan(o.Id,"roadRage",Beat("a","TALK_CASUAL",exp,x=>x["sceneEpoch"]="old")),Job,Runtime,Epoch,now);});
            Reject(delegate{ScenarioPlanPolicy.Parse(Plan(o.Id,"roadRage",Beat("a","TALK_CASUAL",exp,x=>x["jobId"]="other")),Job,Runtime,Epoch,now);});
            Reject(delegate{ScenarioPlanPolicy.Parse(Plan(o.Id,"roadRage",Beat("a","TALK_CASUAL",now.AddSeconds(-1))),Job,Runtime,Epoch,now);});
            var g2=new ScenarioGate();var o2=g2.Offer("windowTalk",Npc,now);
            var wrong=Plan(o2.Id,"carjack",Beat("a","TALK_CASUAL",exp));
            Reject(delegate{ScenarioPlanPolicy.Bind(wrong,g2.Consume(o2.Id,now),ScenarioPlanPolicy.Parse(wrong,Job,Runtime,Epoch,now));});
            var g3=new ScenarioGate();var o3=g3.Offer("windowTalk","someone-else",now);
            var other=Plan(o3.Id,"windowTalk",Beat("a","TALK_CASUAL",exp));
            Reject(delegate{ScenarioPlanPolicy.Bind(other,g3.Consume(o3.Id,now),ScenarioPlanPolicy.Parse(other,Job,Runtime,Epoch,now));});
        });
    }
}
