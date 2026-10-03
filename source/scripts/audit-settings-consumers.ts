// Read-only source inventory. A reference is not proof that a setting changes gameplay.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {NPC_ACTIONS, SETTINGS_CATALOG} from '../shared/settings.ts';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ignore=new Set(['node_modules','build','bin','obj','vendor','dist','reference']);
function files(directory:string):string[]{
  if(!fs.existsSync(directory))return [];
  return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
    const full=path.join(directory,entry.name);
    if(entry.isDirectory())return ignore.has(entry.name)?[]:files(full);
    return /\.(?:ts|tsx|cs)$/.test(entry.name)&&!entry.name.endsWith('.Generated.cs')?[full]:[];
  });
}
const runtime=[...['server-lib','game-client','src'].flatMap(dir=>files(path.join(root,dir))),path.join(root,'server.ts')]
  .filter(file=>!/(?:Tests?|Probe)\.cs$/.test(file));
const tests=[...files(path.join(root,'test')),...files(path.join(root,'game-client')).filter(file=>/(?:Tests?|Probe)\.cs$/.test(file))];
const load=(paths:string[])=>paths.map(file=>({file:path.relative(root,file).replaceAll('\\','/'),lines:fs.readFileSync(file,'utf8').split(/\r?\n/)}));
const source=load(runtime),fixtures=load(tests);
const occurrences=(items:ReturnType<typeof load>,key:string)=>items.flatMap(({file,lines})=>lines.flatMap((line,index)=>line.includes(`'${key}'`)||line.includes(`"${key}"`)?[{file,line:index+1}]:[]));
const actionConsumers=source.flatMap(({file,lines})=>lines.flatMap((line,index)=>
  /(?:Flag|settingBoolean)\([^\n]*["'`]action\.["'`]?\s*(?:\+|\$\{)/.test(line)?[{file,line:index+1}]:[]));
const rows=SETTINGS_CATALOG.map(setting=>{
  const direct=occurrences(source,setting.key);
  const dynamic=setting.key.startsWith('action.')&&(NPC_ACTIONS as readonly string[]).includes(setting.key.slice(7))?actionConsumers:[];
  return {key:setting.key,owner:setting.consumer,runtimeReferences:direct,dynamicActionReferences:dynamic,testReferences:occurrences(fixtures,setting.key),
    evidence:direct.length||dynamic.length?'source reference located; behavior review required':'no literal runtime reference located; inspect dynamic consumers or implement',
    behaviorVerified:false,nativeGameplayVerified:false};
});
const report={classification:'VERIFIED source inventory only; not behavior or gameplay coverage',at:new Date().toISOString(),
  note:'Catalog rendering, validation, profiles, generic control wiring and test mentions do not establish a gameplay effect. The 14 separate world settings are outside this NPC catalog report.',
  catalogSize:rows.length,withRuntimeReferences:rows.filter(row=>row.runtimeReferences.length||row.dynamicActionReferences.length).length,
  missingLiteralRuntimeReferences:rows.filter(row=>!row.runtimeReferences.length&&!row.dynamicActionReferences.length).map(row=>row.key),rows};
const output=path.resolve(root,'../verification/npc-overhaul/settings-source-inventory.json');
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({output,catalogSize:report.catalogSize,withRuntimeReferences:report.withRuntimeReferences,missingLiteralRuntimeReferences:report.missingLiteralRuntimeReferences},null,2));
