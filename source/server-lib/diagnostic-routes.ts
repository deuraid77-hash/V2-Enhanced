import type express from 'express';
import {writeDiagnosticReport,type createDiagnosticReport} from './diagnostics.ts';

/** Install after loopback/origin and JSON-object guards. No raw error text is
 * emitted; the one user-actionable limit message is a fixed application string. */
export function installDiagnosticRoutes(app:express.Express,directory:string,report:()=>ReturnType<typeof createDiagnosticReport>) {
  app.get('/api/diagnostics',(_req,res)=>{
    try {res.json({success:true,report:report()});}
    catch {res.status(503).json({success:false,code:'diagnostic_unavailable',error:'Sanitized diagnostics are temporarily unavailable.'});}
  });
  app.post('/api/diagnostics/export',(req,res)=>{
    if(req.body&&Object.keys(req.body).length){res.status(400).json({success:false,error:'Diagnostic export takes an empty JSON object.'});return;}
    try {res.json({success:true,...writeDiagnosticReport(directory,report())});}
    catch(error){
      const limit=error instanceof Error&&error.message==='Diagnostic export limit reached. Archive an older diagnostic report before exporting another.';
      res.status(limit?409:500).json({success:false,code:limit?'diagnostic_export_limit':'diagnostic_export_failed',error:limit?error.message:'Sanitized diagnostic report could not be saved.'});
    }
  });
}
