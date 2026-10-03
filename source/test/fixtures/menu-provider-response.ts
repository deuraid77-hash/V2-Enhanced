import type { StructuredRequest } from '../../server-lib/ai-types.ts';

// Deterministic fixture data must obey the same per-request key allowlist as
// a real structured provider. This helper contains no credentials or network.
export function menuFixtureResponse(request: StructuredRequest): unknown {
  const schema = request.schema as any;
  if (schema.properties?.changes) {
    const allowed = new Set<string>(schema.properties.changes.items.properties.key.enum);
    const catalog = JSON.parse(request.prompt).catalog as { key: string; current: unknown }[];
    const choices = [
      { key: 'world.eventIntervalSeconds', value: 120, alternative: 150, reason: 'Fixture longer encounter interval.' },
      { key: 'ai.directorIntervalSeconds', value: 15, alternative: 12, reason: 'Fixture lower background request frequency.' },
    ];
    const changes = choices.filter(c => allowed.has(c.key)).map(c => ({ key: c.key, value: catalog.find(d => d.key === c.key)?.current === c.value ? c.alternative : c.value, reason: c.reason }));
    return { summary: 'Fixture preview: change the selected encounter and background AI intervals.', changes };
  }
  if (schema.properties?.text) return { text: 'Fixture explanation grounded in the selected catalog option. This is a deterministic test response.' };
  if (schema.properties?.findings) return { summary: 'Fixture diagnostic assessment.', findings: [{ severity: 'info', message: 'Only the supplied sanitized status is considered.' }], suggestedSettingKeys: ['ai.maxConcurrent'] };
  return { ok: true };
}
