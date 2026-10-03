using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;
using GTA;
using GTA.Math;
using GTA.Native;
using GTA.UI;
using Control=GTA.Control;
using Screen=GTA.UI.Screen;
using Font=GTA.UI.Font;

namespace LivingLosSantosV2
{
    public sealed partial class EnhancedClient
    {
        private sealed class TalkSession{public Ped Ped;public int Handle,Model,Turns,PlayerHealth,NpcHealth;public string Epoch,NpcId;public DateTime IdleUntil;}
        private TalkSession talkSession;
        private ActiveJob quickJob;private ReplySet replySet;private bool replyWheel;private int replySelected;
        private readonly ConcurrentQueue<Keys> replyKeys=new ConcurrentQueue<Keys>();
        private readonly ContainerElement replyPanel=new ContainerElement();
        private readonly TextElement replyText=new TextElement("",PointF.Empty,.28f,Color.White,Font.ChaletLondon,Alignment.Center,false,true);
        private DateTime nextTargetHint=DateTime.MinValue;private SeenNpc targetHint;
        private string SpeakerName(Ped ped){NpcMemory memory=Memory(ped,false);return memory!=null&&memory.Hydration!=null&&memory.Hydration.Persona!=null?ResponsePolicy.CleanText(memory.Hydration.Persona["name"],80):(director.Faction(ped)=="Civilian/Unknown"?"Pedestrian":director.Faction(ped))+" "+ped.Handle;}
        private Ped PickTalkTarget(Ped player)
        {var candidates=seen.Values.Where(s=>DateTime.UtcNow-s.At<TimeSpan.FromSeconds(3)&&s.Ped.Exists()&&s.Model==s.Ped.Model.Hash&&Interactable(s.Ped,player,(float)npcSettings.Number("conversation.rangeMeters"))).Select(s=>s.Ped);return candidates.OrderBy(p=>Game.Player.IsTargeting(p)?0:1).ThenBy(p=>p.Position.DistanceToSquared(player.Position)).FirstOrDefault()??World.GetNearbyPeds(player,(float)npcSettings.Number("conversation.rangeMeters")).Where(p=>Interactable(p,player,(float)npcSettings.Number("conversation.rangeMeters"))).OrderBy(p=>p.Position.DistanceToSquared(player.Position)).FirstOrDefault();}
        private bool BeginTalkSession(Ped target,Ped player)
        {if(!Interactable(target,player,(float)npcSettings.Number("conversation.walkAwayMeters")))return false;if(talkSession!=null&&talkSession.Handle==target.Handle&&talkSession.Model==target.Model.Hash&&talkSession.Epoch==sceneEpoch){if(talkSession.Turns>=(int)npcSettings.Number("conversation.maxTurns")){Caption("This conversation has reached its turn limit.",3500);return false;}talkSession.IdleUntil=DateTime.UtcNow.AddSeconds(npcSettings.Number("conversation.timeoutSeconds"));return true;}EndTalkSession("Starting a new conversation.",false);talkSession=new TalkSession{Ped=target,Handle=target.Handle,Model=target.Model.Hash,Epoch=sceneEpoch,NpcId=NpcId(target),PlayerHealth=player.Health,NpcHealth=target.Health,IdleUntil=DateTime.UtcNow.AddSeconds(npcSettings.Number("conversation.timeoutSeconds"))};return true;}
        private bool SessionValid(Ped player)
        {return talkSession!=null&&talkSession.Epoch==sceneEpoch&&WorldDirector.Alive(player)&&WorldDirector.Alive(talkSession.Ped)&&talkSession.Ped.Handle==talkSession.Handle&&talkSession.Ped.Model.Hash==talkSession.Model&&!ScriptProtected(talkSession.Ped)&&talkSession.Ped.Position.DistanceTo(player.Position)<=npcSettings.Number("conversation.walkAwayMeters")&&SafeVehicle(talkSession.Ped,player);}
        private void EndTalkSession(string reason,bool show)
        {bool active=talkSession!=null;talkSession=null;CloseReplyWheel();CancelPtt(reason);CancelConversation(reason);if(active&&show)Caption(reason,3500);}
        private void OpenReplyWheel(Ped target,Ped player)
        {
            if(dialoguePending){Caption("The NPC is still responding.",2200);return;}if(!BeginTalkSession(target,player))return;
            CloseReplyWheel();replyWheel=true;replySelected=0;replySet=ReplySet.Fallback(DateTime.UtcNow);Observe(target);nextExchange=DateTime.MinValue;
            quickJob=new ActiveJob{Ped=target,Handle=target.Handle,Model=target.Model.Hash,Epoch=sceneEpoch,NpcId=NpcId(target),History=WorkingHistory.Snapshot(Memory(target,true).History),Deadline=DateTime.UtcNow.AddSeconds(12),RequiredFrame=sentFrame+1};
        }
        private void CloseReplyWheel(){replyWheel=false;replySet=null;replyKeys.ClearSafe();if(quickJob!=null&&quickJob.JobId!=null)CancelRemote(quickJob.JobId);quickJob=null;}
        private void TickConversationUI(Ped player,string pause)
        {
            bool unsafeScene=pause!=null&&pause!="Reply wheel open"&&pause!="Dialogue keyboard open";
            if(talkSession!=null&&(unsafeScene||!SessionValid(player)||DateTime.UtcNow>=talkSession.IdleUntil||npcSettings.Flag("conversation.interruptOnDanger")&&(player.IsInCombat||player.IsShooting||talkSession.Ped.IsInCombat||player.Health<talkSession.PlayerHealth||talkSession.Ped.Health<talkSession.NpcHealth))){EndTalkSession("Conversation ended: scene, danger, distance or timeout.",true);return;}
            if(talkSession!=null){talkSession.PlayerHealth=player.Health;talkSession.NpcHealth=talkSession.Ped.Health;}
            if(quickJob!=null){if(DateTime.UtcNow>=quickJob.Deadline){if(quickJob.JobId!=null)CancelRemote(quickJob.JobId);quickJob=null;Caption("Reply wheel is using local fallback options.",2500);}else if(!quickJob.Submitted&&registeredEpoch==sceneEpoch&&acceptedFrame>=quickJob.RequiredFrame){quickJob.Submitted=true;Send("api/ai/jobs",serializer.Serialize(new{requestId=quickJob.RequestId,runtimeId=runtimeId,sceneEpoch=sceneEpoch,kind="quickReplies",lane="A",npcIds=new[]{quickJob.NpcId},context=new{trigger="reply_wheel",history=quickJob.History}}),new Completion{Job=true,Kind="quickReplies",RequestId=quickJob.RequestId,Epoch=sceneEpoch});}}
            if(replyWheel){if(replySet==null||replySet.Expires<=DateTime.UtcNow){replySet=ReplySet.Fallback(DateTime.UtcNow);replySelected=0;}HandleReplyInput(player);if(replyWheel)DrawReplyWheel();return;}
            if(pause==null&&npcSettings.Flag("general.hints")){if(DateTime.UtcNow>=nextTargetHint){nextTargetHint=DateTime.UtcNow.AddMilliseconds(400);Ped target=PickTalkTarget(player);targetHint=target==null?null:new SeenNpc{Ped=target,Handle=target.Handle,Model=target.Model.Hash,At=DateTime.UtcNow};}if(targetHint!=null&&targetHint.Ped.Exists()&&targetHint.Ped.Model.Hash==targetHint.Model)Screen.ShowHelpTextThisFrame(input.TalkPrompt(npcSettings)+": "+SpeakerName(targetHint.Ped)+(talkSession!=null?" | "+(input.Controller?InputLabels.Button((int)npcSettings.Number("controls.controllerWheel"),npcSettings.Text("controls.promptStyle")=="playstation"):npcSettings.Text("controls.wheelKey"))+" replies":""));}
        }
        private void ReceiveQuickJob(Completion item)
        {if(item.Error!=null){if(quickJob!=null&&quickJob.RequestId==item.RequestId)quickJob=null;return;}string id=Wire.Text(Wire.Map(Wire.Value(item.Response,"job")),"id",128);if(quickJob==null||quickJob.RequestId!=item.RequestId||item.Epoch!=sceneEpoch){CancelRemote(id);return;}quickJob.JobId=id;}
        private void ConsumeQuickReplies(Dictionary<string,object> update,Dictionary<string,object> payload,Ped player)
        {if(!replyWheel||quickJob==null||quickJob.JobId!=Wire.Text(update,"jobId",128)||!SessionValid(player))return;if(Wire.Integer(payload,"expectedHandle",1,Int32.MaxValue)!=talkSession.Handle||Wire.Integer(payload,"expectedModelHash",Int32.MinValue,Int32.MaxValue)!=talkSession.Model)return;replySet=ReplySet.Parse(quickJob.JobId,Wire.Text(update,"source",80),payload,DateTime.UtcNow);quickJob=null;replySelected=0;}
        private static bool ReplyPressed(int control){return Game.IsControlJustPressed((Control)control)||Function.Call<bool>(Hash.IS_DISABLED_CONTROL_JUST_PRESSED,0,control);}
        private void HandleReplyInput(Ped player)
        {
            if(replySet==null)return;bool choose=false,cancel=false;Keys key;while(replyKeys.TryDequeue(out key)){if(key==Keys.Escape||key==Keys.Back)cancel=true;else if(key==Keys.Enter)choose=true;else if(key==Keys.Left||key==Keys.Up)replySelected=(replySelected+replySet.Options.Length-1)%replySet.Options.Length;else if(key==Keys.Right||key==Keys.Down)replySelected=(replySelected+1)%replySet.Options.Length;else if(key>=Keys.D1&&key<=Keys.D5){int index=key-Keys.D1;if(index<replySet.Options.Length){replySelected=index;choose=true;}}}
            if(Game.LastInputMethod==InputMethod.GamePad){double x=Game.GetDisabledControlValueNormalized((Control)195),y=Game.GetDisabledControlValueNormalized((Control)196);replySelected=RadialPolicy.Select(x,y,replySet.Options.Length,npcSettings.Number("controls.deadzone"),replySelected);if(ReplyPressed(174))replySelected=(replySelected+replySet.Options.Length-1)%replySet.Options.Length;if(ReplyPressed(175))replySelected=(replySelected+1)%replySet.Options.Length;choose|=ReplyPressed(201);cancel|=ReplyPressed(202);}
            else{Function.Call(Hash.SET_MOUSE_CURSOR_THIS_FRAME);double x=Game.GetDisabledControlValueNormalized((Control)239)*Screen.ScaledWidth-Screen.ScaledWidth/2,y=Game.GetDisabledControlValueNormalized((Control)240)*720-360;replySelected=RadialPolicy.Select(x,y,replySet.Options.Length,65,replySelected);choose|=ReplyPressed(237);cancel|=ReplyPressed(238);}
            foreach(int control in MenuControlMask.ForMenu(Game.LastInputMethod==InputMethod.GamePad,false))Game.DisableControlThisFrame((Control)control);
            if(cancel){EndTalkSession("Conversation dismissed.",true);return;}if(choose&&SessionValid(player)){ReplySet selected=replySet;ReplyOption option=selected.Options[replySelected];Ped target=talkSession.Ped;CloseReplyWheel();StartDialogue(target,player,option.Text,null);if(conversation!=null&&selected.JobId!=null){conversation.QuickJobId=selected.JobId;conversation.QuickOptionId=option.Id;}if(selected.JobId==null)Caption("Using local fallback reply text.",2000);}
        }
        private void DrawReplyWheel()
        {
            float center=Screen.ScaledWidth/2;DrawReplyBox(center-165,307,330,106,Color.FromArgb(230,14,20,27));DrawReplyText(SpeakerName(talkSession.Ped),center,319,.36f,300);DrawReplyText((quickJob!=null?"Preparing AI options • ":"")+replySet.Source,center,358,.23f,310);
            for(int i=0;i<replySet.Options.Length;i++){double angle=-Math.PI/2+i*2*Math.PI/replySet.Options.Length;float x=center+(float)Math.Cos(angle)*270,y=360+(float)Math.Sin(angle)*205;DrawReplyBox(x-135,y-47,270,94,i==replySelected?Color.FromArgb(240,44,95,110):Color.FromArgb(225,19,30,39));DrawReplyText((i+1)+". "+replySet.Options[i].Text,x,y-34,.27f,250);}
            DrawReplyText(input.Controller?"Stick / D-pad select • "+InputLabels.Button(223,npcSettings.Text("controls.promptStyle")=="playstation")+" send • "+InputLabels.Button(225,npcSettings.Text("controls.promptStyle")=="playstation")+" dismiss":"1–5 or arrows select • Enter / click sends • Escape dismisses",center,655,.25f,820);
        }
        private void DrawReplyBox(float x,float y,float w,float h,Color color){replyPanel.Position=new PointF(x,y);replyPanel.Size=new SizeF(w,h);replyPanel.Color=color;replyPanel.ScaledDraw();}
        private void DrawReplyText(string value,float x,float y,float scale,float width){replyText.Caption=ResponsePolicy.CleanText(value,240);replyText.Position=new PointF(x,y);replyText.Scale=scale;replyText.WrapWidth=width;replyText.ScaledDraw();}
    }
}
