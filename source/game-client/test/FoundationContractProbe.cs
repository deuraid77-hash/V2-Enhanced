using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Threading;
using System.Web.Script.Serialization;
using LivingLosSantosV2;

internal static class FoundationContractProbe
{
    public static int Main(string[] args)
    {
        try {
            if(args.Length<1) throw new ArgumentException("Use an isolated fake-provider QA loopback port3101..3199, never the live companion.");
            var uri=new Uri(args[0]); if(uri.Host!="127.0.0.1"||uri.Port<3101||uri.Port>3199) throw new ArgumentException("Isolated QA loopback endpoint required.");
            var json=new JavaScriptSerializer{MaxJsonLength=131072,RecursionLimit=24}; string runtime="qa-npc-no-gta-"+Guid.NewGuid().ToString("N"),epoch=Guid.NewGuid().ToString("N"),npcId=runtime+":101:-12345";
            using(var http=new HttpClient(new HttpClientHandler{UseProxy=false,AllowAutoRedirect=false})) { http.Timeout=TimeSpan.FromSeconds(3); var health=json.Deserialize<Dictionary<string,object>>(http.GetStringAsync(new Uri(uri,"api/health")).GetAwaiter().GetResult()); if(Wire.Text(health,"fixture",80)!="ai-foundation-contract"||Wire.Boolean(health,"realProviderCalls")) throw new Exception("Fake-provider fixture identity was not verified; refusing probe."); }
            var mind=new NpcMind(); var npc=new Dictionary<string,object>{{"id",npcId},{"handle",101},{"modelHash",-12345},{"name","QA ONLY NPC"},{"faction","Ballas"},{"archetype","QA serialization fixture"},{"position",new{x=100,y=-1940,z=20}},{"health",100},{"alive",true},{"inCombat",false},{"weapon","Unarmed"},{"mind",mind.Snapshot()},{"longTermMemory","QA note: prior shop conversation."},{"recentDamage",0},{"recentEvents",new string[0]},{"distance",3}};
            var frame=new Dictionary<string,object>{{"protocol",4},{"runtimeId",runtime},{"sceneEpoch",epoch},{"pluginVersion","4.0.0-contract-probe-NO-GTA"},{"gameVersion","0.0.0.0"},{"sdkGameVersion","0.0.0.0"},{"appliedRevision",0},{"appliedNpcRevision",0},
                {"player",new{position=new{x=100,y=-1940,z=20},wantedLevel=0,weaponDrawn=false,weaponDrawnName="Unarmed",stance="Casual",factionStandings=new Dictionary<string,int>{{"Ballas",0}}}},
                {"environment",new{weather="Clear",timeOfDay="12:00",district="QA fixture",nearbyGunfire=false}},{"npcs",new[]{npc}},
                {"director",new{enabled=false,pausedReason="QA fixture: no GTA observations",settings=new DirectorSettings().Snapshot(),activeEvents=new object[0],territories=WorldRules.Territories().Select(t=>t.Snapshot()).ToArray(),ownedPedCount=0}},
                {"events",new object[0]},{"acknowledgements",new object[0]},{"aiReceipts",new string[0]},{"aiOutcomes",new object[0]}};
            using(var transport=new DashboardTransport(uri.AbsoluteUri)) {
                Func<Dictionary<string,object>> exchange=()=>transport.PostAsync("api/runtime/exchange",json.Serialize(frame),CancellationToken.None).GetAwaiter().GetResult();
                var first=exchange(); if(Wire.Integer(first,"protocol",4,4)!=4) throw new Exception("Protocol4 rejected.");
                var config=Wire.Map(Wire.Value(first,"npcSettings")); var settings=new NpcSettingsState(); settings.Apply(Wire.Integer(config,"revision",0,Int32.MaxValue),Wire.Map(Wire.Value(config,"settings"))); frame["appliedNpcRevision"]=settings.Revision;
                frame["appliedRevision"]=Wire.Integer(Wire.Map(Wire.Value(first,"config")),"revision",0,Int32.MaxValue);
                var history=WorkingHistory.Snapshot(new[]{new Dictionary<string,object>{{"role","player"},{"text","Previously I asked about the shop."}},new Dictionary<string,object>{{"role","npc"},{"text","I remember our earlier shop conversation."}}});
                string requestId=Guid.NewGuid().ToString(); var jobBody=json.Serialize(new{requestId=requestId,runtimeId=runtime,sceneEpoch=epoch,kind="conversation",lane="A",npcIds=new[]{npcId},context=new{playerUtterance="Hello, this is an isolated serialization test.",trigger="qa_fixture",history=history}});
                Func<Dictionary<string,object>> create=()=>transport.PostAsync("api/ai/jobs",jobBody,CancellationToken.None).GetAwaiter().GetResult();
                string jobId=Wire.Text(Wire.Map(Wire.Value(create(),"job")),"id",128);
                if(Wire.Text(Wire.Map(Wire.Value(create(),"job")),"id",128)!=jobId) throw new Exception("Request identity did not deduplicate.");
                var gate=new AiUpdateGate(); var receipts=new List<string>(); var outcomes=new List<object>(); int speechUpdates=0,finalUpdates=0; bool duplicateBlocked=false; DateTime deadline=DateTime.UtcNow.AddSeconds(15);
                while(DateTime.UtcNow<deadline&&finalUpdates==0) {
                    foreach(var update in Wire.Maps(Wire.Value(exchange(),"aiUpdates"))) {
                        string error,id=Wire.Text(update,"id",128); if(!gate.TryClaim(update,runtime,epoch,DateTime.UtcNow,out error)) throw new Exception("Valid update rejected: "+error);
                        duplicateBlocked=!gate.TryClaim(update,runtime,epoch,DateTime.UtcNow,out error); receipts.Add(id);
                        if(Wire.Text(update,"jobId",128)!=jobId) throw new Exception("Wrong job update.");
                        if(Wire.Text(update,"kind",32)=="speech") { speechUpdates++; continue; }
                        var payload=Wire.Map(Wire.Value(update,"payload")); mind.Apply(Wire.Map(Wire.Value(payload,"mindDelta"))); npc["mind"]=mind.Snapshot();
                        foreach(var action in Wire.Maps(Wire.Value(payload,"actions"))) { if(Wire.Integer(action,"expectedHandle",1,Int32.MaxValue)!=101||Wire.Integer(action,"expectedModelHash",Int32.MinValue,Int32.MaxValue)!=-12345) throw new Exception("Action target identity mismatch."); outcomes.Add(new{actionId=Wire.Text(action,"actionId",128),jobId=jobId,status="rejected",message="QA fixture deliberately performs no GTA action."}); }
                        finalUpdates++;
                    }
                    frame["aiReceipts"]=receipts.ToArray(); frame["aiOutcomes"]=outcomes.ToArray();
                    if(finalUpdates==0) Thread.Sleep(100);
                }
                if(finalUpdates!=1||speechUpdates<1||!duplicateBlocked||mind.Revision!=1) throw new Exception("Streaming/final/mind replay contract failed.");
                using(var http=new HttpClient(new HttpClientHandler{UseProxy=false,AllowAutoRedirect=false})) { http.Timeout=TimeSpan.FromSeconds(3); var observation=json.Deserialize<Dictionary<string,object>>(http.GetStringAsync(new Uri(uri,"__qa/prompt-observation")).GetAwaiter().GetResult()); if(!Wire.Boolean(observation,"fixture")||Wire.Boolean(observation,"realProviderCalls")||!Wire.Boolean(observation,"historyPresent")||!Wire.Boolean(observation,"longTermMemoryPresent")) throw new Exception("Working history or memory note failed to reach the fake provider prompt."); }
                if(Wire.Maps(Wire.Value(exchange(),"aiUpdates")).Any()) throw new Exception("Receipted updates were redelivered.");
                transport.CancelJobAsync(jobId,CancellationToken.None).GetAwaiter().GetResult();
                frame["sceneEpoch"]=Guid.NewGuid().ToString("N"); frame["player"]=null; frame["environment"]=null; frame["npcs"]=new object[0]; exchange();
                string output=json.Serialize(new{success=true,protocol=4,qaFixture=true,gameExecuted=false,realProviderCalled=false,endpoint=uri.AbsoluteUri,npcSettingsValidated=SettingsCatalog.All.Length,jobCreationIdempotent=true,streamUpdates=speechUpdates,finalUpdates=finalUpdates,duplicateUpdateBlocked=duplicateBlocked,mindAppliedOnce=true,historyReachedProvider=true,memoryNoteReachedProvider=true,actionOutcomeSent=outcomes.Count,receiptsRemoveRedelivery=true,cancellationRouteAccepted=true,sceneResetNullFrameAccepted=true,checkedAt=DateTime.UtcNow.ToString("o")});
                Console.WriteLine(output); if(args.Length>1) File.WriteAllText(args[1],output);
            }
            return 0;
        } catch(Exception ex) {Console.Error.WriteLine(ex.GetType().Name+": "+ex.Message); return 1;}
    }
}
