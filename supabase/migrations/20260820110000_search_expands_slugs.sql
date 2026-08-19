-- Search expands stored slugs back to zh-TW labels (DEV-1510, Task 7).
--
-- THE DEFECT THIS PREVENTS
-- ---------------------------------------------------------------------------
--
-- Task 9 rewrites `brands.subcategories` from zh-TW labels to English slugs.
-- `brands_search_document` feeds that array into TWO arms: a
-- `to_tsvector('english', ...)` weight-C arm and a `cjk_bigrams` weight-C arm
-- (20260809100000_cjk_bigram_search.sql:107-113). Latin slugs keep the first
-- arm working and starve the second, so `後背包` stops matching a brand tagged
-- `backpacks`.
--
-- Nothing in the suite asserts a ranking weight, so the loss is silent: the
-- `?sub=` filter still works, the brand just vanishes from search. On the
-- 2026-08-19 staging baseline EIGHT of the nine hits for `陶藝` / `後背包` /
-- `金工` exist only because of the subcategory arm
-- (docs/reports/2026-08-20-search-ranking-baseline.md).
--
-- The expansion is a 1:1 positional map through `taxonomy_terms`
-- (20260820100000): a known L2 slug becomes its `name_zh`, anything else
-- passes through byte-for-byte. Two consequences that make this deployable
-- ahead of the backfill:
--
--   * TODAY the column holds labels, no element resolves, and every search
--     document is unchanged. The closing contract in this file PROVES that
--     rather than assuming it.
--   * AFTER Task 9 the column holds slugs, every element resolves, and the
--     CJK arm sees exactly the labels it sees today.
--
-- ---------------------------------------------------------------------------
-- DUMP PROVENANCE — these bodies have no source file
-- ---------------------------------------------------------------------------
--
-- `brands_search_document`, `brands_search_vector_update`, `brand_trgm_rank`
-- and `canonicalize_subcategory_translations` are md5-pinned objects that were
-- produced by string substitution inside
-- 20260819090000_contract_category_subcategory_vocabulary.sql:200-290. The
-- migration files that created them are stale and the dumps under
-- docs/reports/ are staler still. The bodies below were re-materialized LIVE
-- from staging (`xwkigpvnheecihpxyvsl`) at **2026-08-19 08:33:06 UTC** with:
--
--   psql "$SUPABASE_DB_URL" -At -c "
--     select p.oid::regprocedure::text,
--            md5(pg_get_functiondef(p.oid)),
--            length(pg_get_functiondef(p.oid))
--     from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public'
--       and p.proname in (
--         'brands_search_document',
--         'brands_search_vector_update',
--         'brand_trgm_rank',
--         'canonicalize_subcategory_translations'
--       )
--     order by 1"
--
-- which returned:
--
--   brand_trgm_rank(text,text,text,text,text[],text[],text,text)
--     | 069aa39d8b595b14e724cccfd38153c4 |  828 bytes
--   brands_search_document(text,text,text,text[],text[],text,text)
--     | 8ea7cf8115c8290402b9832c451ab6c7 | 1191 bytes
--   brands_search_vector_update()
--     | 73413b44060f2c69fd023ed589877856 |  365 bytes
--   canonicalize_subcategory_translations(text[],text[])
--     | 0fa2b7563dfb6013b26d571c41a3ac3c | 1164 bytes
--
-- The first three md5s match the Task 5 baseline capture
-- (docs/reports/2026-08-20-search-ranking-baseline.md:20-24) taken at
-- 2026-08-19 07:55:34 UTC, so nothing moved between the baseline and this
-- edit. All four are asserted below BEFORE anything is rewritten.
--
-- Unlike 20260820090000_split_kids_pets_l1.sql, this file re-types the bodies
-- instead of anchor-patching them. The three search bodies are 365-1191 bytes
-- and the whole point of the change is that a reviewer can see the join to
-- `taxonomy_terms` sitting in front of `to_tsvector` and `cjk_bigrams`. The
-- md5 assertions still give the exactly-once guarantee: a body that drifted
-- since the dump aborts the migration instead of being silently overwritten.
--
-- ---------------------------------------------------------------------------
-- CREATE OR REPLACE, NOT DROP
-- ---------------------------------------------------------------------------
--
-- 20260819090000 had to drop and recreate these four because it RENAMED their
-- parameters, and parameter names are the PostgREST resolution contract. This
-- change renames nothing, so `create or replace` is available — and preferred,
-- because `drop function` re-applies Supabase's default privileges to `anon`
-- and `authenticated`, and revoking from `public` does not undo it. The one
-- function that genuinely is dropped here
-- (`canonicalize_subcategory_translations`) is replaced by a differently-named
-- object whose grants are set explicitly and then verified by role name.
--
-- Volatility moves IMMUTABLE -> STABLE on `brands_search_document` and
-- `brand_trgm_rank`: both now read a table. Checked live before committing to
-- that — `brands.search_vector` is a plain column driven by
-- `brands_search_vector_trigger`, not a generated column, and no expression
-- index anywhere calls either function, so nothing required IMMUTABLE.
--
-- ---------------------------------------------------------------------------
-- INVERTING canonicalize_subcategory_translations
-- ---------------------------------------------------------------------------
--
-- Its entire contract was label-keyed: it INSERTed each zh-TW label into
-- `subcategory_translations` and read back the first English translation ever
-- seen for it. Under slug storage the canonical English name is not a cached
-- guess, it is `taxonomy_terms.name_en`. The replacement resolves slug first,
-- then zh-TW label (so it is already correct in the window before the
-- backfill), and only then falls back to the caller's own English.
--
-- It is renamed rather than replaced in place because the old name asserts a
-- table that no longer exists. `src/lib/services/enrich-phases/descriptions.ts`
-- is the only caller.
--
-- `subcategory_translations` is then dropped — but only after the replacement
-- is in place and after a catalog sweep proves no other function, procedure or
-- view still reads it. It carried 0 rows on staging at the time of writing;
-- everything it could have held for a closed-vocabulary term is derivable from
-- `taxonomy_terms`, which is what makes the drop non-lossy.
--
-- `product_tag_translations` is NOT touched here: 20260819090000:839 already
-- dropped it.

