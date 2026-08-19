-- Split the `kids-pets` L1 into `kids` and `pets` (DEV-1510, Task 4).
--
-- The valid L1 slug set is enumerated in FOUR independent places that no
-- compiler, type checker or test relates to one another:
--
--   1/4  brands_category_check                (20260818150000:39-46)
--   2/4  curated_products_category_check      (20260813120000:30-33, renamed
--                                              in place by 20260819120000:55-95)
--   3/4  the BODY of approve_submission(uuid,uuid,jsonb)
--   4/4  the BODY of apply_brand_refresh_with_protected_location_gate(uuid,uuid)
--
-- Patching only the two CHECK constraints produces a schema that accepts a
-- `pets` brand at insert and then rejects it at approval and at refresh — a
-- failure that surfaces hours later inside an admin queue, with no type error
-- and no build break. All four move here or none do.
--
-- `crafts` STAYS in every list. DEV-1507 retires it; DEV-1510 does not. 19 e2e
-- files seed `category: 'crafts'` (`e2e/helpers/seed.ts:76`,
-- `owned-brand.ts:41`) and `STORY_TAGS` derives from `L1_CATEGORIES`.
--
-- ---------------------------------------------------------------------------
-- DUMP PROVENANCE — sites 3/4 and 4/4 have NO source file.
-- ---------------------------------------------------------------------------
--
-- Both function bodies are hand-patched objects that exist only in the live
-- catalog; the migration files that first created them
-- (20260805120000_add_purchase_myship.sql:162-166 and :506-510) are stale and
-- the dumps under docs/reports/ are staler still. The bodies below were
-- re-materialized live from staging (`xwkigpvnheecihpxyvsl`) at
-- **2026-08-19 07:54:24 UTC**, with:
--
--   psql "$SUPABASE_DB_URL" -At -c "
--     select p.oid::regprocedure::text,
--            md5(pg_get_functiondef(p.oid)),
--            length(pg_get_functiondef(p.oid))
--     from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public'
--       and p.proname in (
--         'approve_submission',
--         'apply_brand_refresh_with_protected_location_gate'
--       )
--     order by 1"
--
-- which returned:
--
--   apply_brand_refresh_with_protected_location_gate(uuid,uuid)
--     | 2206671cb5ec38c303ffd1cfdbbd9c3c | 14909 bytes
--   approve_submission(uuid,uuid,jsonb)
--     | e5d67079044a55e8d4c7093a29d888c0 |  8484 bytes
--
-- Those two md5s are asserted below BEFORE anything is rewritten, so an
-- unexpected live deploy fails here rather than silently re-materializing a
-- body from a stale assumption. This migration never re-types either body: it
-- reads each one back with pg_get_functiondef at run time and anchor-patches
-- exactly one literal, the same shape as
-- 20260819090000_contract_category_subcategory_vocabulary.sql:7-52.
--
-- ---------------------------------------------------------------------------
-- ORDERING IS LOAD-BEARING
-- ---------------------------------------------------------------------------
--
--   1. Against the ledger: 20260818150000, 20260819120000 and 20260819130000
--      must already be applied — the asserted fingerprints are the post-
--      DEV-1502 bodies, and `curated_products.category` does not exist under
--      its current name before 20260819120000.
--   2. Inside this file: `brands_category_check` is DROPPED, the four rows
--      still carrying `kids-pets` are reassigned, and only then is the 13-slug
--      CHECK added. Adding first would fail validation on those four rows.
--
-- ---------------------------------------------------------------------------
-- ROW REASSIGNMENT — the plan said "no backfill needed"; staging disagreed
-- ---------------------------------------------------------------------------
--
-- Correct for `kids` and `pets`: no row anywhere carries either slug yet. But
-- four approved brands still carry the retired `kids-pets`, and a CHECK that
-- rejects it cannot be added while they exist. Their pre-migration value was
-- `kids-pets` in every case, so the reverse of this block is a single
-- `update public.brands set category = 'kids-pets' where slug in (...)`.
--
-- The four, with the evidence for each side of the split:
--
--   1woof         -> pets   custom figurines/keychains sculpted from a
--                           customer's own cat or dog photo; the buyer is a
--                           pet owner, the subject is the pet
--   2angels       -> kids   silicone baby feeding-ware: suction bowls,
--                           divided plates, bibs, weaning storage
--   angle-wave    -> pets   corrugated-board pet furniture: cat scratchers,
--                           scratching posts, cat houses, pet pens
--   softie-bunny  -> kids   illustrated character IP extended into plush toys
--                           and charms
--
-- The mapping is explicit rather than derived from `subcategories`, because a
-- derived rule would launder the same editorial judgement behind a heuristic
-- that silently mis-files the next brand. A `kids-pets` row outside the
-- mapping raises instead of being defaulted.
--
-- `brands_search_vector_trigger` fires on `category` and `brands_updated_at`
-- bumps `updated_at`. Both are LEFT ENABLED on purpose: unlike DEV-1503's
-- representation-only rewrite, this is a genuine editorial reassignment of four
-- brands, so a refreshed search document and a moved timestamp are correct.
--
-- ---------------------------------------------------------------------------
-- purchase_channel_sql_surface() RE-PIN
-- ---------------------------------------------------------------------------
--
-- That accessor (20260805120500:17-59) snapshots both function bodies plus
-- `brand_field_corrections_field_check`. It needs no edit: it names the four
-- functions and reads them through `pg_get_functiondef` at CALL time, so it
-- re-materializes the patched bodies automatically. What it does need is
-- proof, so the closing block calls it and asserts the returned bodies carry
-- the 13-slug list and no longer carry `kids-pets`. Without that call the
-- re-pin is an assumption; with it, the meta-guard the parity suite reads is
-- verified inside the same transaction that moved the list.

