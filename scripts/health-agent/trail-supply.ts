import type {
  TrailSupplyEmptySection,
  TrailSupplyOrphanedSelection,
  TrailSupplyReport,
} from "@/lib/services/trail-supply-report";

import { compareText } from "./brand-review";
import {
  stableFingerprint,
  type HealthFinding,
  type JsonValue,
} from "./contracts";
import type { HealthCollectorArtifact } from "./orchestrator";

/**
 * The agent-side half of the nightly trail supply-decay observation (DEV-1520).
 *
 * REPORT ONLY. Every finding here is `disposition: "report_only"`, so the
 * repair orchestrator skips it (`orchestrator.ts` eligibility filter) and only
 * Linear ever sees it. Nothing on a public surface changes because of a
 * finding: a decayed trail stays published, indexed, in the sitemap, on the hub
 * and on the homepage. DEV-1518 removed the render-time supply predicates on
 * purpose and this tree must never grow them back.
 * See docs/decisions/2026-08-20-trail-supply-decay-is-reported-not-enforced.md.
 *
 * The agent gains NO database reach for this. It reads one HTTP endpoint
 * (`/api/cron/trail-supply`) whose summary the app owns, exactly the division
 * of labour the `link` detector already uses. The evaluator below is pure —
 * summary in, findings out — so the only I/O in the whole path is the fetch in
 * `workflow-runtime.ts`.
 */

/**
 * Trail supply is an editorial judgement: whether a thin section should be
 * refilled, rewritten, or retired is the founder's call, never an automated
 * patch. This reason is what keeps the finding out of auto-repair AND eligible
 * for a Linear ticket.
 */
const TRAIL_SUPPLY_HUMAN_REASON = "Trail supply is editorial and human-owned";

/**
 * The routine name on the artifact. Deliberately NOT a `HealthRoutine`: this
 * collector never loads through `loadCollectorArtifact`, and widening
 * `HEALTH_ROUTINES` would add a sixth key to every exhaustive routine record.
 * Its findings ride the merged `directory-health` artifact instead, which is
 * why every one of them carries `source: "directory"`.
 */
const TRAIL_SUPPLY_ROUTINE = "trail-supply";

/**
 * A summary that observed nothing. Shared with the collector so the "the
 * endpoint could not be read" artifact and the "the app reported dormancy"
 * artifact are byte-identical apart from `failures`.
 */
export const UNOBSERVED_TRAIL_SUPPLY: TrailSupplyReport = {
  emptySections: [],
  orphanedSelections: [],
  readUnavailable: true,
  selectionsObserved: 0,
  trailsObserved: 0,
};

/**
 * The collector artifact shape, expressed as the two intended differences from
 * `HealthCollectorArtifact` rather than as a second copy of its field list.
 *
 * `routine` widens to `string` because `TRAIL_SUPPLY_ROUTINE` is deliberately
 * not a `HealthRoutine` (see above), and `snapshot` narrows to required because
 * the observation counts are the whole point of this artifact and must never be
 * optional here.
 */
export type TrailSupplyArtifact = Omit<
  HealthCollectorArtifact,
  "routine" | "snapshot"
> & {
  routine: string;
  snapshot: Record<string, JsonValue>;
};

/**
 * The per-run finding ceiling.
 *
 * `MAX_ARTIFACT_BYTES` and `MAX_RESULT_BYTES` are both 512KB, so findings that
 * just fit this artifact's own write check can still push the MERGED
 * `directory-health.json` past `readBoundedJson` — and Stage 3 then discards
 * the directory, brand AND trail findings behind one generic
 * `collector_artifact_unavailable`. Trail supply is bounded by distinct
 * (trail_slug, section_key) pairs in a column with no FK and no CHECK, which is
 * the very reason this detector exists, so the bound is enforced here.
 *
 * Ceiling: 500 findings, roughly 200KB of merged JSON against a 512KB limit and
 * an order of magnitude above any plausible real trail count. Raise it only
 * together with the two byte limits in `orchestrator.ts`.
 */
const MAX_TRAIL_SUPPLY_FINDINGS = 500;

export interface TrailSupplyArtifactInput {
  collectedAt: string;
  /** Recorded verbatim on the artifact; the Stage 5 gate reads the array. */
  failures?: readonly string[];
  mode?: string;
  report: TrailSupplyReport;
}

