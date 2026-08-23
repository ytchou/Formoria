/**
 * The one date formatter for every `/admin` review queue.
 *
 * Six sibling queues had drifted into four variants (two without a `timeZone`,
 * one pinned to `zh-TW` on an English-only surface), so the same UTC instant
 * rendered as a different calendar day depending on which queue you opened.
 * `Asia/Taipei` is fixed rather than locale-derived: the reviewed rows are
 * Taiwan-brand records and the SLA an admin reasons about is Taipei-local, so
 * the displayed day must not move with the reviewer's machine.
 *
 * It takes the ISO timestamps queues hold, not a bare `YYYY-MM-DD` date.
 */
const REVIEW_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "Asia/Taipei",
});

export function formatReviewDate(iso: string): string {
  return REVIEW_DATE_FORMAT.format(new Date(iso));
}
