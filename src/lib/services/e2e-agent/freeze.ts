/**
 * Freeze node — extract and deduplicate failures from a test runner result.
 *
 * Delegates to `@/lib/services/e2e-selfheal/incident` for canonical hashing
 * and set construction. This wrapper adds deduplication (the incident module
 * throws on duplicates) and maps the runner's `error` field to `reason`.
 */

import {
  freezeFailures as freezeIncident,
  type FrozenFailureSet,
  type SourceFailure,
} from "@/lib/services/e2e-selfheal/incident";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RunResult = {
  failures: ReadonlyArray<{
    file: string | null;
    title: string;
    project: string;
    error?: string;
  }>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Canonical key for deduplication — mirrors incident.ts `canonicalFailure`. */
function canonicalKey(f: {
  file: string | null;
  title: string;
  project: string;
}): string {
  const file = f.file?.trim() || null;
  const title = f.title.trim();
  const project = f.project.trim();
  return JSON.stringify({ file, title, project });
}

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

/**
 * Extract failures from a runner result, deduplicate by canonical fingerprint,
 * and return a frozen failure set.
 */
export function freezeFailures(runResult: RunResult): FrozenFailureSet {
  const seen = new Set<string>();
  const unique: SourceFailure[] = [];

  for (const f of runResult.failures) {
    const key = canonicalKey(f);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({
      file: f.file,
      title: f.title,
      project: f.project,
      ...(f.error?.trim() ? { reason: f.error.trim() } : {}),
    });
  }

  return freezeIncident(unique);
}
