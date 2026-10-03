using System;
using System.Collections.Generic;
using System.Linq;

namespace LivingLosSantosV2
{
    public sealed class ReplyOption {public string Id,Text,Tone;}
    public sealed class ReplySet
    {
        public string JobId,Source;public DateTime Expires;public ReplyOption[] Options;
        public static ReplySet Parse(string job,string source,Dictionary<string,object> payload,DateTime now)
        {var options=Wire.Maps(Wire.Value(payload,"quickReplies")).Take(6).Select(x=>new ReplyOption{Id=Wire.Text(x,"id",128),Text=ResponsePolicy.CleanText(Wire.Text(x,"text",180),180),Tone=Wire.Text(x,"tone",24)}).ToArray();Guid guid;if(options.Length<3||options.Length>5||options.Select(x=>x.Id).Distinct().Count()!=options.Length||options.Any(x=>String.IsNullOrWhiteSpace(x.Text)||!Guid.TryParse(x.Id,out guid)||!new[]{"friendly","neutral","firm","apologetic","curious"}.Contains(x.Tone)))throw new InvalidOperationException("Invalid quick reply options.");var expires=Wire.Timestamp(payload,"expiresAt");if(expires<=now||expires>now.AddSeconds(35))throw new InvalidOperationException("Quick replies expired.");return new ReplySet{JobId=job,Source=source,Expires=expires,Options=options};}
        public static ReplySet Fallback(DateTime now){return new ReplySet{Source="local fallback",Expires=now.AddSeconds(30),Options=new[]{new ReplyOption{Text="Hi. How is your day going?",Tone="friendly"},new ReplyOption{Text="What is happening around here?",Tone="curious"},new ReplyOption{Text="Sorry for bothering you.",Tone="apologetic"}}};}
    }
    public static class RadialPolicy
    {
        public static int Select(double x,double y,int count,double deadzone,int current){if(count<1||count>5||Double.IsNaN(x)||Double.IsNaN(y)||Double.IsInfinity(x)||Double.IsInfinity(y))return current;if(x*x+y*y<deadzone*deadzone)return current;double angle=Math.Atan2(y,x)+Math.PI/2;if(angle<0)angle+=2*Math.PI;return ((int)Math.Floor(angle/(2*Math.PI/count)+.5))%count;}
    }
    public sealed class HeldCaptureGate
    {
        public bool Armed=true,WasHeld;public int Generation;public DateTime Began;
        public string Poll(bool held,bool allowed,DateTime now,int maxSeconds)
        {if(!held){bool release=WasHeld&&Armed;WasHeld=false;Armed=true;return release?"release":null;}if(!allowed){bool active=WasHeld&&Armed;WasHeld=true;Armed=false;if(active){Generation++;return "cancel";}return null;}if(!Armed){WasHeld=true;return null;}if(!WasHeld){WasHeld=true;Began=now;Generation++;return "start";}if(now-Began>=TimeSpan.FromSeconds(maxSeconds)){Armed=false;Generation++;return "cancel";}return null;}
        public void Cancel(){Armed=false;Generation++;}
    }
}
