// Isolated portal acceptance fixture. This is never used by the game launcher.
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
process.env.PORT = '3103';
process.env.LLAI_DISABLE_GEMINI = 'true';
process.env.LLAI_NO_AUTOSTART = 'true';
process.env.LLAI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'llai-world-browser-qa-'));
process.env.NODE_ENV = 'production';
const { startServer } = await import('../server.ts');
const { DEFAULT_SETTINGS } = await import('../server-lib/world.ts');
const server = await startServer();
const base = 'http://127.0.0.1:3103';
const runtimeId = 'QA-FIXTURE-NOT-GTA-' + randomUUID();
let appliedRevision = 0;
let settings: Record<string, number | boolean> = { ...DEFAULT_SETTINGS };
let acknowledgements: any[] = [];
let events: any[] = [];
let weather = 'CLEAR', hour = 18, wantedLevel = 0;
const seen = new Set<string>();
const territories = [
  ['grove','Grove Street','Ballas',105,-1940,20], ['forum','Forum Drive','Families',-150,-1620,33],
  ['rancho','Rancho','Vagos',480,-1880,26], ['chamberlain','Chamberlain Hills','Families',-210,-1490,31],
  ['davis','Davis','Ballas',100,-1700,29], ['cypress','Cypress Flats','Vagos',850,-2100,30],
].map(([id,name,owner,x,y,z])=>({id,name,owner,challenger:null,heat:25,position:{x,y,z},radius:180,wins:0}));
let busy = false;
async function exchange() {
  if (busy) return; busy=true;
  try {
    const frame = { protocol:3, runtimeId, pluginVersion:'3.0.0 QA FIXTURE',gameVersion:'QA fixture - no game',appliedRevision,
      player:{wantedLevel,weaponDrawn:false,position:{x:100,y:-1940,z:20}},
      environment:{weather,timeOfDay:`${hour}:00`,district:'Grove Street (QA fixture)',nearbyGunfire:false},
      npcs:[{id:`${runtimeId}:1`,name:'QA pedestrian',faction:'Ballas',health:100,alive:true,inCombat:false,modelHash:1,owned:false,position:{x:102,y:-1940,z:20},memory:'QA memory; no game data.'}],
      director:{enabled:settings.enabled,pausedReason:null,settings,activeEvents:[],territories,ownedPedCount:0},acknowledgements,events };
    const response = await fetch(base+'/api/runtime/exchange',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(frame)});
    if(!response.ok) throw new Error(`Fixture exchange HTTP ${response.status}: ${await response.text()}`);
    const result=await response.json();
    settings=result.config.settings; appliedRevision=result.config.revision;
    acknowledgements=[];events=[];
    for(const command of result.commands){
      if(seen.has(command.id)) continue; seen.add(command.id);
      if(command.type==='set_weather') weather=command.payload.weather;
      if(command.type==='set_time') hour=command.payload.hour;
      if(command.type==='set_wanted') wantedLevel=command.payload.level;
      const rejected=command.type==='start_turf_war';
      acknowledgements.push({id:command.id,status:rejected?'rejected':'applied',message:rejected?'QA rejection: no live game exists in this fixture.':'QA fixture acknowledged this command. No GTA action occurred.'});
      events.push({id:randomUUID(),at:new Date().toISOString(),type:'qa_fixture',message:`QA fixture received ${command.type}. No GTA action occurred.`});
    }
  } catch(error) { console.error(error); } finally { busy=false; }
}
const timer=setInterval(exchange,1000);
console.log('ISOLATED QA FIXTURE: port 3103; credentials disabled; no actual game connection.');
process.on('SIGINT',()=>{clearInterval(timer);server.close(()=>process.exit(0));});
