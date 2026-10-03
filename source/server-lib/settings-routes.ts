import type express from 'express';
import { DEFAULT_NPC_SETTINGS, SETTINGS_CATALOG } from '../shared/settings.ts';
import {WORLD_MENU_CATALOG} from '../shared/world-settings.ts';
import { SettingsError, SettingsStore, type SettingsSource } from './settings-store.ts';

/** Mounted after the common loopback/origin/JSON guards. */
export function installSettingsRoutes(app: express.Express, store: SettingsStore) {
  const reply = (res: express.Response, work:()=>unknown) => {try {res.json({success:true,...work() as object});} catch(error){res.status(error instanceof SettingsError?error.status:400).json({success:false,error:error instanceof Error?error.message:'Settings validation failed.'});}};
  let windowStart=Date.now(),writes=0;
  const bound: express.RequestHandler = (req,res,next)=>{
    if(Date.now()-windowStart>=10000){windowStart=Date.now();writes=0;}
    if(++writes>60){res.status(429).set('Retry-After','10').json({success:false,error:'Too many settings changes. Allow pending edits to settle before retrying.'});return;}
    if(Buffer.byteLength(JSON.stringify(req.body??{}))>256*1024){res.status(413).json({success:false,error:'Settings request exceeds 256 KiB.'});return;}next();
  };
  app.get('/api/settings',(req,res)=>res.json({success:true,...store.snapshot(),...(req.query.catalog==='false'?{}:{catalog:SETTINGS_CATALOG,worldCatalog:WORLD_MENU_CATALOG}),recovery:store.recovery}));
  app.patch('/api/settings',bound,(req,res)=>reply(res,()=>{
    if(Object.keys(req.body).some(k=>!['settings','source','expectedRevision'].includes(k))) throw new SettingsError('Unsupported settings request field.');
    if(!['portal','game','advisor'].includes(req.body.source)) throw new SettingsError('Settings source must be portal, game or advisor.');
    return store.configure(req.body.settings,req.body.source as SettingsSource,req.body.expectedRevision);
  }));
  app.post('/api/settings/reset',bound,(req,res)=>reply(res,()=>store.configure({...DEFAULT_NPC_SETTINGS},'defaults',req.body.expectedRevision)));
  app.get('/api/profiles',(_req,res)=>{const current=store.snapshot();res.json({success:true,profiles:store.listProfiles(),revision:current.revision,worldRevision:current.world.revision});});
  app.post('/api/profiles',bound,(req,res)=>reply(res,()=>({profiles:store.saveProfile(req.body.name,req.body.settings,req.body.worldSettings)})));
  app.patch('/api/profiles/:name',bound,(req,res)=>reply(res,()=>({profiles:store.renameProfile(req.params.name,req.body.name)})));
  app.delete('/api/profiles/:name',bound,(req,res)=>reply(res,()=>({profiles:store.deleteProfile(req.params.name)})));
  app.post('/api/profiles/:name/apply',bound,(req,res)=>reply(res,()=>store.applyProfile(req.params.name,req.body.expectedRevision,req.body.expectedWorldRevision)));
  app.get('/api/profiles/:name/export',(req,res)=>reply(res,()=>({profile:store.exportProfile(req.params.name)})));
  app.post('/api/profiles/import',bound,(req,res)=>reply(res,()=>({profiles:store.importProfile(req.body.profile)})));
}
