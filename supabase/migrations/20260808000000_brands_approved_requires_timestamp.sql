-- DEV-1392: make `status='approved' AND approved_at IS NULL` unrepresentable.
--
-- The nightly health agent's directory-health collector found 32 approved brands
-- with no approval timestamp. They were bulk-insert residue, not queue activity:
-- 24 shared one identical created_at (2026-06-06 03:05:21.267736Z), 7 landed
-- within 70 seconds on 2026-06-18, 1 on 2026-06-17. Every approval from
-- 2026-05-18 through 2026-08-06 stamped correctly, so the live approval path was
-- never the problem — a bulk import simply bypassed the invariant.
--
-- The rows were backfilled with `created_at` (they were inserted already
-- approved, so creation time is the honest answer; `now()` would have asserted an
-- approval that never happened). This constraint stops the next import from
-- reintroducing the state, rather than relying on a nightly check to notice it
-- after the fact — the check went unread for weeks while the agent itself was
-- broken.
--
-- Phrased as `status <> 'approved' OR ...` so rows in every other status are
-- untouched and may keep a null timestamp.

alter table public.brands
  drop constraint if exists brands_approved_requires_timestamp;

alter table public.brands
  add constraint brands_approved_requires_timestamp
  check (status <> 'approved' or approved_at is not null);
