using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using LivingLosSantosV2;

internal static class OfflineTests
{
    private static readonly List<object> Results = new List<object>();
    private static int failed;
    private static void Check(string name, Action body)
    {
        try { body(); Results.Add(new { name = name, passed = true }); Console.WriteLine("PASS " + name); }
        catch (Exception exception) { failed++; Results.Add(new { name = name, passed = false, error = exception.GetType().Name + ": " + exception.Message }); Console.WriteLine("FAIL " + name + ": " + exception.Message); }
    }
    private static void Assert(bool value) { if (!value) throw new Exception("Assertion failed"); }
    private static void Reject(Action body)
    {
        bool rejected = false;
        try { body(); } catch { rejected = true; }
        Assert(rejected);
    }
    private static Dictionary<string, object> Response(object speech)
    { return new Dictionary<string, object> { { "success", true }, { "result", new Dictionary<string, object> { { "speech", speech } } } }; }
    private static bool CanApply(int handle, int model, bool exists, bool alive, bool human, bool vehicle, bool mission, float distance)
    { return ResponsePolicy.CanApply(1, handle, 20, model, exists, alive, human, vehicle, mission, distance); }

    private sealed class LocalServer : IDisposable
    {
        private readonly TcpListener listener;
        private TcpClient connection;
        public readonly string Url;
        public LocalServer(string reply, int delayMilliseconds)
        {
            listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
            Url = "http://127.0.0.1:" + ((IPEndPoint)listener.LocalEndpoint).Port + "/";
            Task.Run(async delegate {
                try
                {
                    connection = await listener.AcceptTcpClientAsync();
                    using (connection)
                    using (var stream = connection.GetStream())
                    {
                        var read = new byte[4096];
                        await stream.ReadAsync(read, 0, read.Length);
                        var bytes = Encoding.UTF8.GetBytes(reply);
                        await stream.WriteAsync(bytes, 0, bytes.Length);
                        if (delayMilliseconds > 0) await Task.Delay(delayMilliseconds);
                    }
                }
                catch (ObjectDisposedException) { }
                catch (SocketException) { }
                catch (IOException) { }
            });
        }
        public void Dispose() { listener.Stop(); if (connection != null) connection.Close(); }
    }
    private static Dictionary<string, object> Request(string rawResponse, int delayMilliseconds, int timeoutMilliseconds)
    {
        using (var server = new LocalServer(rawResponse, delayMilliseconds))
        using (var transport = new DashboardTransport(server.Url, TimeSpan.FromMilliseconds(timeoutMilliseconds)))
            return transport.PostAsync("api/dialogue", "{}", CancellationToken.None).GetAwaiter().GetResult();
    }
    private static string Http(string body)
    { return "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: " + Encoding.UTF8.GetByteCount(body) + "\r\nConnection: close\r\n\r\n" + body; }