begin;

-- Re-created here: 20260819090000 and 20260819130000 each drop both helpers at
-- their own tail.
create or replace function public.dev1503_contract_assert_function(
  p_signature regprocedure,
  p_expected_md5 text
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_definition text;
begin
  v_definition := pg_get_functiondef(p_signature);
  if md5(v_definition) is distinct from p_expected_md5 then
    raise exception
      'DEV-1503 function fingerprint drift for %: expected %, got %',
      p_signature, p_expected_md5, md5(v_definition)
      using errcode = 'P0001';
  end if;
end;
$function$;

create or replace function public.dev1503_contract_replace_exact(
  p_definition text,
  p_legacy text,
  p_final text,
  p_expected_count integer
)
returns text
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_count integer;
begin
  v_count :=
    (length(p_definition) - length(replace(p_definition, p_legacy, '')))
    / nullif(length(p_legacy), 0);
  if v_count is distinct from p_expected_count then
    raise exception
      'DEV-1503 replacement drift for % -> %: expected %, got %',
      p_legacy, p_final, p_expected_count, v_count
      using errcode = 'P0001';
  end if;
  return replace(p_definition, p_legacy, p_final);
end;
$function$;

-- ===========================================================================
-- Site 1/4 — brands_category_check, plus the four-row reassignment it needs
-- ===========================================================================

alter table public.brands
  drop constraint if exists brands_category_check;

do $migration$
declare
  v_reassigned integer;
  v_orphans text;
begin
  update public.brands as b
  set category = mapping.target
  from (
    values
      ('1woof', 'pets'),
      ('2angels', 'kids'),
      ('angle-wave', 'pets'),
      ('softie-bunny', 'kids')
  ) as mapping (slug, target)
  where b.slug = mapping.slug
    and b.category = 'kids-pets';

  get diagnostics v_reassigned = row_count;

  -- Not an equality assertion: a staging restore that never had all four is a
  -- legitimate state, and failing on it would block the deploy for no reason.
  -- The load-bearing contract is the NEXT one — nothing may be left behind.
  raise notice 'DEV-1510 reassigned % brand(s) off kids-pets', v_reassigned;

  select string_agg(b.slug, ', ' order by b.slug)
  into v_orphans
  from public.brands as b
  where b.category = 'kids-pets';

  if v_orphans is not null then
    raise exception
      'DEV-1510 brand(s) still on the retired kids-pets L1 and absent from the mapping: %; classify each as kids or pets before deploying',
      v_orphans
      using errcode = 'P0001';
  end if;
end
$migration$;

alter table public.brands
  add constraint brands_category_check
  check (category in (
    'fashion', 'bags-accessories', 'jewelry', 'beauty', 'home',
    'food-drink', 'crafts', 'stationery', 'tech', 'outdoor',
    'fitness', 'kids', 'pets'
  ));

-- ===========================================================================
-- Site 2/4 — curated_products_category_check
-- ===========================================================================
--
-- 20260819120000 RENAMED this constraint rather than re-typing it, precisely so
-- the 12-slug predicate could not drift. That protection ends the moment the
-- vocabulary itself changes: a rename cannot add a slug. Drop and re-add is the
-- only option, and it is safe here because a CHECK carries no grants — unlike
-- DROP FUNCTION, which re-applies Supabase's default privileges to anon and
-- authenticated.

do $migration$
declare
  v_orphans text;
begin
  select string_agg(p.key, ', ' order by p.key)
  into v_orphans
  from public.curated_products as p
  where p.category = 'kids-pets';

  if v_orphans is not null then
    raise exception
      'DEV-1510 curated product(s) still on the retired kids-pets L1: %',
      v_orphans
      using errcode = 'P0001';
  end if;
end
$migration$;

alter table public.curated_products
  drop constraint if exists curated_products_category_check;

alter table public.curated_products
  add constraint curated_products_category_check
  check (category in (
    'fashion', 'bags-accessories', 'jewelry', 'beauty', 'home',
    'food-drink', 'crafts', 'stationery', 'tech', 'outdoor',
    'fitness', 'kids', 'pets'
  ));

-- ===========================================================================
-- Sites 3/4 and 4/4 — the two hand-patched function bodies
-- ===========================================================================

do $migration$
declare
  v_legacy_l1_list text;
  v_final_l1_list text;
  v_approve text;
  v_refresh text;
begin
  -- Fingerprints first: nothing is rewritten until both bodies match the
  -- 2026-08-19 07:54:24 UTC dump recorded in this file's header.
  perform public.dev1503_contract_assert_function(
    'public.approve_submission(uuid,uuid,jsonb)'::regprocedure,
    'e5d67079044a55e8d4c7093a29d888c0'
  );
  perform public.dev1503_contract_assert_function(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure,
    '2206671cb5ec38c303ffd1cfdbbd9c3c'
  );

  -- The six-space indent on the continuation lines is PART OF THE ANCHOR.
  -- dev1503_contract_replace_exact matches bytes, not SQL tokens, and this is
  -- exactly how pg_get_functiondef re-prints both bodies. Reformatting the
  -- three lines below makes the expected-count contract raise rather than
  -- silently miss.
  v_legacy_l1_list :=
    $anchor$'fashion', 'bags-accessories', 'jewelry', 'beauty', 'home',$anchor$ || E'\n' ||
    $anchor$      'food-drink', 'crafts', 'stationery', 'tech', 'outdoor',$anchor$ || E'\n' ||
    $anchor$      'fitness', 'kids-pets'$anchor$;

  v_final_l1_list :=
    $anchor$'fashion', 'bags-accessories', 'jewelry', 'beauty', 'home',$anchor$ || E'\n' ||
    $anchor$      'food-drink', 'crafts', 'stationery', 'tech', 'outdoor',$anchor$ || E'\n' ||
    $anchor$      'fitness', 'kids', 'pets'$anchor$;

  -- 3/4 approve_submission — one occurrence, the publishable-core guard that
  -- rejects a submission whose category is outside the L1 set.
  v_approve := pg_get_functiondef(
    'public.approve_submission(uuid,uuid,jsonb)'::regprocedure
  );
  v_approve := public.dev1503_contract_replace_exact(
    v_approve, v_legacy_l1_list, v_final_l1_list, 1
  );
  -- Closing contract: prove the retired slug survives nowhere in the body,
  -- including in a comment or a second list the anchor above did not cover.
  v_approve := public.dev1503_contract_replace_exact(
    v_approve, 'kids-pets', 'kids-pets', 0
  );
  execute v_approve;

  -- 4/4 apply_brand_refresh_with_protected_location_gate — one occurrence,
  -- OCCURRENCE 6/6 in that body's own numbering (the publishable-core guard,
  -- not one of the five purchase-channel array allow-lists).
  v_refresh := pg_get_functiondef(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
  );
  v_refresh := public.dev1503_contract_replace_exact(
    v_refresh, v_legacy_l1_list, v_final_l1_list, 1
  );
  v_refresh := public.dev1503_contract_replace_exact(
    v_refresh, 'kids-pets', 'kids-pets', 0
  );
  execute v_refresh;
