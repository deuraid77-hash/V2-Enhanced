using System;
using System.Linq;

namespace LivingLosSantosV2
{
    // Step 6 pure policy for NPC-focused street scenarios (spec section 9).
    // Same contract as VehiclePolicy: classify facts the game already observed, never
    // spawn, warp or delete. One primary NPC per opportunity; the companion's AI
    // director chooses whether to act and writes the beats.
    public static class StreetPolicy
    {
        public static readonly string[] Scenarios={"argument","deal","chase","holdup","tourist","fan","drunks","protest","policeCivilian","aftermath"};
        public sealed class Facts
        {
            public bool PlayerInVehicle,NpcInVehicle,NpcOnFoot,NpcIsCop,NpcGang,NpcProtected,NpcInCombat,NpcFleeing,PlayerArmed,PlayerTargetingNpc,GunfireNow,RecentGunfire,Night;
            // Neighbours: other living on-foot humans within NeighbourMeters of this NPC.
            // CiviliansNearCop: non-cop on-foot humans within NeighbourMeters (only read for cops).
            public int Wanted,Neighbours,CiviliansNearCop;
            public float Distance,NpcSpeed,Closing;
        }
        public const float NeighbourMeters=4f;
        public static bool Known(string scenario){return Scenarios.Contains(scenario);}
        public static bool IsNight(int hour){return hour>=20||hour<6;}
        // Highest-stakes observation first. Live gunfire suppresses social scenes; they
        // belong to combat barks. Calm scenes need a player on foot with no wanted level.
        public static string Classify(Facts f,double maxDistance)
        {
            if(f==null||f.NpcProtected||f.NpcInCombat||f.NpcInVehicle||!f.NpcOnFoot||Double.IsNaN(f.Distance)||f.Distance<0||f.Distance>maxDistance)return null;
            bool civilian=!f.NpcGang&&!f.NpcIsCop,standing=f.NpcSpeed<1.5f;
            if(f.PlayerArmed&&f.PlayerTargetingNpc&&!f.NpcIsCop&&f.Distance<=15)return "holdup";
            if(f.NpcIsCop&&f.CiviliansNearCop>=1&&f.Wanted==0&&f.Distance<=30)return "policeCivilian";
            if(f.GunfireNow)return null;
            if(f.NpcFleeing&&!f.NpcIsCop&&f.Wanted==0&&f.Distance<=25)return "chase";
            if(f.RecentGunfire&&civilian&&f.Distance<=20)return "aftermath";
            if(f.Wanted>0||f.PlayerInVehicle)return null;
            if(f.NpcGang&&f.Neighbours==1&&standing&&f.Distance<=20)return "deal";
            if(civilian&&f.Neighbours>=3&&!f.Night&&f.Distance<=25)return "protest";
            if(civilian&&f.Neighbours>=2&&f.Night&&f.Distance<=20)return "drunks";
            if(civilian&&f.Neighbours==1&&standing&&f.Distance<=20)return "argument";
            if(civilian&&!f.PlayerArmed&&f.Closing>=1f&&f.Distance<=8)return "fan";
            if(civilian&&!f.PlayerArmed&&!f.Night&&standing&&f.Distance<=8)return "tourist";
            return null;
        }
    }

    // Single source for which scenario names the shared gate and plan parser accept.
    public static class ScenarioCatalog
    {
        public static bool Known(string scenario){return VehiclePolicy.Known(scenario)||StreetPolicy.Known(scenario);}
        public static string VoiceCategory(string scenario){return VehiclePolicy.Known(scenario)?"vehicle":scenario=="holdup"?"combat":"casual";}
    }
}
