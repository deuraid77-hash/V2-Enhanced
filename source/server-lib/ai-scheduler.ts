import { AiError, type AiLane, type AiScope, type SettingsGetter, settingNumber } from './ai-types.ts';
export type ScheduledTask<T = unknown> = { id: string; lane: Exclude<AiLane, 'D'>; priority?: number; scope: AiScope; sceneBound?: boolean; run: (signal: AbortSignal) => Promise<T> };
type Queued = ScheduledTask & { controller: AbortController; resolve: (value: unknown) => void; reject: (reason: unknown) => void; order: number; timeout: ReturnType<typeof setTimeout> };
export class AiScheduler {
  private queue: Queued[] = [];
  private active = new Map<string, Queued>();
  private nextOrder = 0;
  private failures = 0;
  private openedUntil = 0;
  private probe = false;
  constructor(private getSettings: SettingsGetter, private now = Date.now) {}
  submit<T>(task: ScheduledTask<T>): Promise<T> {
    if (this.active.has(task.id) || this.queue.some(t => t.id === task.id)) return Promise.reject(new AiError('duplicate_job', 'AI job is already scheduled.', 409));
    if (this.queue.length >= settingNumber(this.getSettings, 'ai.queueLimit', 32)) return Promise.reject(new AiError('queue_full', 'AI queue is full.', 429));
    const timeout = setTimeout(() => this.cancel(task.id, 'timeout'), settingNumber(this.getSettings, 'ai.requestTimeoutMs', 20_000));
    timeout.unref();
    const promise = new Promise<T>((resolve, reject) => this.queue.push({ ...task, controller: new AbortController(), resolve: resolve as (value: unknown) => void, reject, order: this.nextOrder++, timeout }));
    this.queue.sort((a, b) => a.lane.localeCompare(b.lane) || (b.priority || 0) - (a.priority || 0) || a.order - b.order);
    this.drain();
    return promise;
  }
  private drain() {
    const cap = Math.max(1, Math.min(8, settingNumber(this.getSettings, 'ai.maxConcurrent', 3)));
    const reserve = Math.max(0, Math.min(cap - 1, settingNumber(this.getSettings, 'ai.liveReservedSlots', 1)));
    while (this.active.size < cap && this.queue.length) {
      const index = this.queue.findIndex(t => t.lane === 'A' || this.active.size < cap - reserve);
      if (index === -1) return;
      const task = this.queue.splice(index, 1)[0];
      this.active.set(task.id, task);
      let onAbort: () => void = () => {};
      const aborted = new Promise<never>((_resolve, reject) => { onAbort = () => reject(task.controller.signal.reason); task.controller.signal.addEventListener('abort', onAbort, { once: true }); });
      const work = Promise.resolve().then(() => {
        if (task.controller.signal.aborted) throw task.controller.signal.reason;
        return task.run(task.controller.signal);
      });
      Promise.race([work, aborted]).then(value => { if (task.controller.signal.aborted) task.reject(task.controller.signal.reason); else task.resolve(value); }, task.reject);
      // Cancellation settles the caller immediately, but an upstream operation
      // that ignores AbortSignal still occupies its physical concurrency slot.
      const settled = () => {
        clearTimeout(task.timeout); task.controller.signal.removeEventListener('abort', onAbort); this.active.delete(task.id); this.drain();
      };
      void work.then(settled, settled);
    }
  }
  cancel(id: string, reason = 'cancelled'): boolean {
    const queued = this.queue.find(t => t.id === id);
    const active = this.active.get(id);
    const error = new AiError(reason, 'AI work was cancelled because its scene or target changed.', 409);
    if (queued) { this.queue = this.queue.filter(t => t !== queued); clearTimeout(queued.timeout); queued.controller.abort(error); queued.reject(error); return true; }
    if (active) { active.controller.abort(error); return true; }
    return false;
  }
  invalidateScope(runtimeId: string, sceneEpoch: string, activeNpcIds: Iterable<string>) {
    const ids = new Set(activeNpcIds);
    for (const task of [...this.queue, ...this.active.values()]) if (task.sceneBound !== false && (task.scope.runtimeId !== runtimeId || task.scope.sceneEpoch !== sceneEpoch || task.scope.npcIds.some(id => !ids.has(id)))) this.cancel(task.id, 'stale_scene');
  }
  cancelAll(reason = 'shutdown') { for (const task of [...this.queue, ...this.active.values()]) this.cancel(task.id, reason); }
  // Circuit admission happens immediately before upstream HTTP, not enqueue.
  admitProvider() {
    if (this.openedUntil > this.now() || (this.openedUntil > 0 && this.probe)) throw new AiError('circuit_open', 'AI provider is temporarily unavailable; offline fallback is active.', 503);
    if (this.openedUntil > 0) this.probe = true;
  }
  providerSucceeded() { this.failures = 0; this.openedUntil = 0; this.probe = false; }
  providerFailed(retryable: boolean) {
    this.probe = false;
    if (!retryable) return;
    if (++this.failures >= settingNumber(this.getSettings, 'ai.breakerFailureThreshold', 3)) this.openedUntil = this.now() + settingNumber(this.getSettings, 'ai.breakerOpenSeconds', 30) * 1000;
  }
  snapshot() {
    const byLane = { A: 0, B: 0, C: 0 };
    for (const t of [...this.queue, ...this.active.values()]) byLane[t.lane]++;
    return { queued: this.queue.length, running: this.active.size, byLane, breaker: { state: this.openedUntil > this.now() ? 'open' : this.openedUntil > 0 ? 'half-open' : 'closed', failures: this.failures, retryAt: this.openedUntil ? new Date(this.openedUntil).toISOString() : null } };
  }
}
