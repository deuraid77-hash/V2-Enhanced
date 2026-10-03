using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Threading;
using System.Web.Script.Serialization;
using LivingLosSantosV2;

internal static class MenuContractProbe
{
    private static JavaScriptSerializer json=new JavaScriptSerializer{MaxJsonLength=131072,RecursionLimit=24};
    private static DashboardTransport transport;
    private static Dictionary<string,object> Call(string method,string route,object body=null){Console.WriteLine("QA "+method+" "+route);return transport.MenuAsync(method,route,body==null?null:json.Serialize(body),CancellationToken.None).GetAwaiter().GetResult();}
    private static void Assert(bool condition,string message){if(!condition)throw new Exception(message);}
    private static int Rev(Dictionary<string,object> snapshot){return Wire.Integer(snapshot,"revision",0,Int32.MaxValue);}
    private static Dictionary<string,object> Job(string kind,object context)
    {
        string id=Wire.Text(Wire.Map(Call("POST","api/ai/menu/jobs",new{requestId=Guid.NewGuid().ToString(),kind=kind,context=context})["job"]),"id",128);
        DateTime deadline=DateTime.UtcNow.AddSeconds(15);
        while(DateTime.UtcNow<deadline){var job=Wire.Map(Call("GET","api/ai/menu/jobs/"+id)["job"]);string state=Wire.Text(job,"status",32);if(state=="completed")return Wire.Map(job["result"]);if(state=="failed"||state=="cancelled"||state=="rejected")throw new Exception("Fixture menu job "+state);Thread.Sleep(100);}
        Call("DELETE","api/ai/menu/jobs/"+id);throw new Exception("Fixture menu job timed out.");
    }
    public static int Main(string[] args)
    {
        try{
            if(args.Length<1)throw new ArgumentException("Supply an isolated fake-provider fixture loopback port3101..3199.");var endpoint=new Uri(args[0]);if(endpoint.Host!="127.0.0.1"||endpoint.Port<3101||endpoint.Port>3199||endpoint.Scheme!="http")throw new ArgumentException("Isolated QA loopback endpoint required.");
            using(var http=new HttpClient(new HttpClientHandler{UseProxy=false,AllowAutoRedirect=false})){http.Timeout=TimeSpan.FromSeconds(3);var health=json.Deserialize<Dictionary<string,object>>(http.GetStringAsync(new Uri(endpoint,"api/health")).GetAwaiter().GetResult());Assert(Wire.Text(health,"fixture",80)=="ai-foundation-contract"&&!Wire.Boolean(health,"realProviderCalls"),"Refusing non-fixture endpoint.");}
            using(transport=new DashboardTransport(endpoint.AbsoluteUri)){
                var initial=Call("GET","api/settings?catalog=false");SettingsCatalog.Validate(Wire.Map(initial["settings"]));var w=Wire.Map(initial["world"]);int beforeWorld=Rev(w);int targetAggression=Wire.Integer(Wire.Map(w["settings"]),"gangAggression",0,100)==41?42:41;
                var worldReply=Call("PATCH","api/world/config?compact=true",new{settings=new{gangAggression=targetAggression},expectedRevision=beforeWorld,source="game"});Assert(MenuRules.ConfigRevision(worldReply,true)==beforeWorld+1,"Nested compact world revision was not parsed.");
                var pending=new Dictionary<string,object>{{"gangAggression",42}};var batch=MenuRules.Clone(pending);bool stale=false;try{Call("PATCH","api/world/config?compact=true",new{settings=batch,expectedRevision=beforeWorld,source="game"});}catch(InvalidOperationException ex){stale=ex.Message.Contains("409");}MenuRules.FinishSubmission(pending,batch,!stale);Assert(stale&&pending.Count==1,"Stale HTTP edit did not preserve pending draft.");
                var current=Call("GET","api/settings?catalog=false");string name="Menu QA "+Guid.NewGuid().ToString("N").Substring(0,8),renamed=name+" renamed",imported=name+" imported";
                Call("POST","api/profiles",new{name=name});string route="api/profiles/"+Uri.EscapeDataString(name);
                var exported=Wire.Map(Call("GET",route+"/export")["profile"]);Assert(Wire.Integer(exported,"version",4,4)==4&&exported.ContainsKey("worldSettings"),"Full profile export missing world settings.");
                bool hints=Wire.Boolean(Wire.Map(current["settings"]),"general.hints");Call("PATCH","api/settings",new{settings=new Dictionary<string,object>{{"general.hints",!hints}},expectedRevision=Rev(current),source="game"});
                var changed=Call("GET","api/settings?catalog=false");Call("PATCH","api/world/config?compact=true",new{settings=new{gangAggression=55},expectedRevision=Rev(Wire.Map(changed["world"])),source="game"});
                changed=Call("GET","api/settings?catalog=false");var applied=Call("POST",route+"/apply",new{expectedRevision=Rev(changed),expectedWorldRevision=Rev(Wire.Map(changed["world"]))});Assert(Wire.Boolean(Wire.Map(applied["settings"]),"general.hints")==hints&&Wire.Integer(Wire.Map(Wire.Map(applied["world"])["settings"]),"gangAggression",0,100)==targetAggression,"Profile failed to restore both settings scopes.");
                Call("PATCH",route,new{name=renamed});exported["name"]=imported;Call("POST","api/profiles/import",new{profile=exported});Call("DELETE","api/profiles/"+Uri.EscapeDataString(renamed));Call("DELETE","api/profiles/"+Uri.EscapeDataString(imported));
                var beforeAdvice=Call("GET","api/settings?catalog=false");var proposal=Wire.Map(Job("advisor",new{intent="Change world.eventIntervalSeconds and ai.directorIntervalSeconds to reduce their frequencies for this isolated QA fixture."})["proposal"]);var previewState=Call("GET","api/settings?catalog=false");Assert(Rev(previewState)==Rev(beforeAdvice)&&Rev(Wire.Map(previewState["world"]))==Rev(Wire.Map(beforeAdvice["world"])),"Advisor preview changed settings.");
                var accepted=Call("POST","api/ai/advisor/proposals/"+Wire.Text(proposal,"id",128)+"/accept",new{expectedRevision=Wire.Integer(proposal,"expectedRevision",0,Int32.MaxValue),expectedWorldRevision=Wire.Integer(proposal,"expectedWorldRevision",0,Int32.MaxValue)});var adapted=MenuRules.AdvisorBundle(accepted);Assert(Rev(adapted)>Rev(beforeAdvice)&&Rev(Wire.Map(adapted["world"]))>Rev(Wire.Map(beforeAdvice["world"])),"Advisor bundle response adapter failed.");
                Assert(Wire.Text(Job("explain",new{settingKey="world.gangAggression"}),"text",4000).Length>0,"World setting explanation missing.");Assert(Wire.Text(Job("diagnose",new{}),"summary",4000).Length>0,"Diagnostics assessment missing.");
                var rejectedProposal=Wire.Map(Job("advisor",new{intent="Change world.eventIntervalSeconds and ai.directorIntervalSeconds."})["proposal"]);Call("POST","api/ai/advisor/proposals/"+Wire.Text(rejectedProposal,"id",128)+"/reject",new{});
                var diagnostic=Call("POST","api/diagnostics/export",new{});Assert(Wire.Text(diagnostic,"filename",160).StartsWith("diagnostics-")&&Wire.Integer(diagnostic,"bytes",1,1048576)>0&&Wire.Text(diagnostic,"sha256",64).Length==64,"Sanitized diagnostic export response failed.");
                var result=new{verifiedAt=DateTime.UtcNow.ToString("o"),fixture=true,realProviderCalls=false,gameExecuted=false,settingsParsed=SettingsCatalog.All.Length,compactWorldRevision=true,staleEditPreserved=true,fullProfileRoundtrip=true,advisorPreviewUnchanged=true,advisorAcceptBundle=true,advisorRejected=true,worldExplain=true,diagnosticAnalysis=true,diagnosticExport=true};
                string report=json.Serialize(result);if(args.Length>1)File.WriteAllText(args[1],report);Console.WriteLine(report);return 0;
            }
        }catch(Exception ex){Console.Error.WriteLine(ex.GetType().Name+": "+ex.Message);return 1;}
    }
}
