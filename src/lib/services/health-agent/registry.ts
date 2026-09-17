/**
 * Detector registry — maps every DetectorName to its Detector instance.
 *
 * Compile-time: `Record<DetectorName, Detector>` ensures TypeScript errors
 * if a detector is missing. Runtime: `Object.keys(registry)` is asserted
 * against `DETECTOR_NAMES` in the registry test.
 *
 * Shape constraints:
 * - No Next.js API imports (next/cache, next/server, unstable_cache).
 * - No `createServiceClient()` — the client is injected via `run.ts`.
 * - Dependencies flow through `ctx.deps` at run time.
 *
 * Multi-name detectors:
 * - `linkDetector` runs both link-health and link-cleanup in one call.
 *   Registry maps `link-health` to the real detector; `link-cleanup` is
 *   a no-op stub (cleanup logic is embedded in link-health).
 * - `linksWeeklyDetector` runs all 8 classes in one call. Registry maps
 *   `social` to the real detector; the other 7 class names are no-op
 *   stubs (their findings are produced by the social entry).
 * - quality detectors (vitest, knip, knip-fix) are stubs — actual work
 *   runs as worker jobs dispatched by run.ts.
 */

import type { DetectorName } from '@/lib/constants/health-detectors'
import { DETECTOR_SOURCE, DETECTOR_SCHEDULE } from '@/lib/constants/health-detectors'
import type { Detector, DetectorContext } from './types'
import type { HealthFinding } from './contracts'

// ---------------------------------------------------------------------------
// Detector imports
// ---------------------------------------------------------------------------

import { backlogDetector } from './detectors/backlog'
import { brandInvariantsDetector } from './detectors/brand-invariants'
import { brandReviewDetector } from './detectors/brand-review'
import { claudeTokenDetector } from './detectors/claude-token'
import { cronDetector } from './detectors/cron'
import { curationJobsDetector } from './detectors/curation-jobs'
import { databaseHealthDetector } from './detectors/database-health'
import { dependabotDetector } from './detectors/dependabot'
import { emailDetector } from './detectors/email'
import { embeddingsDetector } from './detectors/embeddings'
import { externalCallsDetector } from './detectors/external-calls'
import { githubAppDetector } from './detectors/github-app'
import { imagesDetector } from './detectors/images'
import { langfuseDetector } from './detectors/langfuse'
import { linearDetector } from './detectors/linear'
import { linkDetector } from './detectors/link'
import { linksWeeklyDetector } from './detectors/links-weekly'
import { mitRegistryDetector } from './detectors/mit-registry'
import { resendDomainDetector } from './detectors/resend-domain'
import { searchDetector } from './detectors/search'
import { sentryCaptureDetector } from './detectors/sentry-capture'
import { sentryWriteDetector } from './detectors/sentry-write'
import { sentryDetector } from './detectors/sentry'
import { serviceProbesDetector } from './detectors/service-probes'
import { slackEventsDetector } from './detectors/slack-events'
import { surfaceDetector } from './detectors/surface'
import { trailSupplyDetector } from './detectors/trail-supply'
import { workerChromiumDetector } from './detectors/worker-chromium'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wrap a factory detector so its deps come from `ctx.deps` at run time.
 * The detector's name must match the registry key.
 *
 * Type safety lives at the detector boundary, not in the registry glue.
 */
function withCtxDeps(
  name: DetectorName,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  factory: (deps: any) => Detector,
  extractDeps: (ctxDeps: Record<string, unknown>) => unknown,
): Detector {
  return {
    name,
    source: DETECTOR_SOURCE[name],
    schedule: DETECTOR_SCHEDULE[name],
    severity: 'medium',
    async run(ctx: DetectorContext): Promise<HealthFinding[]> {
      const deps = extractDeps(ctx.deps)
      const detector = factory(deps)
      return detector.run(ctx)
    },
  }
}

/**
 * A no-op stub detector. Used for names whose work is handled by another
 * detector or by a worker job dispatched from run.ts.
 */
