using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using GTA;
using GTA.Math;

namespace LivingLosSantosV2
{
    // Companion-side voice: the game only reports positions and the lines it already shows as subtitles.
    // One bounded frame at audio.positionHz, one request in flight; audio itself plays in the companion helper.
    public sealed partial class EnhancedClient
    {
        private sealed class VoiceSpeaker { public Ped Ped; public int Handle,Model; public DateTime LastCue; }
        private sealed class VoiceReply { public string Epoch; public int Generation; public Dictionary<string,object> Data; public string Error; }
        private readonly DashboardTransport audioTransport=new DashboardTransport("http://127.0.0.1:3000/");
        private readonly VoiceFrameGate voiceGate=new VoiceFrameGate();
        private readonly BarkGate barkGate=new BarkGate();
        private readonly List<Dictionary<string,object>> voiceCues=new List<Dictionary<string,object>>(), voiceBarks=new List<Dictionary<string,object>>();
        private readonly Dictionary<string,VoiceSpeaker> voiceSpeakers=new Dictionary<string,VoiceSpeaker>();
        private readonly Dictionary<int,int> barkHealth=new Dictionary<int,int>();
        private readonly ConcurrentQueue<VoiceReply> voiceReplies=new ConcurrentQueue<VoiceReply>();
        private readonly Random barkRandom=new Random();
        private DateTime nextBarkScan=DateTime.MinValue,nextVoiceError=DateTime.MinValue,lastVoiceActivity=DateTime.MinValue;
        private bool voiceStopSent; private int voiceGeneration;

        private void QueueVoiceCue(Ped ped,string npcId,string text,string tone,string category,string source,string lane)
        {
            if(ped==null||!ped.Exists()||String.IsNullOrEmpty(npcId)||String.IsNullOrEmpty(text))return;
            int max=Math.Max(80,Math.Min(600,(int)npcSettings.Number("ai.maxSpeechCharacters")));
            string clean=new string(ResponsePolicy.CleanText(text,800).Where(c=>c!='<'&&c!='>'&&c!='~').ToArray()).Trim();
            if(clean.Length==0)return; if(clean.Length>max)clean=clean.Substring(0,max);
            if(voiceCues.Count>=VoicePolicy.MaxCues)voiceCues.RemoveAt(0);
            voiceCues.Add(new Dictionary<string,object>{{"cueId",Guid.NewGuid().ToString("N")},{"npcId",npcId},{"speaker",Short(SpeakerName(ped))},{"text",clean},{"tone",VoicePolicy.Tone(tone)},{"category",category},{"source",VoicePolicy.CueSource(source)},{"lane",lane}});
            TrackVoiceSpeaker(npcId,ped);
        }
        private static string Short(string name){string s=ResponsePolicy.CleanText(name,80);return s.Length==0?"NPC":s.Length>60?s.Substring(0,60):s;}
        private void TrackVoiceSpeaker(string npcId,Ped ped)
        {
            VoiceSpeaker s;if(!voiceSpeakers.TryGetValue(npcId,out s)){if(voiceSpeakers.Count>=VoicePolicy.MaxSpeakers){var oldest=voiceSpeakers.OrderBy(k=>k.Value.LastCue).First().Key;voiceSpeakers.Remove(oldest);}s=new VoiceSpeaker{Ped=ped,Handle=ped.Handle,Model=ped.Model.Hash};voiceSpeakers[npcId]=s;}
            s.LastCue=DateTime.UtcNow;lastVoiceActivity=DateTime.UtcNow;
        }
        private void ClearAudio()
        { voiceGeneration++;voiceGate.Reset();voiceCues.Clear();voiceBarks.Clear();voiceSpeakers.Clear();barkHealth.Clear();barkGate.Clear();VoiceReply r;while(voiceReplies.TryDequeue(out r)){} }

