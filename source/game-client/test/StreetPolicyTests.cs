using System;
using System.Linq;
using LivingLosSantosV2;

internal static class StreetPolicyTests
{
    private static void Assert(bool value){if(!value)throw new Exception("Street assertion failed.");}
    private static StreetPolicy.Facts F(Action<StreetPolicy.Facts> edit){var f=new StreetPolicy.Facts{NpcOnFoot=true,Distance=5,NpcSpeed=0};edit(f);return f;}
    private static string C(StreetPolicy.Facts f){return StreetPolicy.Classify(f,25);}

    public static void Run(Action<string,Action> check)
    {
        check("street policy: every scenario reachable, catalogue matches settings list",()=>{
            Assert(StreetPolicy.Scenarios.Length==10&&StreetPolicy.Scenarios.Distinct().Count()==10);
            Assert(C(F(f=>{f.PlayerArmed=true;f.PlayerTargetingNpc=true;}))=="holdup");
            Assert(C(F(f=>{f.NpcIsCop=true;f.CiviliansNearCop=1;}))=="policeCivilian");
            Assert(C(F(f=>f.NpcFleeing=true))=="chase");
            Assert(C(F(f=>f.RecentGunfire=true))=="aftermath");
            Assert(C(F(f=>{f.NpcGang=true;f.Neighbours=1;}))=="deal");
            Assert(C(F(f=>f.Neighbours=3))=="protest");
            Assert(C(F(f=>{f.Neighbours=2;f.Night=true;}))=="drunks");
            Assert(C(F(f=>f.Neighbours=1))=="argument");
            Assert(C(F(f=>{f.Closing=1.5f;f.NpcSpeed=2;}))=="fan");
            Assert(C(F(f=>{}))=="tourist");
            foreach(string s in StreetPolicy.Scenarios)Assert(ScenarioCatalog.Known(s)&&!VehiclePolicy.Known(s));
            foreach(string s in VehiclePolicy.Scenarios)Assert(ScenarioCatalog.Known(s)&&!StreetPolicy.Known(s));
            Assert(!ScenarioCatalog.Known("teleport")&&!ScenarioCatalog.Known(null));
        });
        check("street policy: protected, combat, vehicle, distance and live-gunfire guards",()=>{
            Assert(C(F(f=>f.NpcProtected=true))==null);
            Assert(C(F(f=>f.NpcInCombat=true))==null);
            Assert(C(F(f=>f.NpcInVehicle=true))==null);
            Assert(C(F(f=>f.NpcOnFoot=false))==null);
            Assert(C(F(f=>f.Distance=26))==null);
            Assert(C(F(f=>f.Distance=Single.NaN))==null);
            Assert(C(F(f=>f.Distance=-1))==null);
            Assert(C(F(f=>{f.GunfireNow=true;f.Neighbours=1;}))==null);
            Assert(C(F(f=>{f.GunfireNow=true;f.PlayerArmed=true;f.PlayerTargetingNpc=true;}))=="holdup");
            Assert(C(F(f=>{f.PlayerArmed=true;f.PlayerTargetingNpc=true;f.NpcIsCop=true;}))==null);
        });
        check("street policy: calm scenes need a calm player on foot",()=>{
            Assert(C(F(f=>{f.Wanted=1;f.Neighbours=1;}))==null);
            Assert(C(F(f=>{f.PlayerInVehicle=true;}))==null);
            Assert(C(F(f=>{f.PlayerArmed=true;}))==null);
            Assert(C(F(f=>{f.NpcIsCop=true;f.CiviliansNearCop=1;f.Wanted=1;}))==null);
            Assert(C(F(f=>{f.Night=true;}))==null);
            Assert(C(F(f=>{f.Neighbours=3;f.Night=true;}))=="drunks");
            Assert(C(F(f=>{f.Neighbours=1;f.NpcSpeed=3;}))==null);
            Assert(StreetPolicy.IsNight(20)&&StreetPolicy.IsNight(5)&&!StreetPolicy.IsNight(6)&&!StreetPolicy.IsNight(19));
        });
        check("street policy: shared gate and parser accept street scenarios, voice category mapping",()=>{
            var gate=new ScenarioGate();var now=DateTime.UtcNow;
            var o=gate.Offer("argument","npc-1",now);Assert(o!=null&&o.Scenario=="argument");
            Assert(gate.Offer("teleport","npc-2",now)==null);
            Assert(gate.Consume(o.Id,now)!=null&&gate.Consume(o.Id,now)==null);
            Assert(ScenarioCatalog.VoiceCategory("roadRage")=="vehicle");
            Assert(ScenarioCatalog.VoiceCategory("holdup")=="combat");
            Assert(ScenarioCatalog.VoiceCategory("tourist")=="casual");
        });
    }
}
