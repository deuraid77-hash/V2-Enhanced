import type express from 'express';
import { AiError } from './ai-types.ts';
import { SettingsError } from './settings-store.ts';
import type { MenuAiService } from './ai-menu.ts';
export function installMenuAiRoutes(app: express.Express, service: MenuAiService) {
  const respond = (res: express.Response, run: () => unknown, status = 200) => {
    try { res.status(status).json({ success: true, ...run() as object }); }
    catch (error) { res.status(error instanceof AiError || error instanceof SettingsError ? error.status : 500).json({ success: false, code: error instanceof AiError ? error.code : 'menu_request_failed', error: error instanceof AiError || error instanceof SettingsError ? error.message : 'AI menu assistance could not complete this request.' }); }
  };
  let start = 0, count = 0;
  const limited: express.RequestHandler = (_req, res, next) => { const now = Date.now(); if (now - start >= 10000) { start = now; count = 0; } if (++count > 80) { res.status(429).setHeader('Retry-After', '10'); res.json({ success: false, code: 'menu_rate_limit', error: 'AI menu request limit reached.' }); return; } next(); };
  const bounded: express.RequestHandler = (req, res, next) => { if (Buffer.byteLength(JSON.stringify(req.body ?? {}), 'utf8') > 16384) { res.status(413).json({ success: false, code: 'menu_payload_size', error: 'AI menu input may contain at most 16 KiB.' }); return; } next(); };
  app.post('/api/ai/menu/jobs', limited, bounded, (req, res) => respond(res, () => ({ job: service.enqueue(req.body) }), 202));
  app.get('/api/ai/menu/jobs/:id', limited, (req, res) => respond(res, () => ({ job: service.job(req.params.id) })));
  app.delete('/api/ai/menu/jobs/:id', limited, (req, res) => respond(res, () => ({ job: service.cancel(req.params.id) })));
  app.post('/api/ai/advisor/proposals/:id/accept', limited, bounded, (req, res) => respond(res, () => service.accept(req.params.id, req.body)));
  app.post('/api/ai/advisor/proposals/:id/reject', limited, bounded, (req, res) => respond(res, () => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length) throw new AiError('invalid_request', 'Reject takes an empty JSON object.');
    return { proposal: service.reject(req.params.id) };
  }));
}
