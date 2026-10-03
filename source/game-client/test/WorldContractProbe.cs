using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using LivingLosSantosV2;

internal static class WorldContractProbe
{
    public static int Main(string[] args)
    {
        try
        {
            if(args.Length<1) throw new ArgumentException("Pass an isolated QA loopback URL, ports 3101..3199. Never use the game companion.");
            var url=new Uri(args[0]); if(url.Port<3101||url.Port>3199) throw new ArgumentException("QA probes require an isolated port 3101..3199.");
            var json=new JavaScriptSerializer(); string runtime="qa-csharp-no-gta-"+Guid.NewGuid().ToString("N");
            var settings=new DirectorSettings();
            var packet=new Dictionary<string,object> {
                {"protocol",3},{"runtimeId",runtime},{"pluginVersion","3.0.0-contract-probe"},{"gameVersion","QA-NO-GTA"},{"appliedRevision",0},
                {"player",new {position=new{x=100,y=-1940,z=20},wantedLevel=0,weaponDrawn=false}},
                {"environment",new {weather="Clear",timeOfDay="12:00",district="QA contract fixture"}},
                {"npcs",new[]{new{id=runtime+":test",name="QA serialized dead NPC",faction="Ballas",position=new{x=102,y=-1942,z=20},health=-100,alive=false,inCombat=false,modelHash=-12345,owned=true}}},
                {"director",new{enabled=true,pausedReason="QA fixture - no GTA connected",settings=settings.Snapshot(),activeEvents=new object[0],territories=WorldRules.Territories().Select(t=>t.Snapshot()).ToArray(),ownedPedCount=1}},
                {"acknowledgements",new object[0]},{"events",new[]{new{id=Guid.NewGuid().ToString("N"),at=DateTime.UtcNow.ToString("o"),type="qa_fixture",message="C# serialization fixture. No GTA native calls or real game observations."}}}
            };
            using(var transport=new DashboardTransport(url.AbsoluteUri))
            {
                var response=transport.PostAsync("api/runtime/exchange",json.Serialize(packet),CancellationToken.None).GetAwaiter().GetResult();
                if(!Wire.Boolean(response,"success")||Wire.Integer(response,"protocol",3,3)!=3) throw new Exception("Protocol response rejected.");
                var config=Wire.Map(Wire.Value(response,"config"));
                int revision=Wire.Integer(config,"revision",1,Int32.MaxValue);
                DirectorSettings accepted=DirectorSettings.Parse(Wire.Map(Wire.Value(config,"settings")));
                int queued=Wire.Maps(Wire.Value(response,"commands")).Count();
                packet["appliedRevision"]=revision;
                packet["director"]=new{enabled=accepted.enabled,pausedReason="QA fixture - no GTA connected",settings=accepted.Snapshot(),activeEvents=new object[0],territories=WorldRules.Territories().Select(t=>t.Snapshot()).ToArray(),ownedPedCount=0};
                packet["npcs"]=new object[0]; packet["player"]=null; packet["environment"]=null; packet["events"]=new object[0];
                using(var http=new HttpClient(new HttpClientHandler{UseProxy=false,AllowAutoRedirect=false}))
                {
                    var requestBody=json.Serialize(new {type="set_time",payload=new{hour=18},requestId=Guid.NewGuid().ToString()});
                    using(var commandResponse=http.PostAsync(new Uri(url,"api/world/commands"),new StringContent(requestBody,Encoding.UTF8,"application/json")).GetAwaiter().GetResult())
                    { if(!commandResponse.IsSuccessStatusCode) throw new Exception("QA command was rejected: HTTP "+(int)commandResponse.StatusCode); }
                    var second=transport.PostAsync("api/runtime/exchange",json.Serialize(packet),CancellationToken.None).GetAwaiter().GetResult();
                    if(!Wire.Boolean(second,"success")) throw new Exception("Nullable paused-frame roundtrip failed.");
                    var received=Wire.Maps(Wire.Value(second,"commands")).ToArray(); queued=received.Length;
                    if(queued!=1) throw new Exception("Expected exactly one queued QA command.");
                    var gate=new CommandGate(); string error;
                    if(!gate.TryClaim(received[0],runtime,DateTime.UtcNow,out error)) throw new Exception("Compiled command gate rejected QA command.");
                    if(Wire.Text(received[0],"type",32)!="set_time"||Wire.Integer(Wire.Map(Wire.Value(received[0],"payload")),"hour",0,23)!=18) throw new Exception("Command payload parse failed.");
                    if(gate.TryClaim(received[0],runtime,DateTime.UtcNow,out error)) throw new Exception("Duplicate command was accepted twice.");
                    string commandId=Wire.Text(received[0],"id",128);
                    packet["acknowledgements"]=new[]{new{id=commandId,status="applied",message="QA command parser accepted fixture; no GTA native execution."}};
                    transport.PostAsync("api/runtime/exchange",json.Serialize(packet),CancellationToken.None).GetAwaiter().GetResult();
                    var world=json.Deserialize<Dictionary<string,object>>(http.GetStringAsync(new Uri(url,"api/world")).GetAwaiter().GetResult());
                    var acknowledged=Wire.Maps(Wire.Value(world,"commands")).Single(c=>Wire.Text(c,"id",128)==commandId);
                    if(Wire.Text(acknowledged,"status",16)!="applied") throw new Exception("Acknowledgement not reflected by world snapshot.");
                }
                string result=json.Serialize(new{success=true,gameExecuted=false,qaFixture=true,endpoint=url.AbsoluteUri,runtimeId=runtime,protocol=3,configRevision=revision,commandsParsed=queued,duplicateCommandBlocked=true,commandAcknowledgementRoundtrip=true,settingsValidated=true,negativeHealthAccepted=true,pausedNullPlayerAccepted=true,sameGameTransport=true,checkedAt=DateTime.UtcNow.ToString("o")});
                Console.WriteLine(result); if(args.Length>1) File.WriteAllText(args[1],result);
            }
            return 0;
        }
        catch(Exception ex) { Console.Error.WriteLine(ex.GetType().Name+": "+ex.Message); return 1; }
    }
}
