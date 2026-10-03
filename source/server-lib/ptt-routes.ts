import type express from 'express';
import { AiError } from './ai-types.ts';
import { PttService } from './ptt.ts';
export function installPttRoutes(app:express.Express,service:PttService){
  const router = (awaitlessRouter());let start=0,count=0;
  router.use((req,res,next)=>{const address=req.socket.remoteAddress||'';if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address)){res.status(403).json({success:false,code:'loopback_only',error:'Push-to-talk is local only.'});return;}if(Date.now()-start>10000){start=Date.now();count=0;}if(++count>160){res.status(429).json({success:false,code:'rate_limit',error:'Push-to-talk request limit reached.'});return;}if(Buffer.byteLength(JSON.stringify(req.body??{}))>4096){res.status(413).json({success:false,code:'request_size',error:'Push-to-talk request is too large.'});return;}next();});
  const run=(fn:(req:express.Request)=>unknown,status=200):express.RequestHandler=>(req,res)=>{Promise.resolve().then(()=>fn(req)).then(value=>res.status(status).json(value)).catch(error=>res.status(error instanceof AiError?error.status:500).json({success:false,code:error instanceof AiError?error.code:'ptt_failed',error:error instanceof AiError?error.message:'Push-to-talk could not complete this request.'}));};
  router.get('/devices',run(()=>service.devices()));router.get('/status',run(()=>service.status()));router.post('/captures',run(req=>({success:true,capture:service.start(req.body)}),202));router.post('/captures/:id/lease',run(async req=>({success:true,capture:await service.lease(req.params.id,req.body)})));router.post('/captures/:id/stop',run(req=>({success:true,capture:service.stop(req.params.id,req.body)}),202));router.delete('/captures/:id',run(req=>({success:true,capture:service.cancel(req.params.id)})));router.get('/captures/:id/result',run(req=>service.result(req.params.id)));router.get('/captures/:id',run(req=>({success:true,capture:service.get(req.params.id)})));app.use('/api/ptt',router);
}
import expressRuntime from 'express';
function awaitlessRouter(){return expressRuntime.Router();}
