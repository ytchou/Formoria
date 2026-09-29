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

export const HEALTH_ACKNOWLEDGEMENTS: readonly HealthAcknowledgement[] = [
  {
    match: "directory:trail-empty-section:",
    reason: "Five live trails have no curated products in production (known debt).",
    ticket: "DEV-1903",
    until: "2026-12-31",
  },
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
