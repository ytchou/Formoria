export const KNIP_VERSION = "6.23.0" as const;

export const KNIP_KNOWN_NOISE = [
  {
    kind: "files",
    reason:
      "Vitest's server-only module alias fixture is not a production entry.",
    signature: "src/test/server-only.ts",
  },
  {
    kind: "binaries",
    reason:
      "The OCR helper documents tesseract as an optional developer tool, not a repository dependency.",
    signature: "tesseract",
  },
  {
    file: "src/lib/adapters/alerting/sentry.ts",
    kind: "exports",
    reason:
      "Used by src/lib/services/__tests__/job-alerts.test.ts through a namespace import (sentry.resetSentryAdapterForTests()), which knip does not resolve to the member.",
    signature: "resetSentryAdapterForTests",
  },
  {
    file: "src/lib/adapters/alerting/slack.ts",
    kind: "exports",
    reason:
      "Used by src/lib/services/__tests__/job-alerts.test.ts through a namespace import (slack.resetSlackAdapterForTests()), which knip does not resolve to the member.",
    signature: "resetSlackAdapterForTests",
  },
  {
    file: "src/lib/constants/brand-images.ts",
    kind: "duplicates",
    reason:
      "DRAFT_PARK_SORT_ORDER is deliberately derived from MAX_BRAND_IMAGE_SELECTION and documented as such; knip reports equal values as duplicates.",
    signature: "MAX_BRAND_IMAGE_SELECTION, DRAFT_PARK_SORT_ORDER",
  },
] as const;

export type KnipKnownNoiseKind = (typeof KNIP_KNOWN_NOISE)[number]["kind"];

/**
 * `file` narrows an entry to one location. A bare symbol name is not unique
 * across a repository, and an unscoped suppression would silently hide a
 * genuinely dead export that happens to share a name with a known false
 * positive. Entries without `file` are deliberately global — a missing binary
 * is not attached to any one source file.
 */
export function isKnownKnipNoise(
  kind: string,
  signature: string,
  file?: string,
): boolean {
  return KNIP_KNOWN_NOISE.some((entry) => {
    if (entry.kind !== kind || entry.signature !== signature) return false;
    const scoped = (entry as { file?: string }).file;
    return scoped === undefined || scoped === file;
  });
}
