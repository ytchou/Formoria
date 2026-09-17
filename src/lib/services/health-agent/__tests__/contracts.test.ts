import { describe, expect, it } from 'vitest'
import { stableFingerprint } from '../contracts'
import { stableFingerprint as scriptsStableFingerprint } from '../../../../../scripts/health-agent/contracts'

/**
 * Pin that the service-layer stableFingerprint is byte-identical to the
 * scripts/ implementation. Every carried-over source must produce the same
 * output, or open findings would be orphaned.
 */
describe('stableFingerprint output is byte-identical to the scripts implementation', () => {
  const cases: Array<[source: string, kind: string, identity: string]> = [
    ['link', 'dead-link', 'https://example.com/page'],
    ['directory', 'brand-invariant', 'Brand Name Missing'],
    ['sentry', 'unresolved-issue', 'PROJ-42'],
    ['quality', 'vitest-failure', 'src/lib/services/foo.test.ts'],
    ['cron', 'stale-job', 'link-health-check'],
    // Edge cases: special characters, whitespace
    ['link', '  Dead Link  ', '  HTTPS://EXAMPLE.COM  '],
    ['directory', 'Brand.Review_v2', 'Café & Co.'],
  ]

  it.each(cases)(
    'source=%s kind=%s identity=%s',
    (source, kind, identity) => {
      const serviceResult = stableFingerprint(source, kind, identity)
      // The scripts version has a narrower source type, but the algorithm is
      // the same for any string input. We cast to bypass the type check since
      // we're testing the algorithm, not the type.
      const scriptsResult = scriptsStableFingerprint(
        source as Parameters<typeof scriptsStableFingerprint>[0],
        kind,
        identity,
      )
      expect(serviceResult).toBe(scriptsResult)
    },
  )
})
