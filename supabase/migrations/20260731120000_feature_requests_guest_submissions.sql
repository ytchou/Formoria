begin;

-- The board is opening to guests. Requiring an account to post is friction a
-- cold-start board cannot afford, and the sibling /submit flow already takes
-- anonymous submissions with an optional email, so `guest_email` gives a guest
-- the same "tell me when you reply" option. It is set only when `submitted_by`
-- is null: a signed-in submitter's address already lives on their account.
alter table public.feature_requests add column guest_email text;

comment on column public.feature_requests.guest_email is
  'Reply-to address for a guest submission. Internal only: never selected into the public board projection, and only ever set when submitted_by is null.';

-- Nothing has ever stopped two identical titles on this table, which left the
-- 23505 -> already_submitted mapping in the service layer as dead code. Guest
-- writes make dedup load-bearing, so the index that mapping always assumed now
-- exists. Partial on `merged_into_id is null` so merged tombstones keep their
-- titles instead of blocking a resubmission of the same idea.
--
-- No dedup pass runs first: the board has no duplicate unmerged titles today.
-- If a push ever fails here with 23505, merge the duplicates through the admin
-- queue and re-run — do not widen the index.
create unique index feature_requests_unique_title_idx
  on public.feature_requests (lower(btrim(title)))
  where merged_into_id is null;

commit;
