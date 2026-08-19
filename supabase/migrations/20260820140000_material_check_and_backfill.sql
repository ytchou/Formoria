-- DEV-1510 Task 10 — the material axis: CHECK, backfill, correctable field.
--
-- ---------------------------------------------------------------------------
-- WHY THE CHECK LANDS NOW AND NOT LATER
-- ---------------------------------------------------------------------------
--
-- `brands.material` and `curated_products.material` are both
-- `text[] not null default '{}'` (20260819120000), so every existing row is an
-- empty array and passes any element constraint for free. That stops being true
-- the moment DEV-1469 writes a value: a narrowing CHECK validates every
-- existing row, so one row on an unlisted term would abort the ALTER, and the
-- reconciliation would then need an editorial judgement nobody has made.
-- Free today, a data-migration tomorrow.
--
-- All twelve terms are admitted, including 紙 / 石 / 藤 / 漆, which have ZERO
-- production evidence. The vocabulary is the closed set agreed in
-- `docs/decisions/2026-08-19-taxonomy-vocabulary-and-gifting-facet.md`, not a
-- summary of what the catalogue happens to contain — omitting the four would
-- make the next paper-goods brand a schema change instead of a data entry.
--
-- ---------------------------------------------------------------------------
-- THE BACKFILL READS SLUGS, NOT LABELS
-- ---------------------------------------------------------------------------
--
-- 20260820130000 (task 9) already converted `brands.subcategories` to English
-- slugs, so the source of the derivation is `ceramics`, not `陶瓷・陶藝`. The
-- ten still-live craft L2s map onto eight terms:
--
--   ceramics             陶瓷・陶藝      -> 陶瓷
--   woodcraft            木藝・木作      -> 木
--   metalwork            金工           -> 金屬
--   bamboo-craft         竹編・竹藝      -> 竹
--   glass-art            玻璃・琉璃      -> 玻璃
--   leather-craft        皮革工藝        -> 皮革
--   needle-felting       羊毛氈          -> 羊毛
--   natural-dyeing       藍染・植物染     -> 織品
--   embroidery           刺繡           -> 織品
--   weaving-and-crochet  編織・鉤織      -> 織品
--
-- Against the 795-brand production corpus that is 67 brands over 81 tag-uses:
-- 陶瓷 29, 木 15, 織品 14, 金屬 7, 玻璃 7, 竹 4, 羊毛 3, 皮革 2. Staging holds
-- 104 of those brands, so its own counts are a subset and the closing block
-- REPORTS them rather than asserting a production-sized number that could never
-- pass here.
--
-- Staging-actual, from a transaction-and-rollback rehearsal on 2026-08-19:
-- **11 brands — 木 4, 織品 2, 金屬 2, 陶瓷 2, 羊毛 1**. The production figure is
-- pinned in `src/lib/services/__tests__/material-corrections.test.ts` against
-- the committed 795-brand corpus instead, so neither number stands in for the
-- other.
--
-- `illustration-and-art` and `dried-flowers-and-floral-design` are the two
-- craft L2s with no material: they name a medium of expression, not a material
-- the object is made of, and guessing 紙 for an illustration would put a wrong
-- fact behind a public filter.
--
-- ---------------------------------------------------------------------------
-- THE LABELS STAY IN `subcategories`
-- ---------------------------------------------------------------------------
--
-- DEV-1507 retires `crafts` and removes them; DEV-1510 only ADDS the material
-- axis. Removing them here would break 19 e2e files that seed
-- `category: 'crafts'` and the two published stories whose tags derive from
-- `L1_CATEGORIES`. The closing contract snapshots `subcategories` before the
-- backfill and proves not one array moved.
--
-- ---------------------------------------------------------------------------
-- `brand_field_corrections_field_check` AND THE RE-PIN
-- ---------------------------------------------------------------------------
--
-- `material` becomes the SECOND array-valued correctable field. That constraint
-- is one of three surfaces `purchase_channel_sql_surface()`
-- (20260805120500:17-59) snapshots, so widening it moves the meta-guard the
-- parity suite reads. The accessor re-materializes constraints through
-- `pg_get_constraintdef` at CALL time, so it needs no edit — only proof, which
-- the closing block supplies inside this same transaction.
--
-- ---------------------------------------------------------------------------
-- TRIGGERS
-- ---------------------------------------------------------------------------
--
-- `brands_updated_at` is disabled for the backfill, same reasoning as task 9:
-- `material` is DERIVED from `subcategories`, which every one of these rows
-- already carried. No brand's content changed, so no brand's timestamp may
-- move — a moved `updated_at` would churn sitemap `lastmod` for 67 brands on a
-- derivation. `brands_search_vector_trigger` does not list `material`, so no
-- search document is rebuilt.

