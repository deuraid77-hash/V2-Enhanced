import type express from 'express';
import { WorldError, WorldState } from './world.ts';

// Per-route loopback limits prevent runaway browser controls or stalled clients
// from growing a command backlog. They do not impose an artificial game tick.
function rateLimit(count: number, windowMs: number): express.RequestHandler {
  let start = Date.now(), used = 0;
  return (_req, res, next) => {
    const now = Date.now();
    if (now - start >= windowMs) { start = now; used = 0; }
    if (++used > count) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((start + windowMs - now) / 1000))));
      res.status(429).json({ success: false, error: 'Too many requests. Allow the game to acknowledge the previous change and retry shortly.' });
      return;
    }
    next();
  };
}
const boundedFrame: express.RequestHandler = (req, res, next) => {
  if (Buffer.byteLength(JSON.stringify(req.body ?? {}), 'utf8') > 128 * 1024) {
    res.status(413).json({ success: false, error: 'World requests may contain at most 128 KiB.' }); return;
  }
  next();
};

export function installWorldRoutes(app: express.Express, world: WorldState, onTelemetry: (value: unknown) => void = () => {}) {
  let streams = 0;
  function respond(res: express.Response, work: () => unknown) {
    try { res.json(work()); }
    catch (error) {
      // Validators use fixed field names. Do not echo supplied values or raw filesystem errors.
      res.status(error instanceof WorldError ? error.status : 400).json({ success: false, error: error instanceof Error ? error.message : 'World request failed validation.' });
    }
  }
  app.get('/api/world', rateLimit(120, 10_000), (_req, res) => res.json(world.snapshot()));
  app.patch('/api/world/config', rateLimit(30, 10_000), boundedFrame, (req, res) => respond(res, () => {
    const snapshot=world.configure(req.body);
    // Native settings editors need the saved revision, not the potentially
    // large event/NPC history carried by the browser's world snapshot.
    return req.query.compact==='true'?{success:true,config:snapshot.config}:snapshot;
  }));
  app.post('/api/world/commands', rateLimit(24, 10_000), boundedFrame, (req, res) => respond(res, () => ({ success: true, command: world.enqueue(req.body) })));
  app.post('/api/runtime/exchange', rateLimit(80, 10_000), boundedFrame, (req, res) => respond(res, () => {
    const result = world.exchange(req.body);
    onTelemetry(req.body);
    return result;
  }));
  app.get('/api/world/events', (req, res) => {
    if (streams >= 8) { res.status(429).json({ success: false, error: 'Close an unused portal tab before opening another live stream.' }); return; }
    streams++;
    res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    let closed = false;
    let writable = true;
    const send = () => {
      if (closed || !writable) return;
      writable = res.write(`event: world\ndata: ${JSON.stringify(world.snapshot())}\n\n`);
    };
    // A drain only permits the next scheduled update. Writing another full
    // snapshot here can make large frames trigger an endless drain/write loop.
    const drain = () => { writable = true; };
    res.on('drain', drain);
    const unsubscribe = world.subscribe(send);
    const interval = setInterval(send, 1000);
    interval.unref();
    const close = () => {
      if (closed) return;
      closed = true; streams--; clearInterval(interval); unsubscribe(); res.off('drain', drain);
    };
    req.on('close', close); res.on('close', close); res.on('error', close);
    send();
  });
}