begin;

-- Re-created here: 20260819090000, 20260819130000 and 20260820090000 each drop
-- both helpers at their own tail.
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

-- ===========================================================================
-- Fingerprints first — nothing is rewritten until all four match the dump
-- ===========================================================================

do $migration$
begin
  perform public.dev1503_contract_assert_function(
    'public.brands_search_document(text,text,text,text[],text[],text,text)'::regprocedure,
    '8ea7cf8115c8290402b9832c451ab6c7'
  );
  perform public.dev1503_contract_assert_function(
    'public.brands_search_vector_update()'::regprocedure,
    '73413b44060f2c69fd023ed589877856'
  );
  perform public.dev1503_contract_assert_function(
    'public.brand_trgm_rank(text,text,text,text,text[],text[],text,text)'::regprocedure,
    '069aa39d8b595b14e724cccfd38153c4'
  );
  perform public.dev1503_contract_assert_function(
    'public.canonicalize_subcategory_translations(text[],text[])'::regprocedure,
    '0fa2b7563dfb6013b26d571c41a3ac3c'
  );
end
$migration$;

-- Every search document as the CURRENT function computes it, captured before
-- the replacement so the closing contract can compare like with like. A row
-- carrying a stored L2 slug is expected to change; every other row must not.
create temporary table dev1510_search_document_before on commit drop as
select
  brand.id,
  md5(
    public.brands_search_document(
      brand.name, brand.slug, brand.category,
      brand.subcategories, brand.subcategories_en,
      brand.description, brand.blurb_en
    )::text
  ) as document_md5,
  exists (
    select 1
    from unnest(coalesce(brand.subcategories, array[]::text[])) as stored(value)
    join public.taxonomy_terms as term
      on term.axis = 'l2' and term.slug = stored.value
  ) as carries_slug
from public.brands as brand;

