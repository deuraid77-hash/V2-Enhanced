using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Windows.Forms;
using GTA;
using GTA.Native;
using Control=GTA.Control;

namespace LivingLosSantosV2
{
    internal sealed class InputRouter
    {
        private readonly ConcurrentQueue<Keys> keys=new ConcurrentQueue<Keys>();
        private readonly Dictionary<string,HoldGate> holds=new Dictionary<string,HoldGate>();
        private readonly Stopwatch clock=Stopwatch.StartNew();
        public bool Controller;
        public void Queue(Keys key) { if(keys.Count<32) keys.Enqueue(key); }
        public string[] Poll(NpcSettingsState settings,bool keyboardOpen,bool canInteract,bool canMenu)
        {
            Controller=Game.LastInputMethod==InputMethod.GamePad;
            var actions=new List<string>(); Keys key; int budget=16;
            while(budget-->0&&keys.TryDequeue(out key)) {
                if(key.ToString()==settings.Text("controls.panicKey")) actions.Add("panic");
                else if(!keyboardOpen) {
                    if(canMenu&&key.ToString()==settings.Text("controls.menuKey")) actions.Add("menu");
                    else if(canInteract&&key.ToString()==settings.Text("controls.talkKey")) actions.Add("talk");
                    else if(canInteract&&key.ToString()==settings.Text("controls.wheelKey")) actions.Add("wheel");
                    else if(canInteract&&key==Keys.F8) actions.Add("director");
                }
            }
            foreach(string action in new[]{"Menu","Talk","Wheel","Panic"}) {
                HoldGate gate; if(!holds.TryGetValue(action,out gate)) holds[action]=gate=new HoldGate();
                int value=(int)settings.Number("controls.controller"+action);
                bool allowed=Controller&&(!keyboardOpen||action=="Panic")&&(action=="Panic"||action=="Menu"?action=="Panic"||canMenu:canInteract)&&Enum.IsDefined(typeof(Control),value);
                bool pressed=allowed&&Pressed(value);
                int modifier=(int)settings.Number("controls.menuModifier");
                if((action=="Menu"||action=="Panic")&&modifier>=0) pressed=pressed&&Enum.IsDefined(typeof(Control),modifier)&&Pressed(modifier);
                if(pressed&&(action=="Menu"||action=="Panic")){foreach(int alias in MenuControlMask.Aliases(value))Game.DisableControlThisFrame((Control)alias);foreach(int alias in MenuControlMask.Aliases(modifier))Game.DisableControlThisFrame((Control)alias);}
                if(gate.Poll(pressed,clock.ElapsedMilliseconds,(int)settings.Number("controls.holdMs"))) actions.Add(action.ToLowerInvariant());
            }
            if(!Controller&&!keyboardOpen){if(canMenu)MaskStockKey(settings.Text("controls.menuKey"));if(canInteract){MaskStockKey(settings.Text("controls.talkKey"));if(Game.IsKeyPressed(Keys.F8))Game.DisableControlThisFrame((Control)169);}}
            return actions.ToArray();
        }
        private static void MaskStockKey(string name){Keys key;if(!Enum.TryParse<Keys>(name,true,out key)||!Game.IsKeyPressed(key))return;if(key==Keys.F5)Game.DisableControlThisFrame((Control)166);else if(key==Keys.F6)Game.DisableControlThisFrame((Control)167);else if(key==Keys.F7)Game.DisableControlThisFrame((Control)168);}
        private static bool Pressed(int control){return Game.IsControlPressed((Control)control)||Function.Call<bool>(Hash.IS_DISABLED_CONTROL_PRESSED,0,control);}
        public string TalkPrompt(NpcSettingsState settings)
        { string style=settings.Text("controls.promptStyle"); bool pad=style=="xbox"||style=="playstation"||style=="auto"&&Controller; return pad?"Hold "+InputLabels.Button((int)settings.Number("controls.controllerTalk"),style=="playstation")+" to talk":settings.Text("controls.talkKey")+" to talk"; }
    }
}