        private void TickAudio(Ped player,string pause)
        {
            DateTime now=DateTime.UtcNow;
            VoiceReply reply;int drained=0;
            while(drained++<4&&voiceReplies.TryDequeue(out reply)) ConsumeVoiceReply(reply);
            bool stop=VoicePolicy.StopsAudio(pause)||!WorldDirector.Alive(player);
            if(!stop&&npcSettings.Flag("audio.enabled")&&now>=nextBarkScan){nextBarkScan=now.AddMilliseconds(300);ScanBarks(player,now);}
            foreach(var key in voiceSpeakers.Where(k=>k.Value.Ped==null||!k.Value.Ped.Exists()||k.Value.Ped.Handle!=k.Value.Handle||now-k.Value.LastCue>TimeSpan.FromSeconds(30)).Select(k=>k.Key).ToArray())voiceSpeakers.Remove(key);
            bool pending=voiceCues.Count>0||voiceBarks.Count>0, active=now-lastVoiceActivity<TimeSpan.FromSeconds(30)&&voiceSpeakers.Count>0;
            bool stopEdge=stop&&!voiceStopSent&&active;
            if(!pending&&!(active&&!stop)&&!stopEdge)return;
            if(!voiceGate.TryBegin(now,npcSettings.Number("audio.positionHz")))return;
            Dictionary<string,object> frame;
            try{frame=BuildVoiceFrame(player,stop);}catch(Exception ex){voiceGate.End();VoiceError("Voice frame skipped: "+ex.GetType().Name);return;}
            if(frame==null){voiceGate.End();return;}
            voiceStopSent=stop;
            voiceCues.Clear();voiceBarks.Clear();
            string json=serializer.Serialize(frame),epoch=sceneEpoch;int generation=voiceGeneration;
            Task.Run(async delegate{var r=new VoiceReply{Epoch=epoch,Generation=generation};try{r.Data=await audioTransport.PostAsync("api/audio/frame",json,cancellation.Token).ConfigureAwait(false);}catch(Exception ex){r.Error=ex is InvalidOperationException?ResponsePolicy.CleanText(ex.Message,180):ex.GetType().Name;}if(!stopping)voiceReplies.Enqueue(r);});
        }
        private Dictionary<string,object> BuildVoiceFrame(Ped player,bool paused)
        {
            Vector3 listener=GameplayCamera.Position,right=GameplayCamera.RightVector;
            if(!Finite(listener)||!Finite(right))return null;
            bool inVehicle=player.IsInVehicle();Vehicle vehicle=inVehicle?player.CurrentVehicle:null;
            var speakers=new List<object>();
            foreach(var pair in voiceSpeakers.Take(VoicePolicy.MaxSpeakers))
            {
                Ped p=pair.Value.Ped;if(p==null||!p.Exists()||p.Handle!=pair.Value.Handle||p.Model.Hash!=pair.Value.Model)continue;
                Vector3 pos=p.Position;if(!Finite(pos))continue;
                speakers.Add(new Dictionary<string,object>{{"npcId",pair.Key},{"position",Point(pos)},{"alive",p.IsAlive},{"interior",Interior(p)},{"inPlayerVehicle",vehicle!=null&&p.IsInVehicle(vehicle)}});
            }
            return new Dictionary<string,object>{{"runtimeId",runtimeId},{"sceneEpoch",sceneEpoch},{"paused",paused},{"listener",Point(listener)},{"right",Point(right)},{"playerInVehicle",inVehicle},{"playerInterior",Interior(player)},
                {"speakers",speakers.ToArray()},{"cues",voiceCues.Take(VoicePolicy.MaxCues).Cast<object>().ToArray()},{"barks",voiceBarks.Take(VoicePolicy.MaxBarks).Cast<object>().ToArray()}};
        }
        private static bool Finite(Vector3 v){return !(float.IsNaN(v.X)||float.IsNaN(v.Y)||float.IsNaN(v.Z)||float.IsInfinity(v.X)||float.IsInfinity(v.Y)||float.IsInfinity(v.Z));}
        private static Dictionary<string,object> Point(Vector3 v){return new Dictionary<string,object>{{"x",Math.Round(v.X,2)},{"y",Math.Round(v.Y,2)},{"z",Math.Round(v.Z,2)}};}
        private static int Interior(Ped p){var proxy=p.CurrentInteriorProxy;return proxy==null?0:proxy.Handle;}
        private void ConsumeVoiceReply(VoiceReply reply)
        {
            voiceGate.End();
            if(reply.Error!=null){VoiceError("Voice companion: "+reply.Error);return;}
            if(reply.Generation!=voiceGeneration||reply.Epoch!=sceneEpoch)return;
            try
            {
                foreach(var bark in Wire.Maps(Wire.Value(reply.Data,"barks")).Take(VoicePolicy.MaxBarks))
                {
                    string npcId=Wire.Text(bark,"npcId",128),text=ResponsePolicy.CleanText(Wire.Text(bark,"text",400),200),source=Wire.Text(bark,"source",16);
                    VoiceSpeaker s;if(!voiceSpeakers.TryGetValue(npcId,out s)||s.Ped==null||!s.Ped.Exists()||!s.Ped.IsAlive)continue;
                    Caption(Short(SpeakerName(s.Ped))+" ["+source+"]: "+text,VoicePolicy.SubtitleMs(text));
                }
            }
            catch(InvalidOperationException ex){VoiceError("Voice reply rejected: "+ResponsePolicy.CleanText(ex.Message,160));}
        }
        private void VoiceError(string message){if(DateTime.UtcNow<nextVoiceError)return;nextVoiceError=DateTime.UtcNow.AddSeconds(30);Log(message);}

