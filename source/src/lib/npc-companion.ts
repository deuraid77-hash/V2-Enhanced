import { useCallback, useEffect, useRef, useState } from 'react';
import type { NpcSettings, SettingDefinition } from '../../shared/settings';
import { api, type Settings, type WorldSnapshot } from './world';

export type SettingsSnapshot = { revision: number; settings: NpcSettings; source: string; updatedAt: string; catalog?: readonly SettingDefinition[]; worldCatalog?: readonly SettingDefinition[]; recovery?: string | null; world?: { revision: number; settings: Settings; source: string; updatedAt: string } };
export type AiStatus = {
  success: true; protocol: number;
  capabilities: { jobs: boolean; streamingSpeech: boolean; lanes: string[]; activeJobKinds: string[]; provider: string; configured?: boolean; models: { id: string; available: boolean | null; structuredOutput: boolean; streaming: boolean }[] };
  runtime?: { protocol: number | null; runtimeId: string | null; sceneEpoch: string | null; connected: boolean; appliedNpcRevision: number; gameFileVersion: string | null; sdkGameVersion: string | null; tickMetrics: Record<string, number> };
  scheduler: { queued: number; running: number; byLane: Record<string, number>; breaker: { state: string; failures: number; retryAt: string | number | null } };
  budget: { currency: string; day: string; dayTimezone?: string; dailyLimitUsd: number; spentEstimateUsd: number; reservedEstimateUsd: number; remainingUsd: number; sessionSpentEstimateUsd: number; usage: { inputTokens: number; outputTokens: number; cachedTokens: number; thoughtTokens: number; totalTokens: number }; requests: number; unknownUsageRequests: number; priceVersion: string };
  menu?: { recentJobs: { id: string; kind: string; status: string; source: string | null; createdAt: string; finishedAt?: string; firstTextMs?: number; durationMs?: number; reasonCode?: string }[]; previewCount: number };
  recentJobs: { id: string; kind: string; lane: string; status: string; source: string; createdAt: string; finishedAt?: string; firstTextMs?: number; durationMs?: number; reasonCode?: string }[];
};

export function useCompanionResource<T>(url: string) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState(''), [receivedAt, setReceivedAt] = useState(0);
  const controller = useRef<AbortController | null>(null), mounted = useRef(false);
  const refresh = useCallback(async () => {
    if (controller.current) return;
    const request = new AbortController(); controller.current = request;
    try { const next = await api<T>(url, { signal: request.signal }); if (mounted.current) { setData(next); setError(''); setReceivedAt(Date.now()); } }
    catch (e) { if (mounted.current && !request.signal.aborted) setError(e instanceof Error ? e.message : 'Companion data is unavailable.'); }
    finally { if (controller.current === request) controller.current = null; }
  }, [url]);
  useEffect(() => { mounted.current = true; void refresh(); const timer = setInterval(refresh, 5000); return () => { mounted.current = false; clearInterval(timer); controller.current?.abort(); controller.current = null; }; }, [refresh]);
  return { data, setData, error, receivedAt, refresh };
}
export type CompanionResource<T> = ReturnType<typeof useCompanionResource<T>>;

export function nativeAcknowledgement(desiredRevision: number | undefined, ai: AiStatus | null, receivedAt: number, now: number, world: WorldSnapshot | null, worldFresh: boolean, error = '') {
  const runtime = ai?.runtime;
  const fresh = Boolean(!error && runtime?.protocol === 4 && runtime.connected && worldFresh && world?.runtimeId === runtime.runtimeId && receivedAt > 0 && now - receivedAt < 6500);
  const applied = runtime?.appliedNpcRevision ?? 0;
  return { fresh, applied, acknowledged: fresh && desiredRevision !== undefined && applied === desiredRevision, pending: fresh && desiredRevision !== undefined && applied < desiredRevision };
}

export type ProfileExport = { format: 'LivingLosSantos.profile'; version: 4; name: string; settings: NpcSettings; worldSettings?: Settings };
export type SettingsChange = { key: string; label: string; before: string | number | boolean; after: string | number | boolean; scope: 'npc' | 'world'; reason?: string };
export function profileChanges(profile: ProfileExport, current: SettingsSnapshot): SettingsChange[] {
  const labels = new Map(current.catalog?.map(item => [item.key, item.label]) || []);
  const changes: SettingsChange[] = [];
  for (const [key, after] of Object.entries(profile.settings)) if (current.settings[key] !== after) changes.push({ key, label: labels.get(key) || key, before: current.settings[key], after, scope: 'npc' });
  for (const [key, after] of Object.entries(profile.worldSettings || {})) if (current.world?.settings[key as keyof Settings] !== after) changes.push({ key, label: key.replace(/([a-z])([A-Z])/g, '$1 $2'), before: current.world?.settings[key as keyof Settings] ?? 'Unavailable', after, scope: 'world' });
  return changes;
}
export function readProfileImport(text: string): ProfileExport {
  if (new TextEncoder().encode(text).byteLength > 256 * 1024) throw new Error('Profile files must be smaller than 256 KiB.');
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.format !== 'LivingLosSantos.profile' || value.version !== 4 || typeof value.name !== 'string' || !value.settings || typeof value.settings !== 'object' || Array.isArray(value.settings)) throw new Error('Choose a Living Los Santos version 4 profile JSON file.');
  if (Object.keys(value).some(key => !['format', 'version', 'name', 'settings', 'worldSettings'].includes(key))) throw new Error('This profile contains unsupported fields.');
  return value;
}
export function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename.replace(/[^a-zA-Z0-9._-]/g, '_'); document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const errorText = (error: unknown) => error instanceof Error ? error.message : 'The companion could not complete this request.';
