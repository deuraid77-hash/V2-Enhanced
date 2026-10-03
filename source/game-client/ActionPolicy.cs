using System;
using System.Collections.Generic;
using System.Linq;

namespace LivingLosSantosV2
{
    public static class ActionPolicy
    {
        public static readonly string[] Names={"TALK_CASUAL","INTIMIDATE","SURRENDER","FLEE_PANICKED","TAKE_COVER","DRAW_WEAPON","ATTACK_MELEE","CALL_911","CALL_FACTION_BACKUP","OFFER_SIDE_GIG","HANDSHAKE_RESPECT","FOLLOW","LEAD_TO","SIT_DOWN_TALK","LEAN_AND_SMOKE","USE_PHONE","WAVE_OFF","APOLOGISE","PLEAD","BEG","SELL_TIP","GIVE_DIRECTIONS","ASK_FOR_RIDE","HONK_AT_PLAYER","THREATEN_FROM_CAR","LEAVE_VEHICLE_TO_CONFRONT","DRIVE_AWAY"};
        public static bool Known(string type){return Names.Contains(type);}
        public static bool VehicleOnly(string type){return type=="HONK_AT_PLAYER"||type=="THREATEN_FROM_CAR"||type=="LEAVE_VEHICLE_TO_CONFRONT"||type=="DRIVE_AWAY";}
        public static bool AllowsVehicle(string type){return VehicleOnly(type)||type=="TALK_CASUAL"||type=="USE_PHONE"||type=="CALL_911"||type=="WAVE_OFF"||type=="APOLOGISE"||type=="GIVE_DIRECTIONS";}
        public static int Duration(Dictionary<string,object> parameters){if(parameters.Keys.Any(k=>k!="durationMs"))throw new InvalidOperationException("Unknown action parameter.");return parameters.ContainsKey("durationMs")?Wire.Integer(parameters,"durationMs",500,15000):5000;}
        public static string Guard(string type,bool exists,bool alive,bool human,bool identityMatches,bool protectedEntity,bool inVehicle,bool safeVehicle,double distance,double range,bool enabled)
        {if(!Known(type))return "Unknown action.";if(!enabled)return "Action disabled.";if(!exists||!alive||!human||!identityMatches)return "Actor identity or life state changed.";if(protectedEntity)return "Actor is protected by another script.";if(Double.IsNaN(distance)||Double.IsInfinity(distance)||distance<0||distance>range)return "Actor outside the allowed range.";if(inVehicle&&!safeVehicle)return "Vehicle context is protected or unsafe.";if(VehicleOnly(type)&&!inVehicle)return "Action requires a vehicle occupant.";if(inVehicle&&!AllowsVehicle(type))return "Action requires an actor on foot.";return null;}
        public static bool MayRaiseWanted(bool enabled,int cap,int current,bool observedCrime){return enabled&&observedCrime&&cap>0&&current<cap;}
    }
    public static class CleanupPolicy
    {
        // A failed release must never skip later resources or final bookkeeping.
        public static void Run(IEnumerable<Action> releases,Action<Exception> failed,Action finished)
        {try{foreach(var release in releases)try{release();}catch(Exception ex){try{failed(ex);}catch{}}}finally{finished();}}
    }
}
