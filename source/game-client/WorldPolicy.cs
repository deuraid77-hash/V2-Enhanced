using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Web.Script.Serialization;

namespace LivingLosSantosV2
{
    // This file is GTA-independent so validation, replay prevention and campaign rules can be tested offline.
    public static class Wire
    {
        public static Dictionary<string, object> Map(object value)
        { var map = value as Dictionary<string, object>; if (map == null) throw new InvalidOperationException("Expected an object."); return map; }
        public static object Value(Dictionary<string, object> map, string key)
        { object value; if (!map.TryGetValue(key, out value)) throw new InvalidOperationException("Missing " + key + "."); return value; }
        public static string Text(Dictionary<string, object> map, string key, int max)
        { object value = Value(map, key); if (!(value is string) || ((string)value).Length > max || String.IsNullOrWhiteSpace((string)value)) throw new InvalidOperationException("Invalid " + key + "."); return (string)value; }
        public static int Integer(Dictionary<string, object> map, string key, int low, int high)
        {
            object raw = Value(map, key);
            if (!(raw is int) && !(raw is long) && !(raw is decimal) && !(raw is double)) throw new InvalidOperationException("Invalid " + key + ".");
            double number = Convert.ToDouble(raw, CultureInfo.InvariantCulture);
            if (Double.IsNaN(number) || Double.IsInfinity(number) || number != Math.Truncate(number) || number < low || number > high) throw new InvalidOperationException("Invalid " + key + ".");
            return (int)number;
        }
        public static bool Boolean(Dictionary<string, object> map, string key)
        { object raw = Value(map, key); if (!(raw is bool)) throw new InvalidOperationException("Invalid " + key + "."); return (bool)raw; }
        public static IEnumerable<Dictionary<string, object>> Maps(object value)
        { var list = value as IEnumerable; if (list == null || value is string || value is IDictionary) throw new InvalidOperationException("Expected an array."); foreach (object item in list) yield return Map(item); }
        public static DateTime Timestamp(Dictionary<string, object> map, string key)
        {
            DateTimeOffset parsed;
            if (!DateTimeOffset.TryParse(Text(map, key, 64), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out parsed)) throw new InvalidOperationException("Invalid timestamp.");
            return parsed.UtcDateTime;
        }
    }

    public sealed class DirectorSettings
    {
        public bool enabled = true, turfWars = true, streetFights = true, ambientTaunts = true,
            tacticalRetreat = true, blips = true, subtitles = true, protectMissions = true;
        public int ambientHostility = 65, gangAggression = 75, civilianPanic = 70,
            eventIntervalSeconds = 75, maxActiveEvents = 2, maxSpawnedPeds = 16;
        public static DirectorSettings Parse(Dictionary<string, object> map)
        {
            return new DirectorSettings {
                enabled = Wire.Boolean(map,"enabled"), turfWars = Wire.Boolean(map,"turfWars"),
                streetFights = Wire.Boolean(map,"streetFights"), ambientTaunts = Wire.Boolean(map,"ambientTaunts"),
                tacticalRetreat = Wire.Boolean(map,"tacticalRetreat"), blips = Wire.Boolean(map,"blips"),
                subtitles = Wire.Boolean(map,"subtitles"), protectMissions = Wire.Boolean(map,"protectMissions"),
                ambientHostility = Wire.Integer(map,"ambientHostility",0,100), gangAggression = Wire.Integer(map,"gangAggression",0,100),
                civilianPanic = Wire.Integer(map,"civilianPanic",0,100), eventIntervalSeconds = Wire.Integer(map,"eventIntervalSeconds",30,300),
                maxActiveEvents = Wire.Integer(map,"maxActiveEvents",1,3), maxSpawnedPeds = Wire.Integer(map,"maxSpawnedPeds",4,24)
            };
        }
        public Dictionary<string, object> Snapshot()
        { return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(new JavaScriptSerializer().Serialize(this)); }
    }

    public sealed class Territory
    {
        public string id, name, owner, challenger;
        public float x, y, z;
        public int wins, heat;
        public Territory(string identity, string label, string faction, float px, float py, float pz)
        { id=identity; name=label; owner=faction; x=px; y=py; z=pz; }
        public Dictionary<string, object> Snapshot()
        { return new Dictionary<string, object> { {"id",id},{"name",name},{"owner",owner},{"challenger",challenger},{"wins",wins},{"heat",heat},{"radius",180},{"position",new { x=x,y=y,z=z }} }; }
    }

