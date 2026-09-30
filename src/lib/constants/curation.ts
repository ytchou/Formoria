/**
 * Fixed sentinel reviewer id for automated curation decisions.
 *
 * Stored in `brand_submissions.reviewed_by` when the curation agent (not a
 * human admin) rejects a submission. It is deliberately NOT a row in
 * `auth.users` — nothing may resolve it to a user profile. Treat any
 * submission carrying this id as "reviewed by the pipeline".
 */
export const CURATION_AGENT_REVIEWER_ID =
  "1b19250d-2b67-46d3-ab5a-ef2baa996f5b";

/**
 * curation-worker runs as a Railway cron one-shot every 6 hours. A newest
 * `trigger = 'cron'` job older than this means at least one scheduled run
 * was missed (6h cadence + 1h grace for boot and queue time).
 */
export const CURATION_CRON_MAX_GAP_MS = 7 * 60 * 60_000;

/**
 * A due pending job that has waited longer than this while no job is
 * running is stranded: the manual cron run ("Run now") that dispatch fires
 * should have claimed it within minutes, since each run drains due jobs on
 * start. Kept far below the 6h cadence so a lost dispatch surfaces before
 * the next scheduled run would silently pick the job up.
 */
export const CURATION_STRANDED_PENDING_MS = 15 * 60_000;
