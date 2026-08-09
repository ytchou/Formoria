-- DEV-1405: raise the brand indexability bar and expose it to the ordering path.
--
-- Decouples "in the directory" from "submitted to Google". `seo_promoted` is the
-- content-depth bar; the sitemap uses it for membership and the directory browse
-- query uses it to order promoted brands onto the first pages, where internal
-- links actually drive crawl priority.
--
-- Deliberately NOT wired to robots meta. `getBrandIndexability` keeps the old low
-- bar for `noindex`, so a wrong threshold here costs delayed discovery, never a
-- page that cannot rank. See the ticket's Part 2.3 decision record.
--
-- The FAQ arm of the bar lives in `brand_faq_entries`, which a generated column
-- cannot reach — hence the trigger-maintained `model_faq_count` counter, which
-- brings the signal onto the brands row so the bar stays one declarative
-- expression with no TS/SQL drift.

-- 1. Counter column. Default 0 so the table is valid before the backfill runs.
alter table public.brands
  add column model_faq_count integer not null default 0;

comment on column public.brands.model_faq_count is
  'Count of model-authored brand_faq_entries rows. Maintained by sync_brand_model_faq_count(); do not write directly.';

-- 2. Keep the counter live.
create or replace function public.recount_brand_model_faq(target_brand_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  -- `is distinct from` is load-bearing, not an optimisation: brands carries an
  -- unconditional `set_updated_at` BEFORE UPDATE trigger, and brands.updated_at
  -- feeds <lastmod> in the sitemap. Without this guard, re-running FAQ
  -- enrichment that produces an identical count would restamp the brand as
  -- freshly modified and lie to the crawler.
  update public.brands b
  set model_faq_count = c.n
  from (
    select count(*)::integer as n
    from public.brand_faq_entries
    where brand_id = target_brand_id and source = 'model'
  ) as c
  where b.id = target_brand_id
    and b.model_faq_count is distinct from c.n;
$$;

create or replace function public.sync_brand_model_faq_count()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Branch explicitly on TG_OP rather than guarding OLD/NEW inside a CASE.
  -- PL/pgSQL substitutes every referenced record field as a parameter when it
  -- prepares the expression, so merely naming OLD in an INSERT trigger raises
  -- "record 'old' is not assigned yet" even when the branch is never taken.
  if tg_op = 'INSERT' then
    perform public.recount_brand_model_faq(new.brand_id);
  elsif tg_op = 'DELETE' then
    perform public.recount_brand_model_faq(old.brand_id);
  else
    perform public.recount_brand_model_faq(new.brand_id);
    if old.brand_id is distinct from new.brand_id then
      perform public.recount_brand_model_faq(old.brand_id);
    end if;
  end if;

  return null;
end;
$$;

revoke all on function public.recount_brand_model_faq(uuid) from public, anon, authenticated;
revoke all on function public.sync_brand_model_faq_count() from public, anon, authenticated;

create trigger brand_faq_entries_sync_model_count
  after insert or update or delete on public.brand_faq_entries
  for each row execute function public.sync_brand_model_faq_count();

-- 3. Backfill, with brands_updated_at suppressed.
--
-- Ordering matters: this runs BEFORE the generated column is added, so
-- seo_promoted is correct the moment it exists rather than being computed false
-- for everyone and then recomputed.
--
-- The disable/enable wrapper is the whole point of this step. Backfilling ~631
-- brands would otherwise stamp updated_at = now() on all of them, and both
-- /brands/<slug> and every /categories/* <lastmod> derive from that column — the
-- first sitemap after this migration would tell Google the entire catalogue
-- changed today.
alter table public.brands disable trigger brands_updated_at;

update public.brands b
set model_faq_count = c.n
from (
  select brand_id, count(*)::integer as n
  from public.brand_faq_entries
  where source = 'model'
  group by brand_id
) as c
where b.id = c.brand_id
  and b.model_faq_count is distinct from c.n;

alter table public.brands enable trigger brands_updated_at;

-- 4. The bar itself.
--
-- Excludes `status` on purpose: the column means "meets the content-depth bar"
-- and nothing else. Every caller already filters status = 'approved'.
--
-- Never NULL — every operand is coalesce-guarded and model_faq_count is NOT NULL.
-- That matters downstream: Postgres ORDER BY ... DESC implies NULLS FIRST, so a
-- nullable flag would float unknown rows onto page 1.
alter table public.brands
  add column seo_promoted boolean
  generated always as (
    char_length(coalesce(description, '')) >= 200
    and coalesce(
      nullif(btrim(coalesce(purchase_website, '')), ''),
      nullif(btrim(coalesce(purchase_pinkoi, '')), ''),
      nullif(btrim(coalesce(purchase_shopee, '')), ''),
      nullif(btrim(coalesce(purchase_myship, '')), '')
    ) is not null
    and (
      nullif(btrim(coalesce(city, '')), '') is not null
      or model_faq_count >= 3
    )
  ) stored;

comment on column public.brands.seo_promoted is
  'DEV-1405 content-depth bar: description >= 200 chars AND >=1 purchase channel AND (city OR >=3 model FAQ entries). Gates sitemap membership and directory ordering. Deliberately not wired to robots meta.';

-- 5. Serve the promoted-first directory ordering.
create index brands_seo_promoted_id_idx
  on public.brands (seo_promoted desc, id)
  where status = 'approved';