function trailSupplyFinding(
  kind: string,
  trailSlug: string,
  sectionKey: string,
  title: string,
  evidence: Record<string, JsonValue>,
): HealthFinding {
  return {
    disposition: "report_only",
    evidence,
    // Trail + section, never the product: ten products stranded in one dropped
    // section are one thing for a human to fix, not ten identical tickets.
    fingerprint: stableFingerprint(
      "directory",
      kind,
      `${trailSlug}:${sectionKey}`,
    ),
    humanReason: TRAIL_SUPPLY_HUMAN_REASON,
    mergePolicy: "human",
    severity: "medium",
    source: "directory",
    title,
  };
}

function emptySectionFinding(section: TrailSupplyEmptySection): HealthFinding {
  return trailSupplyFinding(
    "trail-empty-section",
    section.trailSlug,
    section.sectionKey,
    "Trail section promises a slate it no longer has",
    {
      sectionKey: section.sectionKey,
      // The title is what the visitor actually reads above the empty space, so
      // it rides the finding; the key alone means nothing to the founder.
      sectionTitle: section.sectionTitle,
      trailSlug: section.trailSlug,
    },
  );
}

/**
 * `unknown_trail` and `undeclared_section` are different repairs — one
 * retargets the row, the other re-declares or retires the section — so they
 * must be distinguishable on the Linear ticket.
 *
 * The TITLE is what carries that distinction, because the title is the only
 * per-finding text any adapter renders: `groupedLinearDescription`
 * (`adapters.ts`) groups by title and prints `<count> x <title> - <samples>`,
 * and no adapter renders `finding.evidence` at all. The reason still rides the
 * evidence for the artifact and the audit trail, but a human reading the ticket
 * learns which repair to make from the title.
 */
const ORPHAN_TITLES: Readonly<
  Record<TrailSupplyOrphanedSelection["reason"], string>
> = {
  undeclared_section:
    "Trail selection points at a section the trail no longer declares",
  unknown_trail: "Trail selection points at a trail that no longer exists",
};

function orphanedSelectionFinding(
  selection: TrailSupplyOrphanedSelection,
): HealthFinding {
  return trailSupplyFinding(
    "trail-orphaned-selection",
    selection.trailSlug,
    selection.sectionKey,
    ORPHAN_TITLES[selection.reason],
    {
      reason: selection.reason,
      sectionKey: selection.sectionKey,
      trailSlug: selection.trailSlug,
    },
  );
}

/**
 * Turns one observation into findings. Pure: no I/O, no clock, no env.
 *
 * The `readUnavailable` guard is the most important line in the file and it
 * runs BEFORE any mapping. A dormant or malformed summary that still carries
 * populated arrays must produce nothing — the nightly run can execute against a
 * checkout with no `content/trails/` directory at all, where every active
 * selection would otherwise diff as an orphan and an orphan storm would become
 * the normal nightly state.
 */
export function evaluateTrailSupply(
  report: TrailSupplyReport,
): HealthFinding[] {
  if (report.readUnavailable) return [];

  return [
    ...report.emptySections.map(emptySectionFinding),
    ...report.orphanedSelections.map(orphanedSelectionFinding),
  ].sort((left, right) => compareText(left.fingerprint, right.fingerprint));
}

/**
 * Builds the collector artifact the workflow's jq merge reads.
 *
 * `status` is `skipped`, never `failed`, when nothing was observed. Dormancy is
 * the EXPECTED production state — scheduled runs check out `main`, which has no
 * `content/trails/` — and a nightly `failed` would be alarm fatigue by
 * construction. The observation counts survive regardless of the finding count
 * so "looked at 3 trails and 9 selections, found nothing" stays distinguishable
 * from "looked at nothing" without reading a step log.
 */
