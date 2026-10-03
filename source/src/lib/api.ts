export async function postApi<T = any>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const data = await response.json();
  if (!response.ok || data.success === false) {
    throw new Error(data.error || data.message || `Request failed (${response.status})`);
  }
  return data as T;
}

export function responseSource(data: { source?: string; isFallback?: boolean; isCached?: boolean; modelUsed?: string }): string {
  if (data.isFallback || data.source?.startsWith('heuristic-') || data.source?.startsWith('fallback-')) return 'Local simulation response';
  if (data.isCached) return 'Bundled reference notes; live grounding unavailable';
  return data.source || data.modelUsed || 'Gemini API response';
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed.';
}