function stubDetector(name: DetectorName): Detector {
  return {
    name,
    source: DETECTOR_SOURCE[name],
    schedule: DETECTOR_SCHEDULE[name],
    severity: 'medium',
    stub: true,
    async run(): Promise<HealthFinding[]> {
      return []
    },
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * The canonical detector registry. TypeScript enforces that every
 * DetectorName has an entry.
 */
export const registry: Record<DetectorName, Detector> = {
  // ---- link source ----
  // linkDetector runs both health check and cleanup; link-cleanup is a stub.
  'link-health': withCtxDeps('link-health', linkDetector, (deps) => ({
    runLinkHealthCheck: deps.runLinkHealthCheck,
    cleanupDeadLinks: deps.cleanupDeadLinks,
  })),
  'link-cleanup': stubDetector('link-cleanup'),

  // ---- directory source ----
  'brand-invariants': withCtxDeps('brand-invariants', brandInvariantsDetector, (deps) => ({
    supabase: deps.supabase,
  })),
  'brand-review': withCtxDeps('brand-review', brandReviewDetector, (deps) => ({
    supabase: deps.supabase,
  })),
  'trail-supply': withCtxDeps('trail-supply', trailSupplyDetector, (deps) => ({
    railwayUrl: deps.railwayUrl,
    originSecret: deps.originSecret,
    fetchImpl: deps.fetchFn,
  })),
  'database-health': withCtxDeps('database-health', databaseHealthDetector, (deps) => ({
    supabase: deps.supabase,
  })),
  dependabot: withCtxDeps('dependabot', dependabotDetector, (deps) => ({
    fetchFn: deps.fetchFn ?? globalThis.fetch,
  })),

  // ---- sentry source ----
  'sentry-triage': withCtxDeps('sentry-triage', sentryDetector, (deps) => ({
    listIssues: deps.listIssues,
  })),

  // ---- quality source — stubs; worker jobs handle the real work ----
  vitest: stubDetector('vitest'),
  knip: stubDetector('knip'),
  'knip-fix': stubDetector('knip-fix'),

  // ---- cron source ----
  'cron-health': withCtxDeps('cron-health', cronDetector, (deps) => ({
    supabase: deps.supabase,
    fetchFn: deps.fetchFn ?? globalThis.fetch,
  })),

  // ---- pipeline source ----
  'curation-jobs': curationJobsDetector,
  'external-calls': externalCallsDetector,
  embeddings: embeddingsDetector,
  images: imagesDetector,
  email: emailDetector,
  'mit-registry': mitRegistryDetector,

  // ---- credential source ----
  'service-probes': serviceProbesDetector,
  linear: linearDetector,
  'github-app': githubAppDetector,
  langfuse: langfuseDetector,
  'slack-events': slackEventsDetector,
  'worker-chromium': workerChromiumDetector,
  'resend-domain': resendDomainDetector,
  'claude-token': claudeTokenDetector,
  'sentry-write': sentryWriteDetector,
  'sentry-capture': sentryCaptureDetector,

  // ---- surface source ----
  'surface-assertions': surfaceDetector,

  // ---- links-weekly source ----
  // linksWeeklyDetector runs all 8 classes. Only `social` runs the real
  // detector; the other 7 are stubs whose findings are produced by it.
  social: withCtxDeps('social', linksWeeklyDetector, (deps) => ({
    checkSocialLinks: deps.checkSocialLinks,
    checkBrandOtherUrls: deps.checkBrandOtherUrls,
    checkStockistLinks: deps.checkStockistLinks,
    checkBrandChannelLinks: deps.checkBrandChannelLinks,
    checkEventLinks: deps.checkEventLinks,
    checkBrandImageLinks: deps.checkBrandImageLinks,
    checkCuratedProductLinks: deps.checkCuratedProductLinks,
    checkMdxLinks: deps.checkMdxLinks,
  })),
  'brand-other-urls': stubDetector('brand-other-urls'),
  stockists: stubDetector('stockists'),
  'brand-channels': stubDetector('brand-channels'),
  events: stubDetector('events'),
  'brand-images': stubDetector('brand-images'),
  'curated-products': stubDetector('curated-products'),
  mdx: stubDetector('mdx'),

  // ---- search source ----
  'search-quality': searchDetector,

  // ---- backlog source ----
  'backlog-health': backlogDetector,
}

