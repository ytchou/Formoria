/**
 * Health detector registry — the single source of truth for detector names,
 * their owning sources, and their run schedules.
 *
 * Every detector the health agent can run is declared here. Parallel waves in
 * the migration never edit this file — all names are declared up front so the
 * RPC source allow-list (removed in 20260917110000) is replaced by this code
 * registry.
 *
 * Pattern mirrors `src/lib/constants/enrich-phases.ts`: `as const` arrays,
 * derived union types, exhaustive `Record` maps.
 */

// ---------------------------------------------------------------------------
// Sources — the coarse grouping that maps to health_fix_queue.source.
// The first five are carried over from the existing agent; renaming them
// would strand active ledger rows.
// ---------------------------------------------------------------------------

export const HEALTH_SOURCES = [
  "link",
  "directory",
  "sentry",
  "quality",
  "cron",
  "pipeline",
  "credential",
  "surface",
  "links-weekly",
  "search",
  "backlog",
  "agent",
] as const;

export type HealthSource = (typeof HEALTH_SOURCES)[number];

// ---------------------------------------------------------------------------
// Detector names — every detector the health agent can run.
// ---------------------------------------------------------------------------

export const DETECTOR_NAMES = [
  // link source
  "link-health",
  "link-cleanup",
  // directory source
  "brand-invariants",
  "brand-review",
  "trail-supply",
  "database-health",
  "dependabot",
  // sentry source
  "sentry-triage",
  // quality source
  "vitest",
  "knip",
  "knip-fix",
  // cron source
  "cron-health",
  // pipeline source
  "curation-jobs",
  "external-calls",
  "embeddings",
  "images",
  "email",
  "mit-registry",
  // credential source
  "service-probes",
  "linear",
  "github-app",
  "langfuse",
  "slack-events",
  "worker-chromium",
  "resend-domain",
  "sentry-capture",
  // surface source
  "surface-assertions",
  // links-weekly source
  "social",
  "brand-other-urls",
  "stockists",
  "brand-channels",
  "events",
  "brand-images",
  "curated-products",
  "mdx",
  // search source
  "search-quality",
  // backlog source
  "backlog-health",
  // agent source — none declared yet; future detectors will go here
] as const;

export type DetectorName = (typeof DETECTOR_NAMES)[number];

// ---------------------------------------------------------------------------
// Detector → source mapping.
// ---------------------------------------------------------------------------

export const DETECTOR_SOURCE: Record<DetectorName, HealthSource> = {
  // link
  "link-health": "link",
  "link-cleanup": "link",
  // directory
  "brand-invariants": "directory",
  "brand-review": "directory",
  "trail-supply": "directory",
  "database-health": "directory",
  dependabot: "directory",
  // sentry
  "sentry-triage": "sentry",
  // quality
  vitest: "quality",
  knip: "quality",
  "knip-fix": "quality",
  // cron
  "cron-health": "cron",
  // pipeline
  "curation-jobs": "pipeline",
  "external-calls": "pipeline",
  embeddings: "pipeline",
  images: "pipeline",
  email: "pipeline",
  "mit-registry": "pipeline",
  // credential
  "service-probes": "credential",
  linear: "credential",
  "github-app": "credential",
  langfuse: "credential",
  "slack-events": "credential",
  "worker-chromium": "credential",
  "resend-domain": "credential",
  "sentry-capture": "credential",
  // surface
  "surface-assertions": "surface",
  // links-weekly
  social: "links-weekly",
  "brand-other-urls": "links-weekly",
  stockists: "links-weekly",
  "brand-channels": "links-weekly",
  events: "links-weekly",
  "brand-images": "links-weekly",
  "curated-products": "links-weekly",
  mdx: "links-weekly",
  // search
  "search-quality": "search",
  // backlog
  "backlog-health": "backlog",
};

// ---------------------------------------------------------------------------
// Schedule — nightly vs weekly.
// ---------------------------------------------------------------------------

type DetectorSchedule = "nightly" | "weekly";

export const DETECTOR_SCHEDULE: Record<DetectorName, DetectorSchedule> = {
  // link
  "link-health": "nightly",
  "link-cleanup": "nightly",
  // directory
  "brand-invariants": "nightly",
  "brand-review": "nightly",
  "trail-supply": "nightly",
  "database-health": "nightly",
  dependabot: "nightly",
  // sentry
  "sentry-triage": "nightly",
  // quality
  vitest: "nightly",
  knip: "nightly",
  "knip-fix": "nightly",
  // cron
  "cron-health": "nightly",
  // pipeline
  "curation-jobs": "nightly",
  "external-calls": "nightly",
  embeddings: "nightly",
  images: "nightly",
  email: "nightly",
  "mit-registry": "nightly",
  // credential
  "service-probes": "nightly",
  linear: "nightly",
  "github-app": "nightly",
  langfuse: "nightly",
  "slack-events": "nightly",
  "worker-chromium": "nightly",
  "resend-domain": "nightly",
  "sentry-capture": "nightly",
  // surface
  "surface-assertions": "nightly",
  // links-weekly
  social: "weekly",
  "brand-other-urls": "weekly",
  stockists: "weekly",
  "brand-channels": "weekly",
  events: "weekly",
  "brand-images": "weekly",
  "curated-products": "weekly",
  mdx: "weekly",
  // search
  "search-quality": "nightly",
  // backlog
  "backlog-health": "nightly",
};

/**
 * Day of the week (0 = Sunday, 6 = Saturday) the weekly detectors run.
 * Saturday chosen to minimize noise from weekday deploys.
 *
 * Ceiling: a single weekday for all weekly detectors. If different detectors
 * need different days, split into a per-detector config.
 */
export const WEEKLY_RUN_WEEKDAY = 6; // Saturday

// ---------------------------------------------------------------------------
// Schedule helpers.
// ---------------------------------------------------------------------------

/**
 * Returns the detector names that are due on the given date string
 * (YYYY-MM-DD, interpreted as Asia/Taipei).
 *
 * Nightly detectors are always due. Weekly detectors are due only on
 * WEEKLY_RUN_WEEKDAY.
 */
export function isDueOn(dateStr: string): DetectorName[] {
  // Parse as Taipei date to get the correct weekday.
  // `new Date('YYYY-MM-DD')` parses as UTC midnight, but the health agent
  // passes a Taipei-local date. We append T00:00:00+08:00 to get the right
  // weekday.
  const [year, month, day] = dateStr.split("-").map(Number);
  const taipeiDate = new Date(Date.UTC(year, month - 1, day));
  const taipeiWeekday = taipeiDate.getUTCDay();

  const isWeeklyDay = taipeiWeekday === WEEKLY_RUN_WEEKDAY;

  return DETECTOR_NAMES.filter((name) => {
    const schedule = DETECTOR_SCHEDULE[name];
    if (schedule === "nightly") return true;
    if (schedule === "weekly") return isWeeklyDay;
    return false;
  });
}