end
$migration$;

-- ===========================================================================
-- Closing contract — all four sites, read back through the live catalog
-- ===========================================================================

do $migration$
declare
  v_surface jsonb;
  v_slug text;
  v_offenders text;
begin
  -- Sites 1/4 and 2/4, plus any CHECK anywhere that still names the retired
  -- slug.
  select string_agg(rel.relname || '.' || con.conname, ', ' order by rel.relname || '.' || con.conname)
  into v_offenders
  from pg_catalog.pg_constraint as con
  join pg_catalog.pg_class as rel on rel.oid = con.conrelid
  join pg_catalog.pg_namespace as nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and con.contype = 'c'
    and pg_catalog.pg_get_constraintdef(con.oid) like '%kids-pets%';

  if v_offenders is not null then
    raise exception 'DEV-1510 kids-pets remains in CHECK constraint(s): %', v_offenders
      using errcode = 'P0001';
  end if;

  -- Sites 3/4 and 4/4, plus anything else. Functions AND procedures; the
  -- prokind filter stays because pg_get_functiondef() errors on aggregates.
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
  into v_offenders
  from pg_catalog.pg_proc as p
  join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind in ('f', 'p')
    and pg_catalog.pg_get_functiondef(p.oid) like '%kids-pets%';

  if v_offenders is not null then
    raise exception 'DEV-1510 kids-pets remains in function or procedure: %', v_offenders
      using errcode = 'P0001';
  end if;

  -- The purchase_channel_sql_surface() re-pin, verified rather than assumed:
  -- the accessor the parity suite reads must return the patched bodies.
  v_surface := public.purchase_channel_sql_surface();

  foreach v_slug in array array[
    'fashion', 'bags-accessories', 'jewelry', 'beauty', 'home',
    'food-drink', 'crafts', 'stationery', 'tech', 'outdoor',
    'fitness', 'kids', 'pets'
  ]
  loop
    if (v_surface -> 'functions' ->> 'approve_submission')
         not like '%''' || v_slug || '''%'
      or (v_surface -> 'functions' ->> 'apply_brand_refresh_with_protected_location_gate')
         not like '%''' || v_slug || '''%'
    then
      raise exception
        'DEV-1510 purchase_channel_sql_surface re-pin missing L1 slug %', v_slug
        using errcode = 'P0001';
    end if;
  end loop;
end
$migration$;

drop function public.dev1503_contract_assert_function(regprocedure, text);
drop function public.dev1503_contract_replace_exact(text, text, text, integer);

commit;