        // At most one bark request per scan; companion cooldowns per speaker and group still apply.
        private void ScanBarks(Ped player,DateTime now)
        {
            var health=new Dictionary<int,int>();
            Entity targeted=Game.Player.IsAiming?Game.Player.TargetedEntity:null;
            Ped talk=talkSession!=null?talkSession.Ped:null,scenario=scenarioRun!=null?scenarioRun.Ped:null,job=conversation!=null?conversation.Ped:null;
            string chosenGroup=null,chosenTag=null;Ped chosen=null;
            foreach(Ped p in World.GetNearbyPeds(player,25f).Take(16))
            {
                if(p==null||!p.Exists()||p.Handle==player.Handle||!p.IsHuman||ScriptProtected(p))continue;
                if(talk!=null&&p.Handle==talk.Handle||scenario!=null&&p.Handle==scenario.Handle||job!=null&&p.Handle==job.Handle)continue;
                int hp=p.Health,prior;health[p.Handle]=hp;
                if(chosen!=null||!p.IsAlive)continue;
                string group=null,tag=null;
                if(barkHealth.TryGetValue(p.Handle,out prior)&&hp<prior-5){group="hurt";tag=p.IsBeingStunned?"tased":p.IsRagdoll?"shoved":"punched";}
                else if(p.IsInCombat){group="combat";tag=p.IsReloading?"reload":p.IsInCover?"cover":p.IsShooting?"suppress":"taunt";}
                else if(targeted!=null&&targeted.Handle==p.Handle){group="reaction";tag="weapon_drawn";}
                else if(player.IsOnFoot&&p.IsOnFoot&&p.Position.DistanceTo(player.Position)<1.2f){group="reaction";tag="too_close";}
                if(group==null)continue;
                double density=group=="combat"?npcSettings.Number("combat.barkDensity"):100;
                if(!barkGate.Admit(NpcId(p),group,now,density,barkRandom.NextDouble()))continue;
                chosen=p;chosenGroup=group;chosenTag=tag;
            }
            barkHealth.Clear();foreach(var pair in health)barkHealth[pair.Key]=pair.Value;
            if(chosen==null||voiceBarks.Count>=VoicePolicy.MaxBarks)return;
            string npcId=NpcId(chosen);
            voiceBarks.Add(new Dictionary<string,object>{{"requestId",Guid.NewGuid().ToString("N")},{"npcId",npcId},{"speaker",Short(SpeakerName(chosen))},{"group",chosenGroup},{"tags",new[]{chosenTag}}});
            TrackVoiceSpeaker(npcId,chosen);
        }
    }
}
