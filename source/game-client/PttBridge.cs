using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using GTA;
using GTA.Native;
using Screen=GTA.UI.Screen;
using Control=GTA.Control;

namespace LivingLosSantosV2
{
    public sealed partial class EnhancedClient
    {
        private readonly HeldCaptureGate pttGate=new HeldCaptureGate();
        private string pttId,pttEpoch,pttNpcId,pttState="idle",pttBinding;
        private int pttGeneration,pttSequence;private bool pttBusy,pttPollPending,pttLeasePending,pttStartPending;
        private DateTime pttNextLease=DateTime.MinValue,pttNextPoll=DateTime.MinValue,pttLastLease=DateTime.MinValue;
        private void PttRequest(string method,string route,object body,Action<Dictionary<string,object>,string> done)
        {
            string packet=body==null?null:serializer.Serialize(body);
            Task.Run(async delegate{Dictionary<string,object> data=null;string error=null;try{using(var independent=new DashboardTransport("http://127.0.0.1:3000/")){data=await independent.MenuAsync(method,route,packet,CancellationToken.None).ConfigureAwait(false);if(stopping&&method=="POST"&&route=="api/ptt/captures"){string id=Wire.Text(Wire.Map(Wire.Value(data,"capture")),"id",128);await independent.MenuAsync("DELETE","api/ptt/captures/"+id,null,CancellationToken.None).ConfigureAwait(false);}}}catch(InvalidOperationException ex){error=ResponsePolicy.CleanText(ex.Message,180);}catch(Exception){error="Push-to-talk companion unavailable.";}if(!stopping)menuReplies.Enqueue(new MenuReply{Request=new MenuRequest{Done=done},Data=data,Error=error,Counted=false});});
        }
        private void TickPtt(Ped player,string pause)
        {
            bool controller=Game.LastInputMethod==InputMethod.GamePad;Keys key;bool keyValid=Enum.TryParse<Keys>(npcSettings.Text("controls.pttKey"),true,out key);int button=(int)npcSettings.Number("controls.controllerPtt");
            bool held=controller?(Game.IsControlPressed((Control)button)||Function.Call<bool>(Hash.IS_DISABLED_CONTROL_PRESSED,0,button)):keyValid&&Game.IsKeyPressed(key);
            string binding=(controller?"pad:"+button:"key:"+key)+":"+npcSettings.Text("voice.micDeviceId");
            bool allowed=pause==null&&npcSettings.Flag("conversation.pushToTalk")&&SessionValid(player)&&!dialoguePending&&!replyWheel&&keyboardTarget==null&&!nativeMenu.IsOpen&&(!pttBusy||pttState=="starting"||pttState=="capturing");
            if(pttBusy&&(pttBinding!=binding||pttEpoch!=sceneEpoch||talkSession==null||pttNpcId!=talkSession.NpcId)){CancelPtt("Push-to-talk input or target changed.");allowed=false;}
            string edge=pttGate.Poll(held,allowed,DateTime.UtcNow,(int)npcSettings.Number("voice.micMaxSeconds"));
            if(edge=="start"&&!pttBusy)StartPtt(binding);
            else if(edge=="cancel")CancelPtt("Push-to-talk cancelled by scene or duration limit.");
            else if(edge=="release"&&pttBusy){if(pttState=="capturing"&&pttId!=null)StopPtt();else CancelPtt("Microphone was not ready before release.");}
            if(pttBusy&&pttId!=null&&(pttState=="starting"||pttState=="capturing")&&held){if(controller)foreach(int alias in MenuControlMask.Aliases(button))Game.DisableControlThisFrame((Control)alias);if(DateTime.UtcNow-pttLastLease>TimeSpan.FromMilliseconds(900)){CancelPtt("Push-to-talk held lease expired.");return;}if(DateTime.UtcNow>=pttNextLease&&!pttLeasePending){pttLeasePending=true;pttNextLease=DateTime.UtcNow.AddMilliseconds(250);string id=pttId;int generation=pttGeneration;PttRequest("POST","api/ptt/captures/"+id+"/lease",new{sequence=++pttSequence,held=true},(r,e)=>{pttLeasePending=false;if(generation!=pttGeneration||id!=pttId)return;if(e!=null){CancelPtt("Microphone hold renewal failed.");return;}pttLastLease=DateTime.UtcNow;});}}
            if(pttBusy&&pttState!="fetching"&&!pttPollPending&&pttId!=null&&DateTime.UtcNow>=pttNextPoll){pttPollPending=true;pttNextPoll=DateTime.UtcNow.AddMilliseconds(350);int generation=pttGeneration;string id=pttId;PttRequest("GET","api/ptt/captures/"+id,null,(r,e)=>{pttPollPending=false;if(generation!=pttGeneration||id!=pttId)return;if(e!=null){CancelPtt("Microphone status unavailable.");return;}var capture=Wire.Map(Wire.Value(r,"capture"));string state=Wire.Text(capture,"state",32);if(state=="capturing"){if(pttState=="starting")pttLastLease=DateTime.UtcNow;pttState=state;}else if(state=="ready"){pttState="fetching";ReadPttResult(id,generation);}else if(state=="failed"||state=="cancelled"){CancelPtt("Microphone capture "+state+".");}else if(pttState!="fetching")pttState=state;});}
            if(pttBusy)Screen.ShowHelpTextThisFrame(pttState=="capturing"?"MIC LIVE • hold "+(controller?InputLabels.Button(button,npcSettings.Text("controls.promptStyle")=="playstation"):npcSettings.Text("controls.pttKey"))+" • release to send":"Voice: "+pttState+" • no ambient listening");
        }
        private void StartPtt(string binding)
        {
            if(pttStartPending||talkSession==null)return;pttBusy=true;pttStartPending=true;pttState="starting";pttBinding=binding;pttEpoch=sceneEpoch;pttNpcId=talkSession.NpcId;pttSequence=0;pttGeneration++;int generation=pttGeneration;
            var body=new{requestId=Guid.NewGuid().ToString(),runtimeId=runtimeId,sceneEpoch=sceneEpoch,npcId=talkSession.NpcId,expectedHandle=talkSession.Handle,expectedModelHash=talkSession.Model};
            PttRequest("POST","api/ptt/captures",body,(r,e)=>{pttStartPending=false;if(e!=null){if(generation==pttGeneration)CancelPtt(e);return;}var capture=Wire.Map(Wire.Value(r,"capture"));string id=Wire.Text(capture,"id",128);if(generation!=pttGeneration||!pttBusy){PttRequest("DELETE","api/ptt/captures/"+id,null,(a,b)=>{});return;}pttId=id;pttState=Wire.Text(capture,"state",32);pttLastLease=DateTime.UtcNow;pttNextLease=DateTime.MinValue;pttNextPoll=DateTime.MinValue;});
        }
        private void StopPtt()
        {string id=pttId;int generation=pttGeneration;pttState="stopping";PttRequest("POST","api/ptt/captures/"+id+"/stop",new{requestId=Guid.NewGuid().ToString()},(r,e)=>{if(generation!=pttGeneration)return;if(e!=null){CancelPtt("Microphone clip could not be committed.");return;}pttState=Wire.Text(Wire.Map(Wire.Value(r,"capture")),"state",32);});}
        private void ReadPttResult(string id,int generation)
        {PttRequest("GET","api/ptt/captures/"+id+"/result",null,(r,e)=>{if(generation!=pttGeneration||id!=pttId)return;if(e!=null){CancelPtt("Transcription result unavailable.");return;}Ped player=Game.Player.Character;if(!SessionValid(player)||EffectivePause(player)!=null||talkSession.NpcId!=pttNpcId){CancelPtt("Transcription target changed.");return;}string text=ResponsePolicy.CleanText(Wire.Text(r,"text",2000),600),request=Wire.Text(r,"conversationRequestId",128);pttBusy=false;pttId=null;pttState="idle";pttGate.Cancel();if(text.Length==0)return;StartDialogue(talkSession.Ped,player,text,null);if(conversation!=null)conversation.RequestId=request;});}
        private void CancelPtt(string reason)
        {bool active=pttBusy;string id=pttId;pttGeneration++;pttGate.Cancel();pttId=null;pttBusy=false;pttState="idle";pttPollPending=pttLeasePending=false;if(id!=null)PttRequest("DELETE","api/ptt/captures/"+id,null,(r,e)=>{});if(active&&!stopping)Caption(ResponsePolicy.CleanText(reason,180),3500);}
    }
}

