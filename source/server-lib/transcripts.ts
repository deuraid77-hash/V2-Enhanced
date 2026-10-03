import fs from 'node:fs';
import path from 'node:path';
import { type SettingsGetter, settingBoolean, settingNumber } from './ai-types.ts';

export type TranscriptEntry = { at: string; runtimeId: string; sceneEpoch: string; npcId: string; speaker: string; text: string; source: string; lane: string; category: string; voice: string };
const KEYS = ['at', 'runtimeId', 'sceneEpoch', 'npcId', 'speaker', 'text', 'source', 'lane', 'category', 'voice'] as const;
function valid(entry: unknown): entry is TranscriptEntry {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const e = entry as Record<string, unknown>;
  return Object.keys(e).every(k => (KEYS as readonly string[]).includes(k)) && KEYS.every(k => typeof e[k] === 'string' && (e[k] as string).length <= 800);
}
/** Generated NPC lines only. Player-typed or transcribed text is never passed to this log. */
export class TranscriptLog {
  private entries: TranscriptEntry[] = [];
  private loaded = false;
  constructor(private file: string, private get: SettingsGetter, private now = Date.now) { if (!path.isAbsolute(file)) throw new Error('Transcript log requires an absolute path.'); }
  private max() { return Math.max(100, Math.min(20000, settingNumber(this.get, 'audio.transcriptMaxEntries', 5000))); }
  private load() {
    if (this.loaded) return; this.loaded = true;
    try {
      const stat = fs.statSync(this.file); if (stat.size > 32 * 1024 * 1024) return;
      for (const line of fs.readFileSync(this.file, 'utf8').split('\n')) { if (!line.trim()) continue; try { const parsed = JSON.parse(line); if (valid(parsed)) this.entries.push(parsed); } catch { /* skip a torn line */ } }
      this.entries = this.entries.slice(-this.max());
    } catch { /* no log yet */ }
  }
  append(entry: Omit<TranscriptEntry, 'at'>): boolean {
    if (!settingBoolean(this.get, 'audio.transcriptsEnabled', true)) return false;
    this.load();
    const full: TranscriptEntry = { at: new Date(this.now()).toISOString(), ...entry };
    if (!valid(full)) return false;
    this.entries.push(full);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (this.entries.length > this.max() * 1.1) { this.entries = this.entries.slice(-this.max()); this.rewrite(); }
    else fs.appendFileSync(this.file, JSON.stringify(full) + '\n');
    return true;
  }
  list(limit = 200) { this.load(); return this.entries.slice(-Math.max(1, Math.min(1000, limit))).reverse(); }
  count() { this.load(); return this.entries.length; }
  clear() { this.loaded = true; this.entries = []; try { fs.unlinkSync(this.file); } catch { /* already absent */ } }
  private rewrite() { const temp = this.file + '.tmp'; fs.writeFileSync(temp, this.entries.map(e => JSON.stringify(e)).join('\n') + '\n'); fs.renameSync(temp, this.file); }
}
