import type express from 'express';
import { AiError, boundedInteger, onlyKeys, record } from './ai-types.ts';
import type { MemoryStore } from './memory-store.ts';
import { memoryText, memoryUuid } from './memory-types.ts';
export function installMemoryRoutes(app:express.Express,store:MemoryStore){
  let start=0,count=0;const limit:express.RequestHandler=(_req,res,next)=>{if(Date.now()-start>10000){start=Date.now();count=0;}if(++count>80){res.status(429).setHeader('Retry-After','10');res.json({success:false,code:'memory_rate_limit',error:'Memory request limit reached.'});return;}next();};
  const run=(res:express.Response,fn:()=>unknown)=>{try{const result=fn();if(Buffer.byteLength(JSON.stringify(result))>65536)throw new AiError('memory_response_size','Reduce the requested memory page size.',413);res.json(result);}catch(error){res.status(error instanceof AiError?error.status:500).json({success:false,code:error instanceof AiError?error.code:'memory_failed',error:error instanceof AiError?error.message:'Memory operation failed.'});}};
  app.get('/api/memory/all',limit,(req,res)=>run(res,()=>store.list(boundedInteger(Number(req.query.offset??0),0,500,'offset'),boundedInteger(Number(req.query.limit??25),1,25,'limit'))));
  app.get('/api/memory/npcs/:id',limit,(req,res)=>run(res,()=>store.detail(memoryUuid(req.params.id))));
  app.get('/api/memory/reputation',limit,(_req,res)=>run(res,()=>store.reputationView()));
  app.post('/api/memory/reset',limit,(req,res)=>run(res,()=>{if(Buffer.byteLength(JSON.stringify(req.body??{}))>2048)throw new AiError('invalid_memory','Memory reset request is too large.',413);const b=record(req.body,'memory reset');onlyKeys(b,['scope','id','expectedRevision'],'memory reset');if(!['all','npc','faction'].includes(String(b.scope)))throw new AiError('invalid_memory','Invalid reset scope.');const scope=b.scope as 'all'|'npc'|'faction',id=scope==='all'?undefined:scope==='npc'?memoryUuid(b.id):memoryText(b.id,64,'faction');return store.reset(scope,id,boundedInteger(b.expectedRevision,1,2147483647,'expectedRevision'));}));
  for(const [method,route]of [['post','/api/memory/record'],['delete','/api/memory/clear']]as const)app[method](route,limit,(_req,res)=>res.status(410).json({success:false,code:'legacy_memory_retired',error:'Browser-created incident insertion was retired. Use observed protocol 4 memory and the scoped reset controls.'}));
}
