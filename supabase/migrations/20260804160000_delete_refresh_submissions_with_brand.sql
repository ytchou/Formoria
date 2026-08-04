begin;

-- Deleting a brand that was ever refreshed always failed with
-- `P0001 Refresh snapshot is immutable` (DEV-1331). Two rules contradict each
-- other and the trigger wins:
--
--   * `brand_submissions.brand_id` is `on delete set null` (20260626150000), so
--     a person's submission outlives the brand it produced.
--   * `protect_refresh_snapshot` is a BEFORE UPDATE guard that raises whenever
--     `brand_id` changes on an `intent = 'refresh'` row — and the FK action is
--     exactly such an update, so it can never succeed. No status condition, so a
--     rejected refresh vetoes the delete just as a pending one does.
--
-- The fix keeps both rules and removes the collision: a refresh submission is a
-- system-generated snapshot of one brand, not a record of anyone's contribution,
-- so it dies with its brand instead of being orphaned. Orphaning is not merely
-- untidy — a pending row with `brand_id is null` reads as a NEW-brand submission
-- to the curation queue (`lib/services/curation-jobs.ts`) while approval still
-- routes on `intent = 'refresh'` (`lib/services/submissions.ts`), so a surviving
-- row would be re-enriched as a brand that was deliberately retired.
--
-- BEFORE DELETE, so the rows are gone before the FK action runs. `security
-- invoker` matches `protect_refresh_snapshot`; `brands` has no delete policy, so
-- only service_role deletes brands and RLS never applies.

create or replace function public.delete_refresh_submissions_with_brand()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.brand_submissions
  where brand_id = old.id
    and intent = 'refresh';
  return old;
end;
$$;

drop trigger if exists delete_refresh_submissions_with_brand on public.brands;
create trigger delete_refresh_submissions_with_brand
before delete on public.brands
for each row execute function public.delete_refresh_submissions_with_brand();

revoke all on function public.delete_refresh_submissions_with_brand() from public;

commit;
