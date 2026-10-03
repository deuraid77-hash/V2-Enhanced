import type express from 'express';
import expressRuntime from 'express';
import { AiError } from './ai-types.ts';
import type { LineBank } from './line-bank.ts';
import type { TranscriptLog } from './transcripts.ts';
import type { VoiceService } from './voice-service.ts';

export function installVoiceRoutes(app: express.Express, voice: VoiceService, bank: LineBank, transcripts: TranscriptLog) {
  const router = expressRuntime.Router(); let start = 0, count = 0;
  router.use((req, res, next) => {
    const address = req.socket.remoteAddress || '';
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) { res.status(403).json({ success: false, code: 'loopback_only', error: 'Voice routes are local only.' }); return; }
    if (Date.now() - start > 10000) { start = Date.now(); count = 0; }
    if (++count > 400) { res.status(429).json({ success: false, code: 'rate_limit', error: 'Voice request limit reached.' }); return; }
    if (Buffer.byteLength(JSON.stringify(req.body ?? {})) > 16384) { res.status(413).json({ success: false, code: 'request_size', error: 'Voice request is too large.' }); return; }
    next();
  });
  const run = (fn: (req: express.Request) => unknown): express.RequestHandler => (req, res) => {
    Promise.resolve().then(() => fn(req)).then(value => res.json(value)).catch(error => res.status(error instanceof AiError ? error.status : 500).json({ success: false, code: error instanceof AiError ? error.code : 'voice_failed', error: error instanceof AiError ? error.message : 'Voice request could not complete.' }));
  };
  router.post('/audio/frame', run(req => voice.frame(req.body)));
  router.get('/audio/status', run(() => voice.status()));
  router.get('/bank/status', run(() => bank.status()));
  router.get('/transcripts', run(req => ({ success: true, entries: transcripts.list(Number(req.query.limit) || 200) })));
  router.delete('/transcripts', run(() => { transcripts.clear(); return { success: true }; }));
  app.use('/api', router);
}
