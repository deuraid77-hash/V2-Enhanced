using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Web.Script.Serialization;
using LivingLosSantosV2;

internal static class DashboardContractProbe
{
    public static int Main(string[] args)
    {
        if (args.Length != 2 || args[0] != "--live")
        { Console.WriteLine("Usage: Probe-Companion.exe --live <output.json>. Makes one local dashboard dialogue request; its server may call Gemini."); return 2; }
        try
        {
            const string packet = "{\"npc\":{\"id\":\"offline-contract-fixture\",\"name\":\"Test Pedestrian\",\"faction\":\"Civilians\",\"archetype\":\"Simulated API-contract fixture, no actual game entity\"},\"player\":{\"wantedLevel\":0,\"weaponDrawn\":false},\"environment\":{\"district\":\"Los Santos\",\"weather\":\"Clear\",\"timeOfDay\":\"12:00\"},\"playerUtterance\":\"Say Hello in a short friendly greeting.\",\"history\":[]}";
            Dictionary<string, object> response;
            using (var transport = new DashboardTransport("http://127.0.0.1:3000/"))
                response = transport.PostAsync("api/dialogue", packet, CancellationToken.None).GetAwaiter().GetResult();
            var result = ResponsePolicy.ParseResult(response);
            object action, source;
            result.TryGetValue("action", out action); response.TryGetValue("source", out source);
            string json = new JavaScriptSerializer().Serialize(new {
                checkedAt=DateTime.UtcNow.ToString("o"), success=true, sameDashboardTransport=true,
                responsePolicyValidated=true, realGameDataSent=false, gameExecuted=false, microphoneUsed=false,
                telemetrySent=false, source=ResponsePolicy.CleanText(source,80),
                displaySource=ResponsePolicy.SourceLabel(response),
                speech=ResponsePolicy.CleanText(result["speech"],420), action=ResponsePolicy.Action(action)
            });
            File.WriteAllText(args[1],json); Console.WriteLine(json); return 0;
        }
        catch (Exception exception)
        {
            string json = new JavaScriptSerializer().Serialize(new { checkedAt=DateTime.UtcNow.ToString("o"),success=false,exceptionType=exception.GetType().Name,error="Local dashboard contract probe failed. No response body or credentials were recorded." });
            File.WriteAllText(args[1],json); Console.WriteLine(json); return 1;
        }
    }
}
