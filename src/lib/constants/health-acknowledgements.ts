/**
 * Acknowledged health debt — known findings the health agent should not
 * re-report. An acknowledged finding is still enqueued (so reconcile closes it
 * once its detector stops seeing it) but is neither ticketed nor sent to the
 * auto-fix routine.
 *
 * Every entry must name a ticket and an expiry (`until`, inclusive) so the
 * finding re-surfaces if the debt outlives its plan.
 *
 * Shortcut: code constant, so acknowledging needs a PR + promotion; move to a
 * health_acknowledgements table if entries need editing without a deploy.
 */

export type HealthAcknowledgement = {
  /** An exact fingerprint, or a prefix when it ends with `:`. */
  match: string;
  reason: string;
  /** Linear identifier that tracks the debt. */
  ticket: string;
  /** YYYY-MM-DD, inclusive. */
  until: string;
};

/** The trails DEV-1903 re-picks; their D11 release window is acknowledged below. */
const DEV_1903_TRAILS = [
  "small-space-reading-corner",
  "desk-setup",
  "everyday-table",
  "year-end-gifts",
  "everyday-carry",
] as const;

const DEV_1903_RELEASE_WINDOW_UNTIL = "2026-10-15";

/**
 * Temporary (D11 release window), scoped per trail so an orphaned selection on
 * any other trail still reports. Fingerprints are
 * `directory:<kind>:<trail>:<section>` (scripts/health-agent/trail-supply.ts).
 */
const DEV_1903_RELEASE_WINDOW_ACKNOWLEDGEMENTS: readonly HealthAcknowledgement[] = [
  ...DEV_1903_TRAILS.map((trail) => ({
    match: `directory:trail-orphaned-selection:${trail}:`,
    reason:
      "Temporary (D11 release window): production placements are applied before the trail MDX is promoted, so for a few nights the production report sees selections for sections it does not know yet.",
    ticket: "DEV-1903",
    until: DEV_1903_RELEASE_WINDOW_UNTIL,
  })),
  ...["trail-unnoted-placement", "trail-orphaned-note"].map((kind) => ({
    match: `directory:${kind}:small-space-reading-corner:`,
    reason:
      "Temporary (D11 release window): the published trail's MDX notes name the new picks while the environment still holds the old placements until the picks are applied.",
    ticket: "DEV-1903",
    until: DEV_1903_RELEASE_WINDOW_UNTIL,
  })),
];

export const HEALTH_ACKNOWLEDGEMENTS: readonly HealthAcknowledgement[] = [
  {
    match: "directory:trail-empty-section:",
    reason: "Five live trails have no curated products in production (known debt).",
    ticket: "DEV-1903",
    until: "2026-12-31",
  },
  ...DEV_1903_RELEASE_WINDOW_ACKNOWLEDGEMENTS,
];

/**
 * The acknowledgement covering `fingerprint` on `today` (YYYY-MM-DD), if any.
 * ISO dates compare correctly as strings.
 */
export function isAcknowledged(
  fingerprint: string,
  today: string,
  list: readonly HealthAcknowledgement[] = HEALTH_ACKNOWLEDGEMENTS,
): HealthAcknowledgement | undefined {
  return list.find(
    (entry) =>
      today <= entry.until &&
      (entry.match.endsWith(":")
        ? fingerprint.startsWith(entry.match)
        : fingerprint === entry.match),
  );
}