-- ===========================================================================
-- The expansion itself
-- ===========================================================================
--
-- Positional and total: the output has the same length and the same order as
-- the input, and an unknown element comes back byte-for-byte. Both properties
-- are load-bearing.
--
--   * Same length and order, so `array_to_string(...)` produces the same term
--     FREQUENCIES as before for an unmigrated row. `ts_rank` weighs frequency;
--     a de-duplicating or unioning expansion would move every rank_score in
--     the baseline while looking correct.
--   * Pass-through, so this migration is deployable ahead of the backfill and
--     stays correct for any row the backfill has not reached.
--
-- Only the `l2` axis is joined. `l1` and `material` terms are in the same
-- table but a category slug is indexed from `brands.category` on its own arm,
-- and `brands.material` has no search arm at all.
create or replace function public.taxonomy_expand_subcategories(
  p_values text[]
)
returns text[]
language sql
stable
parallel safe
set search_path = public, pg_temp
as $function$
  select case
    when p_values is null then null
    else coalesce(
      (
        select array_agg(
          coalesce(term.name_zh, source.value)
          order by source.ordinality
        )
        from unnest(p_values) with ordinality as source(value, ordinality)
        left join public.taxonomy_terms as term
          on term.axis = 'l2'
         and term.slug = source.value
      ),
      array[]::text[]
    )
  end;
$function$;

revoke all on function public.taxonomy_expand_subcategories(text[])
  from public, anon, authenticated;
grant execute on function public.taxonomy_expand_subcategories(text[])
  to postgres, service_role;

comment on function public.taxonomy_expand_subcategories(text[]) is
  'Maps stored L2 slugs to their zh-TW labels through taxonomy_terms, '
  'positionally and 1:1, passing unknown values through unchanged. Used by '
  'brands_search_document and brand_trgm_rank so CJK recall survives slug '
  'storage (DEV-1510).';