begin;

-- ===========================================================================
-- 1/3 — the CHECK, on both tables
-- ===========================================================================
--
-- `<@` is element containment: every member of `material` must appear in the
-- allow-list. It is true for the empty array, which is what makes this free to
-- add against a table of defaults.

alter table public.brands
  drop constraint if exists brands_material_check;

alter table public.brands
  add constraint brands_material_check
  check (material <@ array[
    '陶瓷', '木', '織品', '玻璃', '金屬', '竹',
    '羊毛', '皮革', '紙', '石', '藤', '漆'
  ]::text[]);

alter table public.curated_products
  drop constraint if exists curated_products_material_check;

alter table public.curated_products
  add constraint curated_products_material_check
  check (material <@ array[
    '陶瓷', '木', '織品', '玻璃', '金屬', '竹',
    '羊毛', '皮革', '紙', '石', '藤', '漆'
  ]::text[]);

comment on column public.brands.material is
  'DEV-1510: the material axis, closed to the 12 terms in MATERIALS (src/lib/taxonomy/ontology.ts). Independent of the use axis — a brand may carry both, either or neither.';

-- ===========================================================================
-- 2/3 — the backfill, derived from the still-live craft L2 slugs
-- ===========================================================================

create temporary table dev1510_material_snapshot on commit drop as
select id, updated_at, subcategories from public.brands;

alter table public.brands disable trigger brands_updated_at;

update public.brands as b
set material = plan.materials
from (
  select
    brand.id,
    array_agg(term.material order by term.ord) as materials
  from public.brands as brand
  cross join lateral (
    -- One row per distinct material, carrying its canonical position. Three
    -- craft L2s share 織品, so without the DISTINCT a brand tagged 藍染 and
    -- 刺繡 would store it twice.
    select distinct on (mapping.material) mapping.material, mapping.ord
    from unnest(brand.subcategories) as tag(value)
    join (
      values
        ('ceramics',            '陶瓷', 1),
        ('woodcraft',           '木',   2),
        ('natural-dyeing',      '織品', 3),
        ('embroidery',          '織品', 3),
        ('weaving-and-crochet', '織品', 3),
        ('glass-art',           '玻璃', 4),
        ('metalwork',           '金屬', 5),
        ('bamboo-craft',        '竹',   6),
        ('needle-felting',      '羊毛', 7),
        ('leather-craft',       '皮革', 8)
    ) as mapping (slug, material, ord) on mapping.slug = tag.value
    order by mapping.material, mapping.ord
  ) as term
  group by brand.id
) as plan
where plan.id = b.id
  and b.material is distinct from plan.materials;

alter table public.brands enable trigger brands_updated_at;

-- ===========================================================================
-- 3/3 — `material` joins the correctable-field registry
-- ===========================================================================

alter table public.brand_field_corrections
  drop constraint if exists brand_field_corrections_field_check;

alter table public.brand_field_corrections
  add constraint brand_field_corrections_field_check
  check (field in (
    'price_range',
    'category',
    'subcategories',
    'material',
    'purchase_website',
    'purchase_pinkoi',
    'purchase_shopee',
    'purchase_myship',
    'social_instagram',
    'social_threads',
    'social_facebook'
  ));

