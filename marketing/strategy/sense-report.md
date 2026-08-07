# Content Sense Report — formoria

**Run date:** 2026-08-07

## Published items

Queried `content_items` for `project=formoria`, `status=published`: **0 rows returned.**

No published items exist yet, so no PostHog pageview metrics were fetched and no `metrics` updates were written.

Note: `NEXT_PUBLIC_POSTHOG_KEY` and `POSTHOG_PERSONAL_API_KEY` are also not configured in this environment, so PostHog fetches would have been skipped regardless of item count.

## Ready items past target_date

Queried `content_items` for `project=formoria`, `status=ready`: **0 rows returned.**

No Todoist digest task was created (nothing to digest). Also note: `TODOIST_API_TOKEN` is not set in this environment, so task creation would have been skipped silently even if ready items had been found.

## Current pipeline snapshot (for context only)

No items are `published` or `ready`. All 11 formoria items currently sit in earlier stages:

| Status | Count |
|---|---|
| proposed | 6 |
| review | 3 |
| in-progress | 1 |

Three `review`-status items have `target_date` already in the past relative to today (2026-08-07): `8fb0549b` (2026-07-23), `eaf05c6e` (2026-07-24), `cd08beb1` (2026-07-25). These aren't `ready` so they fall outside this run's Todoist-digest scope, but they may be worth a manual look since their target dates have lapsed while still in review.

## Action items

- Nothing to do this run — no published or ready items.
- Once PostHog credentials are configured, re-run to backfill metrics for any items published after this report.