-- ===========================================================================
-- brands_search_document — the CJK arm now reads expanded labels
-- ===========================================================================
--
-- Exactly one arm moves. The `to_tsvector('english', ...)` arm keeps reading
-- the RAW array on purpose: after the backfill that array holds `backpacks`,
-- which is precisely what makes the English query `backpack` keep matching.
-- Indexing both the raw and the expanded values through the SAME arm would
-- double every term for an unmigrated row and move its rank_score.
create or replace function public.brands_search_document(
  p_name text,
  p_slug text,
  p_category text,
  p_subcategories text[],
  p_subcategories_en text[],
  p_description text,
  p_blurb_en text
)
returns tsvector
language sql
stable
parallel safe
set search_path = public, pg_temp
as $function$
  SELECT
    setweight(to_tsvector('english', COALESCE(p_name, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(p_slug, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(p_category, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(p_subcategories, ' '), '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(p_subcategories_en, ' '), '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(p_description, '')), 'D') ||
    setweight(to_tsvector('english', COALESCE(p_blurb_en, '')), 'D') ||
    setweight(to_tsvector('simple', public.cjk_bigrams_bridged(COALESCE(p_name, ''))), 'A') ||
    setweight(to_tsvector('simple', public.cjk_bigrams(COALESCE(array_to_string(public.taxonomy_expand_subcategories(p_subcategories), ' '), ''))), 'C') ||
    setweight(to_tsvector('simple', public.cjk_bigrams(left(COALESCE(p_description, ''), 2000))), 'D');
$function$;

-- ===========================================================================
-- brands_search_vector_update — re-materialized against the new document
-- ===========================================================================
--
-- The body is byte-identical to the dump: the trigger's job did not change.
-- It is re-issued anyway so this migration owns the fingerprint of every
-- object in the write path it altered, and so `create or replace` re-resolves
-- the `brands_search_document` reference now that the callee is STABLE rather
-- than IMMUTABLE. The trigger definition itself
-- (`before insert or update of name, slug, category, subcategories,
-- subcategories_en, description, blurb_en`) is deliberately untouched: this
-- change adds no new column dependency to the vector.
create or replace function public.brands_search_vector_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
BEGIN
  NEW.search_vector := public.brands_search_document(
    NEW.name, NEW.slug, NEW.category,
    NEW.subcategories, NEW.subcategories_en,
    NEW.description, NEW.blurb_en
  );
  RETURN NEW;
END;
$function$;

-- ===========================================================================
-- brand_trgm_rank — a zh-TW arm over the expanded array
-- ===========================================================================
--
-- The new arm is guarded on the query actually containing CJK, and that guard
-- is the honest part of this function. `search_brand_page` and `search_brands`
-- both reach the trigram ladder ONLY when the query has no CJK
-- (`AND NOT has_cjk`), so an unguarded expansion arm would run a table lookup
-- per brand per query and could never raise the GREATEST: `word_similarity`
-- of a Latin query against a zh-TW label is 0. The arm is written so it is
-- correct if that gate ever moves, and costs a regex rather than a join while
-- the gate stands.
--
-- The raw `p_subcategories` arm is kept beside it, unchanged: after the
-- backfill it is the arm that trigram-matches a misspelt English slug.
create or replace function public.brand_trgm_rank(
  p_query text,
  p_name text,
  p_category text,
  p_blurb_en text,
  p_subcategories text[],
  p_subcategories_en text[],
  p_description text,
  p_slug text
)
returns real
language sql
stable
parallel safe
set search_path = public, pg_temp
as $function$
  SELECT GREATEST(
    word_similarity(p_query, COALESCE(p_name, '')) * 1.0,
    word_similarity(p_query, COALESCE(p_category, '')) * 0.8,
    word_similarity(p_query, COALESCE(p_blurb_en, '')) * 0.7,
    word_similarity(p_query, COALESCE(array_to_string(p_subcategories, ' '), '')) * 0.6,
    CASE
      WHEN p_query ~ '[㐀-䶿一-鿿豈-﫿]'
        THEN word_similarity(
          p_query,
          COALESCE(
            array_to_string(public.taxonomy_expand_subcategories(p_subcategories), ' '),
            ''
          )
        ) * 0.6
      ELSE 0::real
    END,
    word_similarity(p_query, COALESCE(array_to_string(p_subcategories_en, ' '), '')) * 0.6,
    word_similarity(p_query, COALESCE(p_description, '')) * 0.5,
    word_similarity(p_query, COALESCE(p_slug, '')) * 0.4
  )::real;
$function$;

-- ===========================================================================
-- Neutrality contract — the baseline is preserved by construction
-- ===========================================================================
--
-- Task 7's wave gate is `ranking_matches_the_baseline`. That test measures the
-- RPC; this block proves the same property one layer down and inside the same
-- transaction, so a wired-wrong expansion aborts the deploy instead of
-- shipping a degraded index that a later test has to discover.
do $migration$
declare
  v_drifted text;
  v_recomputed integer;
begin
  select string_agg(brand.slug, ', ' order by brand.slug)
  into v_drifted
  from public.brands as brand
  join dev1510_search_document_before as before on before.id = brand.id
  where not before.carries_slug
    and before.document_md5 is distinct from md5(
      public.brands_search_document(
        brand.name, brand.slug, brand.category,
        brand.subcategories, brand.subcategories_en,
        brand.description, brand.blurb_en
      )::text
    );

  if v_drifted is not null then
    raise exception
      'DEV-1510 search document changed for brand(s) carrying no stored L2 slug: %; the expansion is not a pass-through',
      v_drifted
      using errcode = 'P0001';
  end if;

  -- The other half: a row that DOES carry a stored slug has a genuinely new
  -- document and needs its persisted vector rebuilt. Zero such rows exist on
  -- staging today (the backfill is Task 9), but this migration must stay
  -- correct if it is ever applied after one.
  select count(*)
  into v_recomputed
  from dev1510_search_document_before as before
  where before.carries_slug;

  raise notice
    'DEV-1510 search documents unchanged for % brand(s); % carry a stored L2 slug and are reindexed below',
    (select count(*) from dev1510_search_document_before) - v_recomputed,
    v_recomputed;
end
$migration$;

-- Representation-only reindex: no brand timestamp may move, so only the
-- timestamp trigger is disabled — the same shape as 20260819090000:804-809.
-- The WHERE clause keeps this a no-op on a pre-backfill database rather than
-- rewriting all 104 rows for nothing.
alter table public.brands disable trigger brands_updated_at;
update public.brands as brand
set search_vector = public.brands_search_document(
  brand.name, brand.slug, brand.category,
  brand.subcategories, brand.subcategories_en,
  brand.description, brand.blurb_en
)
where exists (
  select 1
  from dev1510_search_document_before as before
  where before.id = brand.id
    and before.carries_slug
);
alter table public.brands enable trigger brands_updated_at;

-- ===========================================================================
-- Invert the label-keyed canonicalizer
-- ===========================================================================

create or replace function public.canonicalize_subcategory_slugs(
  p_subcategories text[],
  p_subcategories_en text[]
)
returns text[]
language sql
stable
set search_path = public, pg_temp
as $function$
  select case
    when p_subcategories is null then array[]::text[]
    else coalesce(
      (
        select array_agg(
          coalesce(
            resolved.name_en,
            nullif(btrim(coalesce(p_subcategories_en[source.ordinality::int], '')), ''),
            source.value
          )
          order by source.ordinality
        )
        from unnest(p_subcategories) with ordinality as source(value, ordinality)
        left join lateral (
          select term.name_en
          from public.taxonomy_terms as term
          where term.axis = 'l2'
            and (term.slug = source.value or term.name_zh = source.value)
          order by (term.slug = source.value) desc, term.slug
          limit 1
        ) as resolved on true
      ),
      array[]::text[]
    )
  end;
$function$;

-- A newly created function inherits Supabase's default EXECUTE grant to
-- PUBLIC. Revoking by role name is the only thing that removes it, and the
-- closing contract verifies it with has_function_privilege rather than
-- trusting the statement.
revoke all on function public.canonicalize_subcategory_slugs(text[], text[])
  from public, anon, authenticated;
grant execute on function public.canonicalize_subcategory_slugs(text[], text[])
  to postgres, service_role;

comment on function public.canonicalize_subcategory_slugs(text[], text[]) is
  'Canonical English names for stored subcategory values, resolved through '
  'taxonomy_terms by slug and then by zh-TW label, falling back to the '
  'caller''s own translation. Replaces canonicalize_subcategory_translations, '
  'whose contract was keyed on the dropped subcategory_translations table '
  '(DEV-1510).';

drop function public.canonicalize_subcategory_translations(text[], text[]);

-- ===========================================================================
-- Drop subcategory_translations — after nothing reads it, not before
-- ===========================================================================

do $migration$
declare
  v_readers text;
  v_rows bigint;
begin
  select count(*) into v_rows from public.subcategory_translations;
  raise notice
    'DEV-1510 dropping subcategory_translations with % row(s); every closed-vocabulary translation is now in taxonomy_terms',
    v_rows;

  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
  into v_readers
  from pg_catalog.pg_proc as p
  join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind in ('f', 'p')
    and pg_catalog.pg_get_functiondef(p.oid) like '%subcategory\_translations%';

  if v_readers is not null then
    raise exception
      'DEV-1510 subcategory_translations is still read by: %', v_readers
      using errcode = 'P0001';
  end if;

  select string_agg(c.relname, ', ' order by c.relname)
  into v_readers
  from pg_catalog.pg_class as c
  join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('v', 'm')
    and pg_catalog.pg_get_viewdef(c.oid) like '%subcategory\_translations%';

  if v_readers is not null then
    raise exception
      'DEV-1510 subcategory_translations is still read by view(s): %', v_readers
      using errcode = 'P0001';
  end if;
end
$migration$;

drop table public.subcategory_translations;

-- ===========================================================================
-- Closing contract
-- ===========================================================================

do $migration$
declare
  v_expansion constant text :=
    'public.taxonomy_expand_subcategories(p_subcategories)';
  v_multiplier constant text := '* 0.6';
  v_document text;
  v_trgm text;
  v_offenders text;
begin
  v_document := pg_get_functiondef(
    'public.brands_search_document(text,text,text,text[],text[],text,text)'::regprocedure
  );
  v_trgm := pg_get_functiondef(
    'public.brand_trgm_rank(text,text,text,text,text[],text[],text,text)'::regprocedure
  );

  -- Occurrence counts are derived from the needle's own length rather than a
  -- hand-counted divisor: a mistyped divisor turns this contract into a
  -- tautology that passes on a body it never actually checked.
  if length(v_document) - length(replace(v_document, v_expansion, ''))
     <> length(v_expansion)
  then
    raise exception 'DEV-1510 brands_search_document does not expand subcategories exactly once'
      using errcode = 'P0001';
  end if;
  if v_document not like '%cjk_bigrams(COALESCE(array_to_string(public.taxonomy_expand_subcategories(p_subcategories)%' then
    raise exception 'DEV-1510 the expansion does not precede cjk_bigrams'
      using errcode = 'P0001';
  end if;
  if v_document not like '%to_tsvector(''english'', COALESCE(array_to_string(p_subcategories, '' ''), ''''))%' then
    raise exception 'DEV-1510 the English subcategory arm no longer reads the raw array'
      using errcode = 'P0001';
  end if;
  if length(v_trgm) - length(replace(v_trgm, v_multiplier, ''))
     <> length(v_multiplier) * 3
  then
    raise exception 'DEV-1510 brand_trgm_rank subcategory multipliers changed'
      using errcode = 'P0001';
  end if;

  -- CREATE OR REPLACE preserves an ACL, but the whole reason this file avoids
  -- DROP is that a re-created function silently regains Supabase's default
  -- EXECUTE grant to PUBLIC. Assert rather than assume.
  if has_function_privilege(
       'anon',
       'public.brands_search_document(text,text,text,text[],text[],text,text)'::regprocedure,
       'EXECUTE'
     )
    or has_function_privilege(
       'anon',
       'public.brand_trgm_rank(text,text,text,text,text[],text[],text,text)'::regprocedure,
       'EXECUTE'
     )
    or has_function_privilege(
       'anon',
       'public.brands_search_vector_update()'::regprocedure,
       'EXECUTE'
     )
  then
    raise exception 'DEV-1510 a replaced search function became executable by anon'
      using errcode = 'P0001';
  end if;

  -- Grants: the new canonicalizer must not be reachable by anon or
  -- authenticated, and must be reachable by service_role.
  if has_function_privilege(
       'anon',
       'public.canonicalize_subcategory_slugs(text[],text[])'::regprocedure,
       'EXECUTE'
     )
    or has_function_privilege(
       'authenticated',
       'public.canonicalize_subcategory_slugs(text[],text[])'::regprocedure,
       'EXECUTE'
     )
  then
    raise exception 'DEV-1510 canonicalize_subcategory_slugs is executable by anon or authenticated'
      using errcode = 'P0001';
  end if;
  if not has_function_privilege(
       'service_role',
       'public.canonicalize_subcategory_slugs(text[],text[])'::regprocedure,
       'EXECUTE'
     )
  then
    raise exception 'DEV-1510 service_role lost EXECUTE on canonicalize_subcategory_slugs'
      using errcode = 'P0001';
  end if;
  if has_function_privilege(
       'anon',
       'public.taxonomy_expand_subcategories(text[])'::regprocedure,
       'EXECUTE'
     )
  then
    raise exception 'DEV-1510 taxonomy_expand_subcategories is executable by anon'
      using errcode = 'P0001';
  end if;

  -- Nothing anywhere still names the dropped table or the dropped function.
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
  into v_offenders
  from pg_catalog.pg_proc as p
  join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind in ('f', 'p')
    and (
      pg_catalog.pg_get_functiondef(p.oid) like '%subcategory\_translations%'
      or p.proname = 'canonicalize_subcategory_translations'
    );

  if v_offenders is not null then
    raise exception
      'DEV-1510 the retired subcategory_translations contract survives in: %', v_offenders
      using errcode = 'P0001';
  end if;
end
$migration$;

drop function public.dev1503_contract_assert_function(regprocedure, text);

commit;
