using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace LivingLosSantosV2
{
    public sealed class MenuLayout
    {
        public float X,Y,Width,Height,RowHeight,HeaderHeight,FooterHeight,Scale;
        public int VisibleRows;
        public static MenuLayout Compute(float viewportWidth,float safeZone,float scale,float x,float y)
        {
            if(!Finite(viewportWidth)||viewportWidth<720||!Finite(safeZone)||!Finite(scale)||!Finite(x)||!Finite(y)) throw new InvalidOperationException("Invalid menu viewport.");
            scale=Math.Max(.7f,Math.Min(1.5f,scale)); safeZone=Math.Max(.8f,Math.Min(1,safeZone));
            float mx=(1-safeZone)*viewportWidth/2+12,my=(1-safeZone)*720/2+12;
            var p=new MenuLayout{Scale=scale,Width=Math.Min(610*scale,viewportWidth-2*mx),HeaderHeight=85*scale,FooterHeight=120*scale,RowHeight=31*scale};
            p.VisibleRows=Math.Max(3,Math.Min(12,(int)((720-2*my-p.HeaderHeight-p.FooterHeight)/p.RowHeight)));
            p.Height=p.HeaderHeight+p.FooterHeight+p.VisibleRows*p.RowHeight;
            p.X=Math.Max(mx,Math.Min(viewportWidth-mx-p.Width,x*viewportWidth)); p.Y=Math.Max(my,Math.Min(720-my-p.Height,y*720)); return p;
        }
        public int RowAt(float x,float y,int scroll,int count)
        { if(x<X||x>X+Width||y<Y+HeaderHeight||y>=Y+HeaderHeight+VisibleRows*RowHeight) return -1; int result=scroll+(int)((y-Y-HeaderHeight)/RowHeight); return result<count?result:-1; }
        private static bool Finite(float v) {return !Single.IsNaN(v)&&!Single.IsInfinity(v);}
    }
    public sealed class MenuNavigation
    {
        public bool Open, Capturing; public string Page="home", CaptureKey; public int Selected,Scroll;
        private readonly Stack<string> trail=new Stack<string>();
        public string Breadcrumb {get{return "Living Los Santos / "+Page.Replace("group:","").Replace("profile:","Profile / ");}}
        public void Show() {Open=true;}
        public void Close() {Open=false;Capturing=false;CaptureKey=null;Selected=Scroll=0;Page="home";trail.Clear();}
        public void Enter(string page) {trail.Push(Page);Page=page;Selected=Scroll=0;Capturing=false;}
        public void Back() {if(Capturing){Capturing=false;CaptureKey=null;return;} if(trail.Count==0){Close();return;}Page=trail.Pop();Selected=Scroll=0;}
        public void Move(int delta,int count,int visible) {if(count<1){Selected=Scroll=0;return;}Selected=(Selected+delta+count)%count;Fit(count,visible);}
        public void Fit(int count,int visible) {Selected=Math.Max(0,Math.Min(Math.Max(0,count-1),Selected));Scroll=Math.Max(0,Math.Min(Scroll,Selected));if(Selected>=Scroll+visible)Scroll=Selected-visible+1;}
    }
    public sealed class VirtualKeyboard
    {
        public const string Characters="abcdefghijklmnopqrstuvwxyz0123456789 .,_-!?/@():;+=\"'";
        public readonly int Limit; public string Value;public bool Upper;public int Selected,FirstRow;
        public int Count {get{return Characters.Length+5;}}
        public VirtualKeyboard(string initial,int limit){Limit=Math.Max(1,Math.Min(600,limit));Value=ResponsePolicy.CleanText(initial,Limit);}
        public string Label(int index){if(index<Characters.Length){char c=Characters[index];return c==' '?"Space":(Upper?Char.ToUpperInvariant(c):c).ToString();}return new[]{"Delete","Caps","Clear","Done","Cancel"}[index-Characters.Length];}
        public void Move(int x,int y){int next=Selected+x+y*10;Selected=Math.Max(0,Math.Min(Count-1,next));}
        public void Fit(int visibleRows){visibleRows=Math.Max(1,visibleRows);int row=Selected/10;if(row<FirstRow)FirstRow=row;if(row>=FirstRow+visibleRows)FirstRow=row-visibleRows+1;FirstRow=Math.Max(0,Math.Min(FirstRow,Math.Max(0,(Count+9)/10-visibleRows)));}
        public string Select(){if(Selected<Characters.Length){if(Value.Length<Limit){char c=Characters[Selected];Value+=Upper?Char.ToUpperInvariant(c):c;}return null;}int action=Selected-Characters.Length;if(action==0){if(Value.Length>0)Value=Value.Substring(0,Value.Length-1);}else if(action==1)Upper=!Upper;else if(action==2)Value="";else if(action==3)return "done";else return "cancel";return null;}
    }
    public sealed class DraftRevision
    {
        public int Value=-1;
        public void Begin(int revision){if(Value<0)Value=revision;}
        public void Rebase(int revision){Value=revision;}
        public void Submitted(int revision,bool stillPending){Value=stillPending?revision:-1;}
        public void Clear(){Value=-1;}
    }
    public static class MenuRules
    {
        public static object Step(SettingDefinition spec,object current,int direction)
        {
            if(spec.Kind=="boolean")return !(bool)current;
            if(spec.Kind=="number")return Math.Round(Math.Max(spec.Min,Math.Min(spec.Max,NpcMind.Number(current)+direction*spec.Step)),4);
            if(spec.Options.Length>0){int i=Array.IndexOf(spec.Options,Convert.ToString(current,CultureInfo.InvariantCulture));return spec.Options[(i+direction+spec.Options.Length)%spec.Options.Length];}
            throw new InvalidOperationException("This value uses text input.");
        }
        public static string BindingConflict(string key,object value,Dictionary<string,object> settings)
        {
            foreach(var entry in settings) if(entry.Key!=key&&entry.Key.StartsWith("controls.",StringComparison.Ordinal)&&((key.EndsWith("Key",StringComparison.Ordinal)&&entry.Key.EndsWith("Key",StringComparison.Ordinal))||((key.Contains("controller")||key.EndsWith("menuModifier",StringComparison.Ordinal))&&(entry.Key.Contains("controller")||entry.Key.EndsWith("menuModifier",StringComparison.Ordinal))))) {
                bool equal=key.EndsWith("Key",StringComparison.Ordinal)?String.Equals(Convert.ToString(value),Convert.ToString(entry.Value),StringComparison.OrdinalIgnoreCase):Physical((int)NpcMind.Number(value))==Physical((int)NpcMind.Number(entry.Value));
                if(equal)return "Already bound to "+entry.Key+". Choose a different button.";
            }
            return null;
        }
        public static string Physical(int control) {return InputLabels.Button(control,false);}
        public static string Display(object value) {return value is bool?((bool)value?"On":"Off"):value is double?((double)value).ToString("0.##",CultureInfo.InvariantCulture):Convert.ToString(value,CultureInfo.InvariantCulture);}
        public static string Clip(string text,int max) {text=ResponsePolicy.CleanText(text,max+1);return text.Length>max?text.Substring(0,max-1)+"…":text;}
        public static Dictionary<string,object> Clone(Dictionary<string,object> value) {return new Dictionary<string,object>(value);}
        public static void RemoveSubmitted(Dictionary<string,object> pending,Dictionary<string,object> submitted)
        {foreach(var pair in submitted){object current;if(pending.TryGetValue(pair.Key,out current)&&Equals(current,pair.Value))pending.Remove(pair.Key);}}
        public static void FinishSubmission(Dictionary<string,object> pending,Dictionary<string,object> submitted,bool succeeded){if(succeeded)RemoveSubmitted(pending,submitted);}
        public static int ConfigRevision(Dictionary<string,object> response,bool world){return Wire.Integer(world?Wire.Map(Wire.Value(response,"config")):response,"revision",0,Int32.MaxValue);}
        public static Dictionary<string,object> AdvisorBundle(Dictionary<string,object> response){var result=Clone(Wire.Map(Wire.Value(response,"npcSettings")));result["world"]=Wire.Map(Wire.Value(response,"worldConfig"));return result;}
    }
    public static class MenuControlMask
    {
        // GTA assigns several context-specific control IDs to each physical button.
        public static int[] Aliases(int control)
        {
            switch(control){
                case 236:return new[]{0,217,236,244};
                case 227:return new[]{44,55,69,76,90,102,118,153,206,227};
                case 226:return new[]{37,38,68,89,117,152,205,226};
                case 231:return new[]{7,26,29,50,79,93,121,184,210,231};
                case 230:return new[]{28,36,86,113,185,209,230};
                case 51:case 235:return new[]{14,46,51,54,74,101,103,104,119,175,190,235};
                case 52:case 234:return new[]{15,47,52,58,85,115,174,189,234};
                case 232:return new[]{27,42,172,188,232};case 233:return new[]{19,20,43,48,173,187,233};
                case 223:return new[]{18,21,70,73,114,136,141,176,191,201,223};
                case 225:return new[]{45,80,140,170,177,194,202,225};
                case 224:return new[]{22,99,105,120,143,154,179,193,203,224};
                case 222:return new[]{23,49,53,75,144,145,178,192,204,222};
                case 228:return new[]{25,72,77,88,91,137,228};case 229:return new[]{24,71,78,87,92,138,142,229};
                default:return new[]{control};
            }
        }
        public static int[] ForMenu(bool controller,bool capturing)
        {
            if(controller){var buttons=capturing?Enumerable.Range(222,15):new[]{232,233,234,235,223,225,224};return buttons.SelectMany(Aliases).Concat(new[]{30,31,59,60,195,196}).Distinct().ToArray();}
            return new[]{1,2,16,17,18,24,25,27,68,69,91,92,172,173,174,175,176,177,187,188,189,190,191,194,201,202,237,238,241,242};
        }
    }
    public sealed class ProfileFiles
    {
        private readonly string root;
        public ProfileFiles(string directory) {root=Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;}
        private string SafePath(string name)
        {
            if(name==null||!Regex.IsMatch(name,@"^[\p{L}\p{N}][\p{L}\p{N} _-]{0,39}$")||Regex.IsMatch(name,@"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$",RegexOptions.IgnoreCase))throw new InvalidOperationException("Invalid local profile filename.");
            string file=Path.GetFullPath(Path.Combine(root,name+".json"));if(!file.StartsWith(root,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("Profile path left its export folder.");
            if(Directory.Exists(root)&&(File.GetAttributes(root)&FileAttributes.ReparsePoint)!=0)throw new InvalidOperationException("Profile folder must not be a link.");
            if(File.Exists(file)&&(File.GetAttributes(file)&FileAttributes.ReparsePoint)!=0)throw new InvalidOperationException("Profile file must not be a link.");return file;
        }
        public string[] List() {if(!Directory.Exists(root))return new string[0];if((File.GetAttributes(root)&FileAttributes.ReparsePoint)!=0)throw new InvalidOperationException("Profile folder must not be a link.");return Directory.GetFiles(root,"*.json").Where(f=>new FileInfo(f).Length<=131072).Select(Path.GetFileNameWithoutExtension).Take(32).ToArray();}
        public Dictionary<string,object> Read(string name) {string file=SafePath(name);if(new FileInfo(file).Length>131072)throw new InvalidOperationException("Profile import exceeds128KiB.");return Wire.Map(new JavaScriptSerializer{MaxJsonLength=131072,RecursionLimit=16}.DeserializeObject(File.ReadAllText(file)));}
        public string Write(string name,Dictionary<string,object> profile)
        {string file=SafePath(name),json=new JavaScriptSerializer{MaxJsonLength=131072,RecursionLimit=16}.Serialize(profile);if(System.Text.Encoding.UTF8.GetByteCount(json)>131072)throw new InvalidOperationException("Profile export exceeds128KiB.");Directory.CreateDirectory(root);string temp=file+"."+Guid.NewGuid().ToString("N")+".tmp";try{File.WriteAllText(temp,json);if(File.Exists(file))File.Replace(temp,file,file+".bak");else File.Move(temp,file);}finally{if(File.Exists(temp))File.Delete(temp);}return file;}
    }
    internal sealed class MenuRequest
    {
        public string Method {get;set;} public string Route {get;set;} public Dictionary<string,object> Body {get;set;}
        public Func<Dictionary<string,object>> LocalWork {get;set;}
        public Action<Dictionary<string,object>,string> Done {get;set;}
    }
}
