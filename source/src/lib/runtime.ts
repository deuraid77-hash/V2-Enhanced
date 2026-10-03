import { useEffect, useState } from 'react';

export interface GameRuntimeStatus {
  connected: boolean;
  lastSeenAt: string | null;
  gameVersion: string | null;
  pluginVersion: string | null;
  npcCount: number;
}

export interface CompanionHealth {
  status: string;
  version: string;
  model: string;
  geminiConfigured: boolean;
  mode: string;
  gameRuntime: GameRuntimeStatus;
  bridge: { reachable: boolean; port: number; provider: string | null };
  tacticalMLEngine: string;
  cloudSyncEnabled: boolean;
}

export function useCompanionHealth() {
  const [health, setHealth] = useState<CompanionHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch('/api/health', { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error(`Dashboard server unavailable (${response.status})`);
        const data = await response.json();
        if (!data.gameRuntime || !data.bridge) throw new Error('Dashboard health response is incomplete');
        if (!controller.signal.aborted) {
          setHealth(data);
          setError(null);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setHealth(null);
          setError(error instanceof Error ? error.message : 'Dashboard server unavailable');
        }
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);
  return { health, error };
}
