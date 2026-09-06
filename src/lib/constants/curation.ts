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
