import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ANONYMOUS_MUTATION_REASON,
  ANONYMOUS_CORRECTION_REASON,
  EVENT_AREA_FILTER_REASON,
  EXPECTED_STAGING_CONSTRAINT_SKIP_REGISTRY,
  HIDDEN_AUTH_AFFORDANCE_REASON,
  STAGING_NO_SITEMAP_REASON,
} from './e2e-staging-skip-registry';
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

async function listSpecFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listSpecFiles(path);
    return entry.isFile() && entry.name.endsWith('.spec.ts') ? [path] : [];
  }));
  return files.flat().sort();
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

  // One registry, one manifest. The owner-feature class went with the claim
  // flow (DEV-1570), so every remaining entry is a staging-environment fact; an
  // entry the registry does not claim is an unreviewed skip, which is the
  // failure this gate exists to catch. Pinning the LENGTH as well as the
  // membership is what makes that true — `arrayContaining` alone would wave
  // through an extra row.
  it('keeps the checked manifest limited to the registered skip class', async () => {
    const value = JSON.parse(await readFile('scripts/e2e-expected-skips.json', 'utf8')) as ExpectedSkipManifest;
    const registeredReasons = new Set<string>([
      ANONYMOUS_MUTATION_REASON,
      HIDDEN_AUTH_AFFORDANCE_REASON,
      ANONYMOUS_CORRECTION_REASON,
      STAGING_NO_SITEMAP_REASON,
      EVENT_AREA_FILTER_REASON,
    ]);
    expect(value.version).toBe(1);
    expect(value.allowed).toHaveLength(EXPECTED_STAGING_CONSTRAINT_SKIP_REGISTRY.length);
    expect(value.allowed.every(({ reason }) => reason !== undefined && registeredReasons.has(reason))).toBe(true);
    const manifestEntries = value.allowed.map(({ file, title, reason }) => ({ file, title, reason }));
    expect(manifestEntries).toEqual(expect.arrayContaining(
      EXPECTED_STAGING_CONSTRAINT_SKIP_REGISTRY.map(({ file, title, reason }) => ({ file, title, reason })),
    ));
    expect(JSON.stringify(value)).not.toMatch(/quota|rate\s*limit|\b429\b/i);
    for (const allowed of value.allowed) {
      expect(unexpectedSkips({
        suites: [{
          file: `e2e/tests/${allowed.file}`,
          specs: [{
            title: `${allowed.title ?? 'registered journey'} › representative case`,
            tests: [{
              projectName: 'deep',
              status: 'skipped',
              annotations: [{ type: 'skip', description: allowed.reason ?? '' }],
            }],
          }],
        }],
        stats: { skipped: 1 },
      }, value)).toEqual([]);
    }
  });

  // The owner-feature registry is gone (DEV-1570), so nothing pins its skips
  // any more. This is the replacement: a reintroduced owner-feature gate would
  // otherwise reappear in the specs with no registry, no manifest row, and no
  // failure. Written as regex literals on purpose — a find-and-replace over a
  // string array is how a forbidden list gets silently inverted.
  it('fails when an owner-feature gate reappears in the e2e specs', async () => {
    const specRoot = 'e2e/tests';
    const specPaths = await listSpecFiles(specRoot);
    const forbidden = [
      /ownerFeaturesDisabled/,
      /OWNER_FEATURES_OFF_REASON/,
      /OWNER_FEATURES_ON_REASON/,
      /owner_features_enabled/,
    ];
    for (const path of specPaths) {
      const source = await readFile(path, 'utf8');
      for (const pattern of forbidden) {
        expect(source, `${relative(specRoot, path)} reintroduces an owner-feature gate`).not.toMatch(pattern);
      }
    }
  });

  // The staging reasons are literals at the call site, so nothing but this grep
  // stops a spec from rewording its reason and silently un-allowlisting its own
  // skip — the manifest would still name the file and title, and the runtime
  // gate compares on the reason text.
  it('fails when a staging-constraint skip reason drifts from its spec', async () => {
    const specRoot = 'e2e/tests';
    const specSource = Object.fromEntries(await Promise.all(
      (await listSpecFiles(specRoot)).map(async (path) => [
        relative(specRoot, path),
        await readFile(path, 'utf8'),
      ] as const),
    ));

    for (const entry of EXPECTED_STAGING_CONSTRAINT_SKIP_REGISTRY) {
      expect(specSource[entry.file], `${entry.file} is registered but does not exist`).toBeDefined();
      expect(specSource[entry.file], `${entry.file} no longer contains its registered skip reason`).toContain(entry.reason);
    }
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
