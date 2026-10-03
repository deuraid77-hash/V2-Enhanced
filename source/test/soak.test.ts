import test from 'node:test'; import assert from 'node:assert/strict';
import { runSoak } from '../scripts/soak-companion.ts';

// Step 6: one simulated hour of companion frames (fixture provider, simulated clock).
// Guards the soak finding that background director jobs were never pruned.
test('soak: one simulated hour stays bounded and keeps producing scenarios', async () => {
  const r = await runSoak({ hours: 1 });
  assert.deepEqual(r.errors, []);
  assert.equal(r.frames, 7200);
  assert.ok(r.scenarioUpdates >= 300, `scenario updates ${r.scenarioUpdates}`);
  assert.ok(r.max.jobs <= 257, `jobs ${r.max.jobs}`);
  assert.ok(r.max.outcomes <= 256 && r.max.handledOpportunities <= 256 && r.max.updates <= 8);
});
