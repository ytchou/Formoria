import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { freezeFailures } from './selfheal/incident';
import { buildExactSelectors } from './selfheal/exact-failure-runner';
import {
  assertE2EReport,
  collectSkipped,
  unexpectedSkipFailures,
  unexpectedSkips,
  type ExpectedSkipManifest,
} from './e2e-report-gate';

const manifest: ExpectedSkipManifest = { version: 1, allowed: [] };

function report(status: string, reason?: string) {
  return {
    suites: [{ file: 'e2e/tests/example.spec.ts', specs: [{ title: 'the journey', tests: [{ projectName: 'deep', status, annotations: reason ? [{ type: 'skip', description: reason }] : [] }] }] }],
    stats: { skipped: status === 'skipped' ? 1 : 0 },
  };
}

describe('deployed Playwright report gate', () => {
  it('names a skipped journey instead of certifying a green run', () => {
    expect(() => assertE2EReport(report('skipped'), manifest)).toThrow('example.spec.ts');
    expect(collectSkipped(report('skipped'))).toHaveLength(1);
  });

  it('allows only a checked, exact intentional skip entry', () => {
    const allowed = { version: 1 as const, allowed: [{ file: 'example.spec.ts', title: 'the journey', reason: 'known maintenance window' }] };
    expect(unexpectedSkips(report('skipped', 'known maintenance window'), allowed)).toEqual([]);
  });

  it('never allows signup email quota to become an expected skip', () => {
    const allowed = { version: 1 as const, allowed: [{ file: 'example.spec.ts' }] };
    expect(unexpectedSkips(report('skipped', 'Supabase email quota 429'), allowed)).toHaveLength(1);
  });

  it('freezes an unexpected skip as an actionable source failure', () => {
    expect(unexpectedSkipFailures(report('skipped', 'owner flag drift'), manifest)).toEqual([
      {
        file: 'e2e/tests/example.spec.ts',
        title: 'the journey',
        project: 'deep',
        reason: 'skip owner flag drift',
      },
    ]);
  });

  it('the manifest JSON is valid and has no quota-related entries', async () => {
    const value = JSON.parse(await readFile('scripts/e2e-expected-skips.json', 'utf8')) as ExpectedSkipManifest;
    expect(value.version).toBe(1);
    expect(Array.isArray(value.allowed)).toBe(true);
    for (const entry of value.allowed) {
      expect(entry.file).toBeTruthy();
      expect(entry.reason).toBeTruthy();
    }
    expect(JSON.stringify(value)).not.toMatch(/quota|rate\s*limit|\b429\b/i);
  });

  it('round-trips the original skip title into the exact runner with reason separate', () => {
    const failures = unexpectedSkipFailures(report('skipped', 'owner flag drift'), manifest);
    const frozen = freezeFailures(failures);
    const selectors = buildExactSelectors(frozen.failures);

    expect(frozen.failures[0]).toMatchObject({
      file: 'e2e/tests/example.spec.ts',
      title: 'the journey',
      project: 'deep',
      reason: 'skip owner flag drift',
    });
    expect(selectors).toEqual([
      expect.objectContaining({
        file: 'e2e/tests/example.spec.ts',
        title: 'the journey',
        project: 'deep',
      }),
    ]);
  });
});
