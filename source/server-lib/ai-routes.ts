import type express from 'express';
import { AiService, validateAiFrame } from './ai-service.ts';
import { AiError } from './ai-types.ts';
import type { WorldState } from './world.ts';
import { WorldError } from './world.ts';
import type { SettingsStore } from './settings-store.ts';
export function installAiRoutes(app: express.Express, service: AiService, world: WorldState, settings: SettingsStore, onTelemetry: (input: Record<string, unknown>) => void, menuStatus?: () => unknown) {
  function fail(res: express.Response, error: unknown) {
    res.status(error instanceof AiError || error instanceof WorldError ? error.status : 500).json({ success: false, code: error instanceof AiError ? error.code : 'ai_request_failed', error: error instanceof AiError || error instanceof WorldError ? error.message : 'The AI request could not be completed.' });
  }
  const bounded: express.RequestHandler = (req, res, next) => { if (Buffer.byteLength(JSON.stringify(req.body ?? {}), 'utf8') > 128 * 1024) { res.status(413).json({ success: false, code: 'frame_size', error: 'AI requests may contain at most 128 KiB.' }); return; } next(); };
  let windowStart = 0, requests = 0;
  const limited: express.RequestHandler = (_req, res, next) => { const now = Date.now(); if (now - windowStart > 10000) { windowStart = now; requests = 0; } if (++requests > 100) { res.setHeader('Retry-After', '10'); res.status(429).json({ success: false, code: 'rate_limit', error: 'AI route request limit reached.' }); return; } next(); };
  app.get('/api/ai/status', limited, (_req, res) => { try { res.json({ ...service.status(), ...(menuStatus ? { menu: menuStatus() } : {}) }); } catch (error) { fail(res, error); } });
  app.post('/api/ai/jobs', limited, bounded, (req, res) => { try { res.status(202).json({ success: true, job: service.enqueue(req.body) }); } catch (error) { fail(res, error); } });
  app.get('/api/ai/jobs/:id', limited, (req, res) => { try { res.json({ success: true, job: service.job(req.params.id) }); } catch (error) { fail(res, error); } });
  app.delete('/api/ai/jobs/:id', limited, (req, res) => { try { res.json({ success: true, job: service.cancel(req.params.id) }); } catch (error) { fail(res, error); } });
  // The v3 route remains exactly as before. Only a fully validated v4 request
  // enters this adapter, and its common world fields still pass the v3 validator.
  app.post('/api/runtime/exchange', limited, bounded, (req, res, next) => {
    if (req.body.protocol !== 4) { next(); return; }
    try {
      const frame = validateAiFrame(req.body);
      const result = world.exchange({ ...req.body, protocol: 3 });
      service.observe(frame);
      onTelemetry(req.body);
      const response = { ...result, protocol: 4, npcSettings: settings.snapshot(), aiUpdates: service.deliveries(), capabilities: { protocol: 4, legacyProtocol: 3, ai: ['conversation'], audio: false } };
      // Keep undelivered updates in memory until acknowledged. The native HTTP
      // reader accepts at most 64 KiB, even though uploads permit 128 KiB.
      while (response.aiUpdates.length && Buffer.byteLength(JSON.stringify(response), 'utf8') > 60 * 1024) response.aiUpdates.pop();
      if (Buffer.byteLength(JSON.stringify(response), 'utf8') > 64 * 1024) throw new AiError('response_size', 'Runtime response exceeds the native transport limit.', 503);
      res.json(response);
    } catch (error) { fail(res, error); }
  });
}
