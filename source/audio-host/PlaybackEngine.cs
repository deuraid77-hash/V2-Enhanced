using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Speech.AudioFormat;
using System.Speech.Synthesis;
using System.Text.RegularExpressions;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace LivingLosSantos.Audio
{
    // Step 5 playback. VoiceMixer is pure arithmetic over float buffers and is exercised by
    // --self-test without any device. PlaybackEngine opens the shared-mode WASAPI device
    // lazily, only when the first line is actually played.
    public sealed class VoiceMixer : IWaveProvider
    {
        public const int OutputRate = 48000, SourceRate = 24000;
        private sealed class Voice
        {
            public string Id, NpcId, Category; public int Priority; public float[] Samples; public double Cursor;
            public double GainL, GainR, TargetL, TargetR, Alpha = 1, LowL; public long Received, FirstSample = -1, PoseAt;
            public double Fade = 1, FadeStep;
        }
        private readonly object gate = new object();
        private readonly List<Voice> voices = new List<Voice>();
        private readonly List<Dictionary<string, object>> finished = new List<Dictionary<string, object>>();
        private readonly WaveFormat format = WaveFormat.CreateIeeeFloatWaveFormat(OutputRate, 2);
        private float[] scratch = new float[0];
        public WaveFormat WaveFormat { get { return format; } }
        public int MaxVoices = 4; public double Master = 0.85, SmoothingMs = 40, PreemptFadeMs = 60; public int PoseStaleMs = 500;
        public Func<long> Clock = () => Stopwatch.GetTimestamp();
        public static double LowPassAlpha(double cutoffHz)
        { return cutoffHz <= 0 || cutoffHz >= OutputRate / 2.0 ? 1 : 1 - Math.Exp(-2 * Math.PI * cutoffHz / OutputRate); }
        private double Ms(long ticks) { return ticks * 1000.0 / Stopwatch.Frequency; }

        // Returns the id of a preempted lower-priority voice, or null. Throws when the line
        // cannot be admitted (full and not higher priority than any active voice).
        public string Add(string id, string npcId, string category, float[] samples, double left, double right)
        {
            if (samples == null || samples.Length < 2) throw new InvalidOperationException("Empty audio.");
            lock (gate)
            {
                if (voices.Any(v => v.Id == id)) throw new InvalidOperationException("Duplicate utterance.");
                string preempted = null; int priority = AudioPolicy.Priority(category);
                foreach (var same in voices.Where(v => v.NpcId == npcId && v.FadeStep == 0)) { same.FadeStep = FadeStep(); preempted = same.Id; }
                int live = voices.Count(v => v.FadeStep == 0);
                if (live >= Math.Max(1, MaxVoices))
                {
                    var lowest = voices.Where(v => v.FadeStep == 0).OrderBy(v => v.Priority).ThenBy(v => v.Received).First();
                    if (lowest.Priority >= priority) throw new InvalidOperationException("Voice limit reached by equal or higher priority speech.");
                    lowest.FadeStep = FadeStep(); preempted = lowest.Id;
                }
                long now = Clock();
                voices.Add(new Voice { Id = id, NpcId = npcId, Category = category, Priority = priority, Samples = samples, GainL = left, GainR = right, TargetL = left, TargetR = right, Received = now, PoseAt = now });
                return preempted;
            }
        }
        private double FadeStep() { return 1.0 / Math.Max(1, PreemptFadeMs * OutputRate / 1000.0); }
        public void SetTarget(string npcId, double left, double right, double lowPassHz)
        {
            lock (gate) foreach (var v in voices.Where(x => x.NpcId == npcId)) { v.TargetL = AudioPolicy.Clamp(left, 0, 1); v.TargetR = AudioPolicy.Clamp(right, 0, 1); v.Alpha = LowPassAlpha(lowPassHz); v.PoseAt = Clock(); }
        }
        public bool Stop(string id) { lock (gate) { bool any = false; foreach (var v in voices.Where(x => x.Id == id)) { v.FadeStep = FadeStep(); any = true; } return any; } }
        public int StopAll() { lock (gate) { foreach (var v in voices) v.FadeStep = FadeStep(); return voices.Count; } }
        public int Active { get { lock (gate) return voices.Count; } }

        // Pure mix of `frames` stereo frames into output (interleaved L,R).
        public void Mix(float[] output, int frames)
        {
            Array.Clear(output, 0, frames * 2);
            double smooth = 1 - Math.Exp(-1.0 / Math.Max(1, SmoothingMs * OutputRate / 1000.0)), step = (double)SourceRate / OutputRate;
            lock (gate)
            {
                long now = Clock();
                foreach (var v in voices)
                {
                    // Stale position telemetry silences the voice instead of freezing its last pan.
                    if (Ms(now - v.PoseAt) > PoseStaleMs) { v.TargetL = 0; v.TargetR = 0; }
                    if (v.FirstSample < 0) v.FirstSample = now;
                    for (int f = 0; f < frames; f++)
                    {
                        int i = (int)v.Cursor; if (i >= v.Samples.Length - 1) break;
                        double t = v.Cursor - i, s = v.Samples[i] + (v.Samples[i + 1] - v.Samples[i]) * t;
                        v.LowL += v.Alpha * (s - v.LowL);
                        v.GainL += (v.TargetL - v.GainL) * smooth; v.GainR += (v.TargetR - v.GainR) * smooth;
                        if (v.FadeStep > 0) { v.Fade -= v.FadeStep; if (v.Fade <= 0) { v.Fade = 0; break; } }
                        double g = Master * v.Fade;
                        output[f * 2] += (float)(v.LowL * v.GainL * g); output[f * 2 + 1] += (float)(v.LowL * v.GainR * g);
                        v.Cursor += step;
                    }
                }
                foreach (var done in voices.Where(v => v.Fade <= 0 || (int)v.Cursor >= v.Samples.Length - 1).ToArray())
                {
                    voices.Remove(done);
                    finished.Add(new Dictionary<string, object> { { "id", done.Id }, { "completed", done.Fade > 0 }, { "hostToFirstMixMs", Math.Round(Ms(done.FirstSample - done.Received), 2) }, { "durationMs", (int)(done.Samples.Length * 1000L / SourceRate) } });
                    if (finished.Count > 32) finished.RemoveAt(0);
                }
            }
            for (int k = 0; k < frames * 2; k++) output[k] = Math.Max(-1f, Math.Min(1f, output[k]));
        }
        public int Read(byte[] buffer, int offset, int count)
        {
            int frames = count / 8; if (scratch.Length < frames * 2) scratch = new float[frames * 2];
            Mix(scratch, frames); Buffer.BlockCopy(scratch, 0, buffer, offset, frames * 8); return frames * 8;
        }
        public object Status()
        { lock (gate) return new { active = voices.Select(v => new { id = v.Id, npcId = v.NpcId, category = v.Category, gainL = Math.Round(v.GainL, 3), gainR = Math.Round(v.GainR, 3) }).ToArray(), finished = finished.ToArray() }; }
    }

    public sealed class PlaybackEngine : IDisposable
    {
        private static readonly Regex CacheName = new Regex("^[a-f0-9]{64}\\.pcm$", RegexOptions.CultureInvariant);
        public readonly VoiceMixer Mixer = new VoiceMixer();
        private WasapiOut output; private string cacheRoot, deviceId = "default", lastError;
        public object Configure(Dictionary<string, object> r)
        {
            string root = Text(r, "cacheRoot", 400);
            if (!Path.IsPathRooted(root) || !Directory.Exists(root)) throw new InvalidOperationException("Cache root must be an existing absolute directory.");
            cacheRoot = Path.GetFullPath(root);
            Mixer.MaxVoices = (int)AudioPolicy.Clamp(Num(r, "maxVoices"), 1, 8); Mixer.Master = AudioPolicy.Clamp(Num(r, "masterVolume"), 0, 1);
            Mixer.SmoothingMs = AudioPolicy.Clamp(Num(r, "smoothingMs"), 10, 150); Mixer.PreemptFadeMs = AudioPolicy.Clamp(Num(r, "preemptFadeMs"), 20, 250); Mixer.PoseStaleMs = (int)AudioPolicy.Clamp(Num(r, "positionStaleMs"), 250, 2000);
            string requested = Text(r, "deviceId", 400); if (requested != deviceId) { deviceId = requested; CloseOutput(); }
            return new { configured = true };
        }
        public object Play(Dictionary<string, object> r)
        {
            if (cacheRoot == null) throw new InvalidOperationException("Playback is not configured.");
            string id = Text(r, "id", 128), npcId = Text(r, "npcId", 160), category = Text(r, "category", 32), source = Text(r, "source", 16);
            long started = Stopwatch.GetTimestamp(); float[] samples;
            if (source == "file") { string name = Text(r, "file", 80); if (!CacheName.IsMatch(name)) throw new InvalidOperationException("Invalid cache file."); samples = Pcm16(File.ReadAllBytes(Path.Combine(cacheRoot, name))); }
            else if (source == "windows") samples = RenderWindows(Text(r, "text", 600), (int)Num(r, "voiceIndex"), (int)Num(r, "rate"));
            else throw new InvalidOperationException("Unknown audio source.");
            double renderMs = (Stopwatch.GetTimestamp() - started) * 1000.0 / Stopwatch.Frequency;
            EnsureOutput();
            string preempted = Mixer.Add(id, npcId, category, samples, AudioPolicy.Clamp(Num(r, "left"), 0, 1), AudioPolicy.Clamp(Num(r, "right"), 0, 1));
            return new { id = id, preempted = preempted, renderMs = Math.Round(renderMs, 1), durationMs = samples.Length * 1000L / VoiceMixer.SourceRate };
        }
        public object Positions(Dictionary<string, object> r)
        {
            var listener = Point(r, "listener"); var right = Point(r, "right"); int updated = 0;
            double reference = Num(r, "referenceDistance"), max = Num(r, "maxDistance"), rolloff = Num(r, "rolloff"), strength = Num(r, "spatialStrength");
            var speakers = r.ContainsKey("speakers") ? r["speakers"] as System.Collections.ArrayList : null;
            if (speakers == null || speakers.Count > 8) throw new InvalidOperationException("Invalid speaker list.");
            foreach (var item in speakers)
            {
                var s = item as Dictionary<string, object>; if (s == null) throw new InvalidOperationException("Invalid speaker.");
                var g = AudioPolicy.Spatial(listener, right, Point(s, "position"), reference, max, rolloff, strength, Num(s, "gain"));
                Mixer.SetTarget(Text(s, "npcId", 160), g.Left, g.Right, Num(s, "lowPassHz")); updated++;
            }
            return new { updated = updated };
        }
        public object Status() { return new { deviceOpen = output != null, deviceId = deviceId, lastError = lastError, mixer = Mixer.Status() }; }
        private void EnsureOutput()
        {
            if (output != null) return;
            try
            {
                var enumerator = new MMDeviceEnumerator();
                var device = deviceId == "default" ? enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia) : enumerator.GetDevice(deviceId);
                output = new WasapiOut(device, AudioClientShareMode.Shared, true, 60);
                output.PlaybackStopped += delegate (object sender, StoppedEventArgs e) { lastError = e.Exception == null ? null : "Playback device stopped: " + e.Exception.GetType().Name; };
                output.Init(Mixer); output.Play();
            }
            catch (Exception ex) { CloseOutput(); lastError = "Playback device unavailable: " + ex.GetType().Name; throw new InvalidOperationException(lastError); }
        }
        private void CloseOutput() { var o = output; output = null; if (o != null) try { o.Stop(); o.Dispose(); } catch { } }
        public void Dispose() { Mixer.StopAll(); CloseOutput(); }

        // Renders to memory only; this never opens an output device.
        public static float[] RenderWindows(string text, int voiceIndex, int rate)
        {
            if (String.IsNullOrWhiteSpace(text)) throw new InvalidOperationException("Empty speech text.");
            using (var synth = new SpeechSynthesizer())
            using (var stream = new MemoryStream())
            {
                var installed = synth.GetInstalledVoices().Where(v => v.Enabled).ToArray();
                if (installed.Length > 0) synth.SelectVoice(installed[Math.Abs(voiceIndex) % installed.Length].VoiceInfo.Name);
                synth.Rate = Math.Max(-3, Math.Min(3, rate));
                synth.SetOutputToAudioStream(stream, new SpeechAudioFormatInfo(VoiceMixer.SourceRate, AudioBitsPerSample.Sixteen, AudioChannel.Mono));
                synth.Speak(text);
                synth.SetOutputToNull();
                return Pcm16(stream.ToArray());
            }
        }
        public static string[] WindowsVoices()
        { using (var synth = new SpeechSynthesizer()) return synth.GetInstalledVoices().Where(v => v.Enabled).Select(v => v.VoiceInfo.Name + "|" + v.VoiceInfo.Gender + "|" + v.VoiceInfo.Culture.Name).ToArray(); }
        public static float[] Pcm16(byte[] data)
        {
            if (data == null || data.Length < 4 || data.Length % 2 != 0 || data.Length > 24000 * 2 * 60) throw new InvalidOperationException("PCM must be 16-bit mono and at most 60 seconds.");
            var result = new float[data.Length / 2];
            for (int i = 0; i < result.Length; i++) result[i] = BitConverter.ToInt16(data, i * 2) / 32768f;
            return result;
        }
        private static string Text(Dictionary<string, object> r, string key, int max)
        { object v; if (!r.TryGetValue(key, out v) || !(v is string) || ((string)v).Length == 0 || ((string)v).Length > max) throw new InvalidOperationException("Invalid " + key + "."); return (string)v; }
        private static double Num(Dictionary<string, object> r, string key)
        { object v; if (!r.TryGetValue(key, out v) || v == null || v is string || v is bool) throw new InvalidOperationException("Invalid " + key + "."); double d = Convert.ToDouble(v, System.Globalization.CultureInfo.InvariantCulture); if (Double.IsNaN(d) || Double.IsInfinity(d)) throw new InvalidOperationException("Invalid " + key + "."); return d; }
        private static Point3 Point(Dictionary<string, object> r, string key)
        { object v; var p = r.TryGetValue(key, out v) ? v as Dictionary<string, object> : null; if (p == null) throw new InvalidOperationException("Invalid " + key + "."); return new Point3(Num(p, "x"), Num(p, "y"), Num(p, "z")); }

        public static int SelfTest()
        {
            int passed = 0; Action<bool> check = c => { if (!c) throw new InvalidOperationException("Playback policy test failed"); passed++; };
            long clock = 0; var m = new VoiceMixer { Clock = () => clock, MaxVoices = 2, Master = 1, SmoothingMs = 10, PreemptFadeMs = 20, PoseStaleMs = 500 };
            var tone = new float[24000]; for (int i = 0; i < tone.Length; i++) tone[i] = 0.5f;
            m.Add("a", "n1", "casual", tone, 1, 0); var buffer = new float[960];
            m.Mix(buffer, 480); check(buffer[958] > 0.45 && Math.Abs(buffer[959]) < 0.001); // hard-left voice
            m.SetTarget("n1", 0, 1, 0); for (int k = 0; k < 3; k++) m.Mix(buffer, 480); check(buffer[959] > 0.4 && buffer[958] < 0.1); // pan follows target with smoothing
            m.Add("b", "n2", "casual", tone, 1, 1);
            bool rejected = false; try { m.Add("c", "n3", "casual", tone, 1, 1); } catch (InvalidOperationException) { rejected = true; } check(rejected); // cap, equal priority
            check(m.Add("d", "n4", "conversation", tone, 1, 1) != null); // higher priority preempts
            for (int k = 0; k < 4; k++) m.Mix(buffer, 480); check(m.Active == 2); // preempted voice faded out
            check(m.Add("e", "n2", "combat", tone, 1, 1) == "b"); // same NPC replaces its own line
            clock += Stopwatch.Frequency; for (int k = 0; k < 4; k++) m.Mix(buffer, 480); check(Math.Abs(buffer[958]) < 0.05 && Math.Abs(buffer[959]) < 0.05); // stale pose silences
            m.StopAll(); for (int k = 0; k < 4; k++) m.Mix(buffer, 480); check(m.Active == 0);
            check(VoiceMixer.LowPassAlpha(30000) == 1 && VoiceMixer.LowPassAlpha(1800) < 0.3);
            var lp = new VoiceMixer { Clock = () => clock, Master = 1, SmoothingMs = 10 }; var alt = new float[24000]; for (int i = 0; i < alt.Length; i++) alt[i] = i % 2 == 0 ? 0.5f : -0.5f;
            lp.Add("x", "n", "casual", alt, 1, 1); lp.SetTarget("n", 1, 1, 300); var muffled = new float[960]; lp.Mix(muffled, 480); check(muffled.Skip(400).Max(v => (float)Math.Abs(v)) < 0.2); // low-pass removes Nyquist energy
            check(Pcm16(new byte[] { 0, 0x80, 0xff, 0x7f })[0] == -1f);
            rejected = false; try { Pcm16(new byte[3]); } catch (InvalidOperationException) { rejected = true; } check(rejected);
            return passed;
        }
    }
}