    public static class WorldRules
    {
        public const int PlacementCandidates = 48;
        public const int PlacementCandidatesPerPulse = 8;
        public static readonly string[] Factions = { "Families", "Ballas", "Vagos" };
        public static Territory[] Territories()
        { return new [] { new Territory("grove","Grove Street","Ballas",105,-1940,20),new Territory("forum","Forum Drive","Families",-150,-1620,33),new Territory("rancho","Rancho","Vagos",480,-1880,26),new Territory("chamberlain","Chamberlain Hills","Families",-210,-1490,31),new Territory("davis","Davis","Ballas",100,-1700,29),new Territory("cypress","Cypress Flats","Vagos",850,-2100,30) }; }
        // A timeout, vanished entity, abandonment or both teams eliminated never invents an owner.
        public static string Winner(int attackers, int defenders, bool observed, bool timedOut)
        { if (!observed || timedOut || attackers < 0 || defenders < 0) return null; if (attackers > 0 && defenders == 0) return "attacker"; if (defenders > 0 && attackers == 0) return "defender"; return null; }
        public static bool CanOwn(int expectedHandle, int actualHandle, int expectedModel, int actualModel, bool exists)
        { return exists && expectedHandle == actualHandle && expectedModel == actualModel; }
        public static bool SafePlacement(double distanceFromPlayer, double distanceFromTarget, double heightDifference, bool ground, bool clear)
        { return ground && clear && Finite(distanceFromPlayer) && Finite(distanceFromTarget) && Finite(heightDifference) && distanceFromPlayer >= 12 && distanceFromPlayer <= 130 && distanceFromTarget >= 0 && distanceFromTarget <= 45 && Math.Abs(heightDifference) <= 3.5; }
        private static bool Finite(double value) { return !Double.IsNaN(value)&&!Double.IsInfinity(value); }
        // First explore a distinct team-side fan, then a full-circle fallback over three rings.
        // Pure geometry is independent of the game's navmesh, which can collapse nearby input points.
        public static Tuple<float,float> PlacementOffset(int index,int perTeam,int attempt,double phase)
        {
            if(perTeam<1||perTeam>4||index<0||index>perTeam*2||attempt<0||attempt>=PlacementCandidates||!Finite(phase))
                throw new ArgumentOutOfRangeException("Invalid placement candidate.");
            bool witness=index>=perTeam*2;
            double side=witness?Math.PI/2:index<perTeam?Math.PI:0;
            double angle,radius;
            if(attempt<24)
            {
                int bearing=(attempt*5+(index%perTeam)*3)%12;
                angle=phase+side+(bearing-5.5)*Math.PI/11;
                radius=(witness?30:18)+((attempt/12+index)%2)*13;
            }
            else
            {
                int sweep=attempt-24;
                angle=phase+side+((sweep*5+index*3)%8)*Math.PI/4;
                radius=18+(sweep/8)*12;
            }
            return Tuple.Create((float)(Math.Cos(angle)*radius),(float)(Math.Sin(angle)*radius));
        }
    }

    public sealed class CommandGate
    {
        private readonly Dictionary<string, DateTime> claimed = new Dictionary<string, DateTime>();
        public bool TryClaim(Dictionary<string, object> command, string runtimeId, DateTime now, out string error)
        {
            error = null;
            string id = Wire.Text(command,"id",128);
            foreach (string old in claimed.Where(item=>now-item.Value>TimeSpan.FromMinutes(3)).Select(item=>item.Key).ToArray()) claimed.Remove(old);
            if (claimed.ContainsKey(id)) return false;
            if (Wire.Text(command,"runtimeId",128)!=runtimeId) { error="Command belongs to an earlier game session."; return false; }
            if (Wire.Text(command,"status",16)!="queued") return false;
            DateTime created=Wire.Timestamp(command,"createdAt"), expiry=Wire.Timestamp(command,"expiresAt");
            if (created>now.AddSeconds(5) || expiry<=now || expiry-created>TimeSpan.FromSeconds(31) || expiry<=created) { error="Command expired or has invalid timestamps."; return false; }
            if (claimed.Count>=512) { error="Command replay ledger is full; retry later."; return false; }
            claimed.Add(id,now);
            return true;
        }
    }

    public sealed class CampaignStore
    {
        private readonly string path;
        private readonly object sync = new object();
        public CampaignStore(string file) { path = Path.GetFullPath(file); }
        public string PreserveRejected()
        {
            lock(sync)
            {
                if(!File.Exists(path)) return null;
                string preserved=path+".rejected-"+DateTime.UtcNow.ToString("yyyyMMdd-HHmmss-fffffff")+".json";
                File.Copy(path,preserved,false); return preserved;
            }
        }
        public DirectorSettings Load(Territory[] territories)
        {
            lock(sync)
            {
                if (!File.Exists(path)) return new DirectorSettings();
                if (new FileInfo(path).Length>32768) throw new InvalidOperationException("Campaign is oversized.");
                var map=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(path));
                if (Wire.Integer(map,"version",3,3)!=3) throw new InvalidOperationException("Unsupported campaign.");
                var restored=Wire.Maps(Wire.Value(map,"territories")).ToArray();
                if (restored.Length!=6) throw new InvalidOperationException("Invalid campaign territories.");
                var settings=DirectorSettings.Parse(Wire.Map(Wire.Value(map,"settings")));
                var validated=new Dictionary<string,Tuple<string,int,int>>();
                foreach(var item in restored)
                {
                    string id=Wire.Text(item,"id",32), owner=Wire.Text(item,"owner",32);
                    if(!territories.Any(t=>t.id==id)||!WorldRules.Factions.Contains(owner)||validated.ContainsKey(id)) throw new InvalidOperationException("Invalid campaign owner or district.");
                    validated.Add(id,Tuple.Create(owner,Wire.Integer(item,"wins",0,1000000),Wire.Integer(item,"heat",0,100)));
                }
                foreach(var t in territories) { var v=validated[t.id]; t.owner=v.Item1; t.wins=v.Item2; t.heat=v.Item3; }
                return settings;
            }
        }
        public string Serialize(Territory[] territories, DirectorSettings settings)
        { return new JavaScriptSerializer().Serialize(new { version=3, settings=settings, territories=territories.Select(t=>new {id=t.id,owner=t.owner,wins=t.wins,heat=t.heat}).ToArray() }); }
        public void Save(string snapshot)
        {
            lock(sync)
            {
                string directory=Path.GetDirectoryName(path); Directory.CreateDirectory(directory);
                string temp=path+".tmp"; File.WriteAllText(temp,snapshot);
                if(File.Exists(path)) File.Replace(temp,path,path+".bak"); else File.Move(temp,path);
            }
        }
    }
}
