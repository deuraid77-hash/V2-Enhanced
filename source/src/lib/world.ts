import { useEffect, useState } from 'react';
export type Position = { x: number; y: number; z: number };
export type Settings = { enabled: boolean; ambientHostility: number; gangAggression: number; civilianPanic: number; eventIntervalSeconds: number; maxActiveEvents: number; maxSpawnedPeds: number; turfWars: boolean; streetFights: boolean; ambientTaunts: boolean; tacticalRetreat: boolean; blips: boolean; subtitles: boolean; protectMissions: boolean };
export const DEFAULT_SETTINGS: Settings = { enabled: true, ambientHostility: 65, gangAggression: 75, civilianPanic: 70, eventIntervalSeconds: 75, maxActiveEvents: 2, maxSpawnedPeds: 16, turfWars: true, streetFights: true, ambientTaunts: true, tacticalRetreat: true, blips: true, subtitles: true, protectMissions: true };
export type NPC = { id: string; name?: string; faction?: string; position: Position; health?: number; alive?: boolean; inCombat?: boolean; modelHash?: number; owned?: boolean; memory?: string };
export type Territory = { id: string; name: string; owner: string; challenger: string | null; heat: number; position: Position; radius: number; wins: number };
export type Battle = { id: string; type: string; districtId: string; attacker: string; defender: string; state: string; attackerAlive: number; defenderAlive: number; startedAt: string };
export type Command = { id: string; requestId: string; runtimeId: string; type: string; payload: Record<string, unknown>; status: 'queued' | 'applied' | 'rejected' | 'expired'; createdAt: string; expiresAt: string; message?: string };
export type WorldEvent = { id: string; at: string; type: string; message: string; districtId?: string; faction?: string };
export type Telemetry = { protocol?: number; runtimeId: string; pluginVersion: string; gameVersion: string; player?: { position?: Position; wantedLevel?: number; weaponDrawn?: boolean }; environment?: { weather?: string; timeOfDay?: string; district?: string }; npcs: NPC[]; director?: { enabled: boolean; pausedReason: string | null; settings: Settings; activeEvents: Battle[]; territories: Territory[]; ownedPedCount: number } };
export type WorldSnapshot = { success: true; connected: boolean; lastSeenAt: string | null; runtimeId: string | null; config: { revision: number; settings: Settings }; appliedRevision: number; telemetry: Telemetry | null; commands: Command[]; events: WorldEvent[] };
export type Health = { version?: string; geminiConfigured?: boolean; model?: string; bridge?: { reachable?: boolean; port?: number; provider?: string } };
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers }, signal: AbortSignal.timeout(8000) });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success === false) throw new Error(body?.error || `Companion request failed (${response.status}).`);
  if (!body) throw new Error('The companion returned an unreadable response.');
  return body as T;
}
export function useWorld() {
  const [snapshot, setSnapshot] = useState<WorldSnapshot | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [stream, setStream] = useState<'connecting' | 'open' | 'reconnecting'>('connecting');
  const [error, setError] = useState('');
  const [receivedAt, setReceivedAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let active = true, fromStream = false;
    const accept = (value: WorldSnapshot) => {
      if (!active || value?.success !== true || !value.config || !Array.isArray(value.commands) || !Array.isArray(value.events)) return;
      setSnapshot(value); setReceivedAt(Date.now()); setError('');
    };
    api<WorldSnapshot>('/api/world').then(value => { if (!fromStream) accept(value); }).catch(e => { if (active) setError(e.message); });
    const events = new EventSource('/api/world/events');
    events.onopen = () => { if (active) setStream('open'); };
    events.addEventListener('world', event => {
      try { fromStream = true; accept(JSON.parse((event as MessageEvent).data)); if (active) setStream('open'); }
      catch { if (active) setError('Unable to read the world stream. Reconnecting automatically.'); }
    });
    events.onerror = () => { if (active) setStream('reconnecting'); };
    const readHealth = () => api<Health>('/api/health').then(value => { if (active) setHealth(value); }).catch(() => { if (active) setHealth(null); });
    readHealth();
    const healthTimer = window.setInterval(readHealth, 30000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { active = false; events.close(); window.clearInterval(healthTimer); window.clearInterval(clock); };
  }, []);
  const lastSeen = snapshot?.lastSeenAt ? Date.parse(snapshot.lastSeenAt) : 0;
  const streamFresh = receivedAt > 0 && now - receivedAt < 5000;
  const gameFresh = Boolean(snapshot?.connected && lastSeen && now - lastSeen < 5000 && now - lastSeen >= -2000 && streamFresh);
  const compatible = snapshot?.telemetry?.protocol === 3;
  return { snapshot, health, stream, streamFresh, error, now, gameFresh, compatible, online: gameFresh && compatible, setSnapshot };
}
export const gangColor = (faction?: string) => faction === 'Families' ? '#62d696' : faction === 'Ballas' ? '#b29aff' : faction === 'Vagos' ? '#f3c35a' : '#9aa7b3';
export const distance = (a?: Position, b?: Position) => a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : null;
export const humanize = (text: string) => text.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
export function timeAgo(at?: string | null, now = Date.now()) {
  if (!at) return 'Never';
  const seconds = Math.max(0, Math.floor((now - Date.parse(at)) / 1000));
  if (!Number.isFinite(seconds)) return 'Unknown';
  return seconds < 2 ? 'Just now' : seconds < 60 ? `${seconds}s ago` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago` : `${Math.floor(seconds / 3600)}h ago`;
}