-- ===========================================================================
-- Closing contracts
-- ===========================================================================

do $migration$
declare
  v_moved integer;
  v_touched text;
  v_brands integer;
  v_distribution text;
  v_surface jsonb;
  v_term text;
begin
  select count(*)
  into v_moved
  from public.brands as brand
  join dev1510_material_snapshot as snapshot on snapshot.id = brand.id
  where brand.updated_at is distinct from snapshot.updated_at;

  if v_moved > 0 then
    raise exception 'DEV-1510 material backfill moved brands.updated_at on % row(s)', v_moved
      using errcode = 'P0001';
  end if;

  -- The craft labels STAY. DEV-1507 removes them, not this ticket, and 19 e2e
  -- files plus two published stories depend on them until it does.
  select string_agg(brand.slug, ', ' order by brand.slug)
  into v_touched
  from public.brands as brand
  join dev1510_material_snapshot as snapshot on snapshot.id = brand.id
  where brand.subcategories is distinct from snapshot.subcategories;

  if v_touched is not null then
    raise exception
      'DEV-1510 material backfill changed brands.subcategories on: %; the craft labels stay until DEV-1507',
      v_touched
      using errcode = 'P0001';
  end if;

  -- Every written term must be in the closed vocabulary. The CHECK above
  -- already guarantees it; this proves the MAPPING agrees rather than that the
  -- constraint fired, which is a different claim.
  select string_agg(distinct entry.value, ', ')
  into v_touched
  from public.brands as brand,
       unnest(brand.material) as entry(value)
  where entry.value not in (
    '陶瓷', '木', '織品', '玻璃', '金屬', '竹',
    '羊毛', '皮革', '紙', '石', '藤', '漆'
  );

  if v_touched is not null then
    raise exception 'DEV-1510 material backfill wrote unlisted term(s): %', v_touched
      using errcode = 'P0001';
  end if;

  -- Staging-actual, REPORTED not asserted: the 67-brand / 8-term distribution
  -- is sized against the 795-brand production catalogue and staging holds 104
  -- of them, so an equality assertion here could never pass and would only
  -- teach the next reader to weaken it.
  select count(*) into v_brands
  from public.brands where cardinality(material) > 0;

  select string_agg(entry.value || ' ' || entry.brands::text, ', ' order by entry.brands desc, entry.value)
  into v_distribution
  from (
    select term.value, count(distinct brand.id) as brands
    from public.brands as brand,
         unnest(brand.material) as term(value)
    group by term.value
  ) as entry;

  raise notice 'DEV-1510 material backfill: % brand(s) — %',
    v_brands, coalesce(v_distribution, 'none');

  -- The re-pin, verified rather than assumed.
  v_surface := public.purchase_channel_sql_surface();
  if (v_surface -> 'constraints' ->> 'brand_field_corrections_field_check')
       not like '%''material''%' then
    raise exception
      'DEV-1510 purchase_channel_sql_surface re-pin missing material in brand_field_corrections_field_check'
      using errcode = 'P0001';
  end if;

  -- Both CHECKs, read back through the catalog. Quoted on purpose: 木 is a
  -- substring of nothing here, but 織品 and 玻璃 share codepoints with other
  -- terms in other vocabularies, and an unquoted match would pass on a prefix.
  foreach v_term in array array[
    '陶瓷', '木', '織品', '玻璃', '金屬', '竹',
    '羊毛', '皮革', '紙', '石', '藤', '漆'
  ]
  loop
    if (
      select count(*)
      from pg_catalog.pg_constraint as con
      where con.conname in ('brands_material_check', 'curated_products_material_check')
        and pg_catalog.pg_get_constraintdef(con.oid) like '%''' || v_term || '''%'
    ) <> 2 then
      raise exception 'DEV-1510 material term % missing from a material CHECK', v_term
        using errcode = 'P0001';
    end if;
  end loop;
end
$migration$;

commit;