export function trailSupplyArtifact(
  input: TrailSupplyArtifactInput,
): TrailSupplyArtifact {
  const { report } = input;
  const evaluated = evaluateTrailSupply(report);
  const findings = evaluated.slice(0, MAX_TRAIL_SUPPLY_FINDINGS);
  // Truncation must never read as a clean run. It reaches BOTH the evidence
  // (the count a human sees in the digest) and `failures[]` (the array the
  // Stage 5 gate reads), so neither surface can show a complete-looking result
  // built from a partial list.
  const omittedFindings = evaluated.length - findings.length;
  // A dormant run reports nothing, so it must also COUNT nothing: a malformed
  // payload carrying both the flag and populated arrays would otherwise publish
  // decay counts it was not allowed to turn into findings.
  const observed = report.readUnavailable ? UNOBSERVED_TRAIL_SUPPLY : report;
  const observation: Record<string, JsonValue> = {
    emptySectionCount: observed.emptySections.length,
    findingCount: findings.length,
    ...(omittedFindings > 0 ? { findingsOmitted: omittedFindings } : {}),
    ...(input.mode ? { mode: input.mode } : {}),
    orphanedSelectionCount: observed.orphanedSelections.length,
    readUnavailable: report.readUnavailable,
    selectionsObserved: observed.selectionsObserved,
    trailsObserved: observed.trailsObserved,
  };
  const failures = [
    ...(input.failures ?? []),
    ...(omittedFindings > 0 ? ["trail_supply_findings_truncated"] : []),
  ];
  const failure = failures.at(0);

  return {
    collectedAt: input.collectedAt,
    evidence: observation,
    ...(failure ? { failure } : {}),
    failures,
    findings,
    routine: TRAIL_SUPPLY_ROUTINE,
    skippedActions: report.readUnavailable ? ["trail_supply_observation"] : [],
    snapshot: observation,
    status: report.readUnavailable ? "skipped" : "success",
    version: 1,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`trail_supply_${field}_invalid`);
  }
  return value;
}

function countField(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`trail_supply_${field}_invalid`);
  }
  return value;
}

function arrayField(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`trail_supply_${field}_invalid`);
  return value;
}

/**
 * Narrows the endpoint's JSON to the summary contract, throwing on anything
 * else. The collector turns a throw into a `skipped` artifact with a recorded
 * failure, so a contract drift between this tree and
 * `src/lib/services/trail-supply-report.ts` reports itself instead of quietly
 * emitting half a report.
 */
export function parseTrailSupplyReport(value: unknown): TrailSupplyReport {
  if (!isRecord(value)) throw new Error("trail_supply_summary_invalid");
  if (typeof value.readUnavailable !== "boolean") {
    throw new Error("trail_supply_read_unavailable_invalid");
  }

  return {
    emptySections: arrayField(value.emptySections, "empty_sections").map(
      (entry) => {
        if (!isRecord(entry)) throw new Error("trail_supply_section_invalid");
        return {
          sectionKey: stringField(entry.sectionKey, "section_key"),
          sectionTitle: stringField(entry.sectionTitle, "section_title"),
          trailSlug: stringField(entry.trailSlug, "trail_slug"),
        };
      },
    ),
    orphanedSelections: arrayField(
      value.orphanedSelections,
      "orphaned_selections",
    ).map((entry) => {
      if (!isRecord(entry)) throw new Error("trail_supply_selection_invalid");
      if (
        entry.reason !== "unknown_trail" &&
        entry.reason !== "undeclared_section"
      ) {
        throw new Error("trail_supply_orphan_reason_invalid");
      }
      return {
        reason: entry.reason,
        sectionKey: stringField(entry.sectionKey, "section_key"),
        trailSlug: stringField(entry.trailSlug, "trail_slug"),
      };
    }),
    readUnavailable: value.readUnavailable,
    selectionsObserved: countField(
      value.selectionsObserved,
      "selections_observed",
    ),
    trailsObserved: countField(value.trailsObserved, "trails_observed"),
  };
}

/**
 * The non-throwing form of `parseTrailSupplyReport`, for the one caller that
 * has to record schema validity BEFORE it decides what to throw.
 *
 * The audit record is written from the response the collector actually
 * received, so it cannot be derived from `response.ok` alone: an intermediary
 * (a Cloudflare interstitial, a Railway edge error page, the Next.js error
 * shell) answers HTTP 200 with an HTML body, and an audit claiming
 * `schemaValid: true` for that body would be the only distinguishing signal in
 * the uploaded artifact telling a lie.
 */
export function isTrailSupplyReport(value: unknown): boolean {
  try {
    parseTrailSupplyReport(value);
    return true;
  } catch {
    return false;
  }
}
