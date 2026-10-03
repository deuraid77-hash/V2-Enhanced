using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace LivingLosSantosV2
{
    public sealed class DashboardTransport : IDisposable
    {
        private readonly HttpClient client;
        private readonly Uri address;
        private readonly TimeSpan timeout;
        public const int MaxResponseBytes = 65536;

        public DashboardTransport(string endpoint) : this(endpoint, TimeSpan.FromSeconds(35)) { }

        internal DashboardTransport(string endpoint, TimeSpan requestTimeout)
        {
            address = new Uri(endpoint, UriKind.Absolute);
            if (address.Scheme != "http" || address.Host != "127.0.0.1" || address.AbsolutePath != "/"
                || address.UserInfo.Length != 0 || address.Query.Length != 0 || address.Fragment.Length != 0)
                throw new ArgumentException("The game client connects only to the local dashboard at 127.0.0.1.");
            timeout = requestTimeout;
            client = new HttpClient(new HttpClientHandler { UseProxy = false, AllowAutoRedirect = false });
            client.Timeout = Timeout.InfiniteTimeSpan;
        }

        public async Task<Dictionary<string, object>> PostAsync(string route, string json, CancellationToken token)
        {
            if (route != "api/dialogue" && route != "api/runtime/telemetry" && route != "api/runtime/exchange" && route != "api/ai/jobs")
                throw new ArgumentException("Unsupported dashboard route.");
            return await RequestAsync(HttpMethod.Post,route,json,token).ConfigureAwait(false);
        }
        public Task<Dictionary<string,object>> CancelJobAsync(string jobId,CancellationToken token)
        {
            Guid parsed;
            if(!Guid.TryParse(jobId,out parsed)) throw new ArgumentException("Invalid local job identity.");
            return RequestAsync(HttpMethod.Delete,"api/ai/jobs/"+Uri.EscapeDataString(jobId),null,token);
        }
        private async Task<Dictionary<string,object>> RequestAsync(HttpMethod method,string route,string json,CancellationToken token)
        {
            using (var requestCancellation = CancellationTokenSource.CreateLinkedTokenSource(token))
            using (var request = new HttpRequestMessage(method, new Uri(address, route)))
            {
                requestCancellation.CancelAfter(route == "api/runtime/exchange" || route.StartsWith("api/ai/jobs",StringComparison.Ordinal) ? TimeSpan.FromSeconds(3) : timeout);
                token = requestCancellation.Token;
                if(json!=null) request.Content = new StringContent(json, Encoding.UTF8, "application/json");
                using (var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token).ConfigureAwait(false))
                using (token.Register(delegate { response.Dispose(); }))
                {
                    if (!response.IsSuccessStatusCode)
                        throw new InvalidOperationException("Dashboard HTTP " + (int)response.StatusCode + ". Open the dashboard and check its local server.");
                    if (response.Content.Headers.ContentLength > MaxResponseBytes)
                        throw new InvalidOperationException("Dashboard response exceeded the allowed size.");
                    using (var stream = await response.Content.ReadAsStreamAsync().ConfigureAwait(false))
                    using (var memory = new MemoryStream())
                    {
                        var buffer = new byte[4096];
                        int count;
                        while ((count = await stream.ReadAsync(buffer, 0, buffer.Length, token).ConfigureAwait(false)) > 0)
                        {
                            if (memory.Length + count > MaxResponseBytes)
                                throw new InvalidOperationException("Dashboard response exceeded the allowed size.");
                            memory.Write(buffer, 0, count);
                        }
                        token.ThrowIfCancellationRequested();
                        var serializer = new JavaScriptSerializer { MaxJsonLength = MaxResponseBytes, RecursionLimit = 24 };
                        return serializer.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(memory.ToArray()));
                    }
                }
            }
        }

        public void Dispose() { client.Dispose(); }
    }
}
