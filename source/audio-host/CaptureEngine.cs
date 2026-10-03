using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace LivingLosSantos.Audio
{
    // All OS audio/focus calls live in this separate helper, never in GTA's DLL.
    internal static class CaptureFocus
    {
        [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window,out uint processId);
        internal static int GameProcess()
        { uint id;GetWindowThreadProcessId(GetForegroundWindow(),out id);if(id==0)return 0;try{using(var p=Process.GetProcessById((int)id))return String.Equals(p.ProcessName,"GTA5_Enhanced",StringComparison.OrdinalIgnoreCase)?(int)id:0;}catch{return 0;} }
    }
    internal static class CaptureGuard
    {
        internal static string Reason(long now,long lease,long started,int maximum,bool focus,bool device)
        { if(!focus)return "focus_lost";if(!device)return "device_lost";if(now>=lease)return "lease_expired";if(now-started>=maximum)return "max_duration";return null; }
    }
    // Teardown never owns the engine lock. A hung native driver cannot block the
    // command reader or a cancellation receipt; new captures stay disabled until
    // the retired driver is fully disposed. Process shutdown is the final bound.
    internal sealed class CaptureRetirement
    {
        internal static void Signal(ManualResetEventSlim ended){try{ended.Set();}catch(ObjectDisposedException){/* Late driver callback after bounded teardown. */}}
        internal static void Begin(Action stop,Action dispose,ManualResetEventSlim ended,Action finished,int waitMs)
        {ThreadPool.QueueUserWorkItem(delegate(object unused){try{try{stop();}catch{}ended.Wait(waitMs);dispose();}catch{}finally{ended.Dispose();finished();}});}
        internal static int SelfTest()
        {
            int n=0;object testGate=new object();var ended=new ManualResetEventSlim(false);var done=new ManualResetEventSlim(false);bool disposed=false;
            lock(testGate){Begin(delegate{ThreadPool.QueueUserWorkItem(delegate(object unused){lock(testGate)ended.Set();});},delegate{lock(testGate)disposed=true;},ended,delegate{done.Set();},100);}
            if(!done.Wait(1000)||!disposed)throw new InvalidOperationException();n++;done.Dispose();
            var delayed=new ManualResetEventSlim(false);var releaseDispose=new ManualResetEventSlim(false);var finished=new ManualResetEventSlim(false);var enteredDispose=new ManualResetEventSlim(false);
            Begin(delegate{},delegate{enteredDispose.Set();releaseDispose.Wait();},delayed,delegate{finished.Set();},20);
            if(!enteredDispose.Wait(1000)||finished.IsSet)throw new InvalidOperationException();n++;delayed.Set();releaseDispose.Set();if(!finished.Wait(1000))throw new InvalidOperationException();n++;enteredDispose.Dispose();releaseDispose.Dispose();finished.Dispose();return n;
        }
    }
    internal sealed class CaptureEngine : IDisposable
    {
        private readonly object gate=new object();private readonly Stopwatch clock=Stopwatch.StartNew();
        private WasapiCapture capture;private MMDevice device;private MemoryStream raw;private byte[] pcm;private WaveFormat format;
        private ManualResetEventSlim stopped;
        private EventHandler<StoppedEventArgs> stopHandler;
        private int retiring;private bool disposed;
        private readonly Timer timer;private string id="",state="idle",reason="",deviceId="",deviceName="";private long lease,started;private int sequence,maximum,foreground;private double sensitivity=1,rms;
        internal CaptureEngine(){timer=new Timer(Check,null,100,100);}
        internal object Devices()
        {
            var values=new List<object>();using(var enumerator=new MMDeviceEnumerator()){
                string defaultId="";try{using(var selected=enumerator.GetDefaultAudioEndpoint(DataFlow.Capture,Role.Multimedia))defaultId=selected.ID;}catch{}
                foreach(var item in enumerator.EnumerateAudioEndPoints(DataFlow.Capture,DeviceState.Active)){using(item){if(values.Count>=128)break;values.Add(new{id=item.ID,name=item.FriendlyName,isDefault=item.ID==defaultId,available=true});}}
            }return values;
        }
        internal object Start(string captureId,string requestedDevice,int maxDuration,double gain)
        {
            Guid parsed;if(!Guid.TryParse(captureId,out parsed)||maxDuration<2000||maxDuration>30000||Double.IsNaN(gain)||gain<.1||gain>3)throw new InvalidOperationException();
            Cancel(null);int focused=CaptureFocus.GameProcess();if(focused==0)throw new InvalidOperationException("focus_lost");
            lock(gate){if(disposed||retiring>0)throw new InvalidOperationException("capture_busy");id=captureId;state="starting";reason="";sequence=0;maximum=maxDuration;sensitivity=gain;foreground=focused;lease=clock.ElapsedMilliseconds+800;started=clock.ElapsedMilliseconds;raw=new MemoryStream();pcm=null;rms=0;stopped=new ManualResetEventSlim(false);
                try{using(var enumerator=new MMDeviceEnumerator())device=requestedDevice=="default"?enumerator.GetDefaultAudioEndpoint(DataFlow.Capture,Role.Multimedia):enumerator.GetDevice(requestedDevice);
                    if(device.State!=DeviceState.Active)throw new InvalidOperationException();deviceId=device.ID;deviceName=device.FriendlyName;
                    capture=new WasapiCapture(device);format=capture.WaveFormat;
                    if(format.SampleRate<8000||format.SampleRate>96000||format.Channels<1||format.Channels>2||format.BitsPerSample>32)throw new InvalidOperationException();
                    var thisStopped=stopped;stopHandler=delegate(object sender,StoppedEventArgs args){try{OnStopped(sender,args);}finally{CaptureRetirement.Signal(thisStopped);}};
                    capture.DataAvailable+=OnData;capture.RecordingStopped+=stopHandler;capture.StartRecording();state="capturing";
                }catch{state="cancelled";reason="capture_unavailable";stopped.Set();RetireLocked();Clear();throw;}
                return new{deviceId=deviceId,deviceName=deviceName};
            }
        }
        private void OnData(object sender,WaveInEventArgs args)
        {lock(gate){if(disposed||!Object.ReferenceEquals(sender,capture)||(state!="capturing"&&state!="stopping"))return;if(raw==null||raw.Length+args.BytesRecorded>24*1024*1024){AbortLocked("audio_limit");return;}raw.Write(args.Buffer,0,args.BytesRecorded);}}
        private void OnStopped(object sender,StoppedEventArgs args)
        {lock(gate){if(disposed||!Object.ReferenceEquals(sender,capture))return;if(args.Exception!=null){state="cancelled";reason="device_lost";Clear();}else if(state=="capturing"||state=="starting"){state="cancelled";reason="device_lost";Clear();}}}
        private void Check(object unused)
        {lock(gate){if(disposed||(state!="capturing"&&state!="starting"&&state!="stopping"&&state!="ready"))return;bool active=false;try{active=device!=null&&device.State==DeviceState.Active;}catch{}string why=CaptureGuard.Reason(clock.ElapsedMilliseconds,lease,started,maximum,CaptureFocus.GameProcess()==foreground,active);if(state=="stopping"||state=="ready"){if(why=="lease_expired"||why=="max_duration")why=null;}if(why!=null)AbortLocked(why);}}
        private void AbortLocked(string why){state="cancelled";reason=why;Clear();if(capture!=null)try{capture.StopRecording();}catch{stopped.Set();}}
        internal object Lease(string captureId,int next)
        {lock(gate){Require(captureId);if(next<1)throw new InvalidOperationException();if(next>sequence&&(state=="starting"||state=="capturing")){if(clock.ElapsedMilliseconds>=lease)AbortLocked("lease_expired");else{sequence=next;lease=clock.ElapsedMilliseconds+800;}}return new{state=state,reasonCode=reason};}}
        internal object Stop(string captureId)
        {
            WasapiCapture current;ManualResetEventSlim ending;lock(gate){Require(captureId);if(state!="capturing")return new{state=state,reasonCode=reason};Check(null);if(state!="capturing")return new{state=state,reasonCode=reason};state="stopping";current=capture;ending=stopped;}
            current.StopRecording();if(!ending.Wait(2000)){lock(gate){AbortLocked("capture_stop_timeout");RetireLocked();}return new{state="cancelled",reasonCode="capture_stop_timeout"};}
            lock(gate){if(state!="stopping")return new{state=state,reasonCode=reason};try{byte[] source=raw.ToArray();try{pcm=Normalize(source,format,sensitivity,maximum,out rms);}finally{Array.Clear(source,0,source.Length);}ClearRaw();state="ready";return new{state=state,bytes=pcm.Length,rms=rms,durationMs=pcm.Length/32.0};}catch{AbortLocked("invalid_audio");return new{state=state,reasonCode=reason};}}
        }
        internal object Chunk(string captureId,int index)
        {lock(gate){Require(captureId);Check(null);if(state!="ready"||pcm==null||index<0||index>29)throw new InvalidOperationException();int offset=index*32768;if(offset>=pcm.Length)throw new InvalidOperationException();int count=Math.Min(32768,pcm.Length-offset);return new{id=id,sequence=index,data=Convert.ToBase64String(pcm,offset,count)};}}
        internal object Focus(string captureId)
        {lock(gate){if(captureId!=id||foreground==0||CaptureFocus.GameProcess()!=foreground)return new{valid=false,reasonCode="focus_lost"};try{using(var enumerator=new MMDeviceEnumerator())using(var selected=enumerator.GetDevice(deviceId)){if(selected.State!=DeviceState.Active)return new{valid=false,reasonCode="device_lost"};}}catch{return new{valid=false,reasonCode="device_lost"};}return new{valid=true,reasonCode=""};}}
        internal void Cancel(string captureId)
        {
            lock(gate){if(captureId!=null&&captureId!=id)return;state="cancelled";reason="cancelled";Clear();RetireLocked();}
        }
        private void Require(string captureId){if(captureId!=id||String.IsNullOrEmpty(id))throw new InvalidOperationException();}
        private void ClearRaw(){if(raw!=null){byte[] buffer=raw.GetBuffer();Array.Clear(buffer,0,buffer.Length);raw.Dispose();raw=null;}}
        private void Clear(){ClearRaw();if(pcm!=null){Array.Clear(pcm,0,pcm.Length);pcm=null;}}
        private void RetireLocked(){var old=capture;var oldDevice=device;var ending=stopped;var handler=stopHandler;capture=null;device=null;stopped=null;stopHandler=null;if(old==null){if(oldDevice!=null)oldDevice.Dispose();if(ending!=null)ending.Dispose();return;}retiring++;CaptureRetirement.Begin(delegate{old.StopRecording();},delegate{try{old.Dispose();}finally{try{old.DataAvailable-=OnData;old.RecordingStopped-=handler;}finally{if(oldDevice!=null)oldDevice.Dispose();}}},ending,delegate{lock(gate)retiring--;},2000);}
        public void Dispose(){lock(gate){if(disposed)return;disposed=true;}using(var complete=new ManualResetEvent(false)){if(timer.Dispose(complete))complete.WaitOne(1000);}Cancel(null);}
        internal static byte[] Normalize(byte[] bytes,WaveFormat wave,double gain,int maxMs,out double rmsValue)
        {
            if(bytes.Length%wave.BlockAlign!=0)throw new InvalidOperationException();
            using(var stream=new RawSourceWaveStream(bytes,0,bytes.Length,wave)){
                ISampleProvider sample=stream.ToSampleProvider();if(sample.WaveFormat.Channels==2)sample=new StereoToMonoSampleProvider(sample){LeftVolume=.5f,RightVolume=.5f};if(sample.WaveFormat.Channels!=1)throw new InvalidOperationException();
                sample=new WdlResamplingSampleProvider(sample,16000);using(var output=new MemoryStream()){
                    var buffer=new float[1024];int read;double sum=0;long count=0;while((read=sample.Read(buffer,0,buffer.Length))>0){if(output.Length+read*2>Math.Min(960000,maxMs*32))throw new InvalidOperationException();for(int i=0;i<read;i++){double v=Math.Max(-1,Math.Min(1,buffer[i]*gain));if(Double.IsNaN(v)||Double.IsInfinity(v))v=0;short value=(short)Math.Round(v*32767);output.WriteByte((byte)(value&255));output.WriteByte((byte)((value>>8)&255));sum+=v*v;count++;}}rmsValue=count>0?Math.Sqrt(sum/count):0;return output.ToArray();
                }
            }
        }
        internal static int SelfTest()
        {
            int n=0;Action<bool> check=delegate(bool ok){if(!ok)throw new InvalidOperationException();n++;};
            check(CaptureGuard.Reason(10,1000,0,2000,true,true)==null);check(CaptureGuard.Reason(1000,1000,0,2000,true,true)=="lease_expired");check(CaptureGuard.Reason(10,1000,0,2000,false,true)=="focus_lost");check(CaptureGuard.Reason(10,1000,0,2000,true,false)=="device_lost");check(CaptureGuard.Reason(2000,3000,0,2000,true,true)=="max_duration");
            byte[] samples=new byte[48000*2*2];for(int i=0;i<48000;i++){short value=(short)(Math.Sin(i*2*Math.PI*440/48000)*16000);for(int channel=0;channel<2;channel++){int at=i*4+channel*2;samples[at]=(byte)(value&255);samples[at+1]=(byte)((value>>8)&255);}}
            double rms;byte[] result=Normalize(samples,new WaveFormat(48000,16,2),1,2000,out rms);check(result.Length>=31900&&result.Length<=32000);check(rms>.3&&rms<.4);byte[] silent=Normalize(new byte[16000*2],new WaveFormat(16000,16,1),1,2000,out rms);check(rms==0);check(silent.Length==32000);bool bounded=false;try{Normalize(samples,new WaveFormat(48000,16,2),1,100,out rms);}catch{bounded=true;}check(bounded);n+=CaptureRetirement.SelfTest();using(var engine=new CaptureEngine()){engine.Dispose();engine.Dispose();check(true);}return n;
        }
    }
}