    public static int Main(string[] args)
    {
        Check("valid entity can receive reply", delegate { Assert(CanApply(1,20,true,true,true,false,false,5)); });
        Check("changed handle rejected", delegate { Assert(!CanApply(2,20,true,true,true,false,false,5)); });
        Check("changed model rejected", delegate { Assert(!CanApply(1,21,true,true,true,false,false,5)); });
        Check("streamed-out entity rejected", delegate { Assert(!CanApply(1,20,false,true,true,false,false,5)); });
        Check("dead entity rejected", delegate { Assert(!CanApply(1,20,true,false,true,false,false,5)); });
        Check("nonhuman rejected", delegate { Assert(!CanApply(1,20,true,true,false,false,false,5)); });
        Check("vehicle occupant rejected", delegate { Assert(!CanApply(1,20,true,true,true,true,false,5)); });
        Check("mission/persistent entity rejected", delegate { Assert(!CanApply(1,20,true,true,true,false,true,5)); });
        Check("distance bounds", delegate { Assert(!CanApply(1,20,true,true,true,false,false,-1)); Assert(!CanApply(1,20,true,true,true,false,false,12.01f)); Assert(CanApply(1,20,true,true,true,false,false,12)); });
        Check("nonfinite distances rejected", delegate { Assert(!CanApply(1,20,true,true,true,false,false,Single.NaN)); Assert(!CanApply(1,20,true,true,true,false,false,Single.PositiveInfinity)); });
        Check("caption strips control and GTA format delimiters", delegate { Assert(ResponsePolicy.CleanText("~r~Hi\n\u0000",40)=="rHi"); Assert(ResponsePolicy.CleanText("abcdef",3)=="abc"); });
        Check("valid speech accepted", delegate { Assert((string)ResponsePolicy.ParseResult(Response("Hello"))["speech"]=="Hello"); });
        Check("missing and nonstring speech rejected", delegate { Reject(delegate { ResponsePolicy.ParseResult(Response(null)); }); Reject(delegate { ResponsePolicy.ParseResult(Response(123)); }); Reject(delegate { ResponsePolicy.ParseResult(Response("  ")); }); });
        Check("unsuccessful or malformed envelope rejected", delegate { Reject(delegate { ResponsePolicy.ParseResult(null); }); Reject(delegate { ResponsePolicy.ParseResult(new Dictionary<string, object>{{"success",false}}); }); Reject(delegate { ResponsePolicy.ParseResult(new Dictionary<string, object>{{"success","true"},{"result",new object()}}); }); });
        Check("supported and unsupported action classification", delegate { foreach (string name in ActionPolicy.Names) Assert(ResponsePolicy.IsSupportedAction(name)); Assert(ResponsePolicy.IsSupportedAction("CALL_911")); Assert(ResponsePolicy.IsSupportedAction("CALL_FACTION_BACKUP")); Assert(ResponsePolicy.IsSupportedAction("OFFER_SIDE_GIG")); Assert(ResponsePolicy.IsSupportedAction("HANDSHAKE_RESPECT")); Assert(!ResponsePolicy.IsSupportedAction("GIVE_WEAPON")); Assert(!ResponsePolicy.IsSupportedAction("TELEPORT")); Assert(!ResponsePolicy.IsSupportedAction("take_cover")); Assert(!ResponsePolicy.IsSupportedAction("")); Assert(!ResponsePolicy.IsSupportedAction(null)); });
        Check("fallback source stays visible", delegate { Assert(ResponsePolicy.SourceLabel(new Dictionary<string,object>{{"source","fallback-on-error"}})=="local fallback"); Assert(ResponsePolicy.SourceLabel(new Dictionary<string,object>{{"source","heuristic-ml-engine"}})=="local fallback"); Assert(ResponsePolicy.SourceLabel(new Dictionary<string,object>{{"source","gemini-3.8-flash"}})=="Gemini"); });
        Check("nonlocal and decorated endpoints rejected", delegate { foreach (string url in new[]{"https://127.0.0.1/","http://example.com/","http://127.0.0.1/path/","http://user@127.0.0.1/","http://127.0.0.1/?x=1","http://127.0.0.1/#x"}) Reject(delegate { using(var t=new DashboardTransport(url)){} }); });
        Check("unsupported route rejected before connection", delegate { using(var t=new DashboardTransport("http://127.0.0.1:9/")) Reject(delegate { t.PostAsync("api/other","{}",CancellationToken.None).GetAwaiter().GetResult(); }); });
        Check("valid local JSON response", delegate { Assert((bool)Request(Http("{\"success\":true}"),0,3000)["success"]); });
        Check("HTTP failure rejected", delegate { Reject(delegate { Request("HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\n\r\n",0,3000); }); });
        Check("redirect is not followed", delegate { Reject(delegate { Request("HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:9/\r\nContent-Length: 0\r\n\r\n",0,3000); }); });
        Check("declared payload cap", delegate { Reject(delegate { Request("HTTP/1.1 200 OK\r\nContent-Length: 65537\r\n\r\n",0,3000); }); });
        Check("streamed payload cap", delegate { Reject(delegate { Request("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n"+new string('x',65537),0,3000); }); });
        Check("malformed JSON rejected", delegate { Reject(delegate { Request(Http("{invalid"),0,3000); }); });
        Check("full response body timeout", delegate { var timer=Stopwatch.StartNew(); Reject(delegate { Request("HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n{",5000,200); }); Assert(timer.ElapsedMilliseconds<2500); });
        Check("caller cancellation", delegate { using(var t=new DashboardTransport("http://127.0.0.1:9/")) using(var c=new CancellationTokenSource()) { c.Cancel(); Reject(delegate { t.PostAsync("api/dialogue","{}",c.Token).GetAwaiter().GetResult(); }); } });
        WorldPolicyTests.Run(Check);
        FoundationTests.Run(Check);
        MenuPolicyTests.Run(Check);
        string json=new JavaScriptSerializer().Serialize(new { checkedAt=DateTime.UtcNow.ToString("o"), total=Results.Count, passed=Results.Count-failed, failed=failed, gameExecuted=false, realApiCalled=false, tests=Results });
        if(args.Length>0) File.WriteAllText(args[0],json,Encoding.UTF8);
        Console.WriteLine((Results.Count-failed)+"/"+Results.Count+" passed");
        return failed==0 ? 0 : 1;
    }
}
