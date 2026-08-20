-- Retire the `crafts` L1 (DEV-1507, Task 11).
--
-- `crafts` named a TECHNIQUE, not a product kind. 陶瓷, 木藝 and 金工 answer
-- "how was this made", which is what the material axis stores, so the ten
-- technique nodes under it never passed the L2 is-a test at all. This migration
-- removes the L1 and its ten technique children, relocates the two nodes that
-- describe a product kind, and re-files every brand that sat on the retired L1.
--
-- Two of the twelve departing L2 slugs survive as something:
--
--   illustration-and-art            -> wall-art             (relocated to `home`)
--   dried-flowers-and-floral-design -> floral-arrangements  (merged into an
--                                                            existing `home` L2)
--
-- The other ten are STRIPPED from every array: ceramics, woodcraft, metalwork,
-- bamboo-craft, glass-art, natural-dyeing, leather-craft, embroidery,
-- needle-felting, weaving-and-crochet.
--
-- Storage has been slugs since DEV-1510 and the read path
-- (`resolveDirectorySubcategorySlugs`, `ontology.ts:555-568`) uses
-- `subcategoryBySlug` — an exact map with NO alias fallback. An alias therefore
-- cannot rescue a renamed slug; only a data rewrite can. That is why both the
-- rename and the merge are rewrites here rather than ontology entries.
--
-- ---------------------------------------------------------------------------
-- THE FIVE L1 ENUMERATION SITES
-- ---------------------------------------------------------------------------
--
-- The valid L1 slug set is enumerated in FIVE places that no compiler, type
-- checker or test relates to one another. Four are canonically named at
-- 20260820090000_split_kids_pets_l1.sql:6-19:
--
--   1/5  brands_category_check                       (CHECK constraint)
--   2/5  curated_products_category_check             (CHECK constraint)
--   3/5  the BODY of approve_submission(uuid,uuid,jsonb)
--   4/5  the BODY of apply_brand_refresh_with_protected_location_gate(uuid,uuid)
--
-- The fifth is NOT a persistent object and the canonical comment does not count
-- it: it is the 13-slug verification loop over `purchase_channel_sql_surface()`
-- at 20260820090000:371-388, which lives inside that migration. The accessor's
-- own body carries no L1 list — it re-materializes the four named functions
-- through `pg_get_functiondef` at CALL time — so the loop is REPLICATED at the
-- tail of this file with the 12-slug array, not patched.
--
-- A live census of staging on 2026-08-20 confirmed the set is complete: no
-- column default, enum label or domain names `crafts`, and there is no sixth
-- site. The dump and the census are at
-- `docs/reports/2026-08-20-dev1507-function-baseline.sql`.
--
-- Patching fewer than all five produces a schema that accepts a brand at insert
-- and rejects it at approval, hours later, inside an admin queue, with no type
-- error and no build break.
--
-- ---------------------------------------------------------------------------
-- DUMP PROVENANCE — sites 3/5 and 4/5 have NO source file
-- ---------------------------------------------------------------------------
--
-- Both function bodies are hand-patched objects that exist only in the live
-- catalog. Re-materialized from staging (`xwkigpvnheecihpxyvsl`) at
-- **2026-08-20 03:04:52 UTC** with `pg_get_functiondef`, which returned:
--
--   apply_brand_refresh_with_protected_location_gate(uuid,uuid)
--     | 755f6933919d0f4eb1b8aeb59d9d29d5 | 15373 bytes
--   approve_submission(uuid,uuid,jsonb)
--     | 912cfb416ad6e5d6baed4cc067d90736 |  8862 bytes
--   purchase_channel_sql_surface()
--     | 34129d813bd8ae38a2890e58355978a8 |  4536 bytes
--
-- **Every md5 pinned by an earlier migration is STALE.** 20260820090000:48,50
-- and :275,279 pin `2206671cb5ec…` / `e5d67079…`; 20260821100000:166 pins
-- `5615ed85…`. 20260821100000 rewrote the gate again after those were written.
--
-- The one that matters most is the LAST one. 20260821110000:143,147 pins
-- `4d107ce1c764e920c0a601379cae1da8` (approve_submission) and
-- `401a5c499848fc3c2d0e1571db269e72` (the refresh gate), and its :132-266 block
-- then rewrote BOTH bodies to strip the focal-point columns. It is the
-- migration immediately before this one, so those two values — not the older
-- three — are exactly what the two fingerprints above supersede.
--
-- The two fingerprints above are asserted below BEFORE anything is rewritten,
-- so an unexpected live deploy fails here rather than silently re-materializing
-- a body from a stale assumption.
--
-- **BOTH FINGERPRINTS ARE STAGING-ONLY**, the same warning 20260821110000:57-61
-- carried about its own pair. They were never observed on production. Run both
-- commands below against PRODUCTION before the production apply and reconcile
-- any difference first: a one-byte divergence aborts the assert, rolls the
-- whole transaction back, and strands the fleet staging-migrated and
-- production-not. `SUPABASE_DB_URL` must hold the PRODUCTION connection string
-- for this check — the one `.env.staging` exports points at staging, and a
-- staging read here proves nothing.
--
--   psql "$SUPABASE_DB_URL" -At -c "
--     select md5(pg_get_functiondef(
--       'public.approve_submission(uuid,uuid,jsonb)'::regprocedure));"
--   -- 912cfb416ad6e5d6baed4cc067d90736
--
--   psql "$SUPABASE_DB_URL" -At -c "
--     select md5(pg_get_functiondef(
--       'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'
--       ::regprocedure));"
--   -- 755f6933919d0f4eb1b8aeb59d9d29d5
--
-- **The six-space continuation indent is part of the byte anchor.**
-- `dev1503_contract_replace_exact` matches BYTES, not SQL tokens, and the
-- three-line slug literal is exactly how `pg_get_functiondef` re-prints both
-- bodies. Reformatting it makes the expected-count contract raise P0001 rather
-- than silently miss.
--
-- ---------------------------------------------------------------------------
-- ORDERING IS LOAD-BEARING
-- ---------------------------------------------------------------------------
--
--   1. Against the ledger: 20260820140000_material_check_and_backfill.sql
--      derives `brands.material` FROM the craft L2 slugs as a one-shot update
--      with no trigger. It must run FIRST or the derivation reads an array the
--      strip already emptied. This filename sorts after it and after
--      20260821110000_drop_brand_image_focal_points.sql, the current newest —
--      verified, not assumed.
--   2. Inside this file: the data rewrite precedes the constraint change. A
--      CHECK added first rejects the very rows the rewrite was about to fix.
--   3. Inside this file, second axis: `taxonomy_terms` is re-seeded at step 6,
--      and both `subcategory_slugs_to_names_en` (20260820130000:1153) and
--      `taxonomy_expand_subcategories` READ that table. Every `_en` projection
--      and every search document is therefore recomputed at step 7, AFTER the
--      re-seed — otherwise `wall-art` projects to itself instead of "Wall Art"
--      and indexes with no zh-TW label at all.
--
--   1  rewrite slugs      brands.subcategories, brands.draft_data,
--                         curated_products.subcategories + the pending
--                         submission blobs
--   2  delete             the `hidden` crafts brands
--   3  re-file            brands.category, by map + tiebreak + 13 explicit
--   4  label ledger       13 rows re-point, 42 -> disposition 'evicted'
--   5  cut the slug list  5 sites, byte-anchored, md5-asserted
--   6  re-seed            taxonomy_terms, in full, between generator markers
--   7  re-project         subcategories_en + search vectors, against step 6
--
-- ---------------------------------------------------------------------------
-- THE RE-FILE
-- ---------------------------------------------------------------------------
--
-- `deriveCategoryFromSubcategories` cannot do this: measured against
-- production it re-files 59 of 109 approved craft brands, 30 tie (it returns
-- null with no tiebreak) and 20 carry no use-axis L2 at all.
--
-- The replacement is a per-node map plus a tiebreak, applied as ONE
-- deterministic SQL statement so staging and production produce identical
-- results with no operator run:
--
--   1. Vote over the parents of the brand's surviving use-axis L2s, PLUS the
--      map's L1 for each craft L2 it carries. One vote each, over the DISTINCT
--      slugs the brand held BEFORE step 1 rewrote them.
--   2. On a tie, the majority among the brand's own craft nodes decides. This
--      OVERRIDES the tied use-axis winners; it does not merely filter them.
--   3. What still does not resolve is assigned explicitly, by slug.
--
-- The frozen inputs — the D3 map, the 13 explicit assignments and the census
-- they were derived from — are at
-- `docs/reports/2026-08-20-crafts-refile-assignments.md`. That file supersedes
-- the plan's "9 explicit": a re-run against production on 2026-08-20 found the
-- documented tiebreak leaves THIRTEEN unresolved, because four brands tie AND
-- carry two craft nodes that disagree 1-1 — a case no document covers, and one
-- whose original resolution cannot be recovered (two different assignments of
-- the four both reproduce the pinned totals). Rather than invent an unstated
-- rule, ADR decision 4 applies: no default, assign by hand.
--
-- The 13 are applied as an OVERRIDE rather than as a fallback. They are human
-- decisions recorded on 2026-08-20; a rule that happened to resolve one of them
-- differently on a database with slightly different rows must not win.
--
-- `natural-dyeing` is deliberately ABSENT from the map: it carries zero brands
-- on production, and inventing an L1 for a node nothing uses would make the map
-- a wish rather than a record. A row that carries only `natural-dyeing` votes
-- for nothing, does not resolve, and raises by name.
--
-- The map is L1-only. NO RECEIVING L2 IS INVENTED (ADR decision 3), which is
-- what leaves ~20 brands with an empty `subcategories` array — a deliberate,
-- tracked debt handed to DEV-1509 rather than papered over with a guessed tag.
--
-- ---------------------------------------------------------------------------
-- WHAT IS NOT REWRITTEN
-- ---------------------------------------------------------------------------
--
-- Historical stores keep their payloads as history (decision D11):
-- `brand_ai_results`, `brand_field_corrections` and `brand_field_events`.
-- DEV-1503 set that precedent explicitly at 20260819090000:558 ("Historical
-- brand_ai_results.input/raw_response are untouched"). Only submissions that
-- can still be approved — `status = 'pending'` — are converted; a non-pending
-- submission is never approved again.
--
-- `brands.draft_data` is NOT in that list. It is live, not historical: an owner
-- republishes it with one click, so it is rewritten at step 1b for the same
-- reason 20260820130000:1468-1480 rewrote it.
--
-- ---------------------------------------------------------------------------
-- TRIGGERS
-- ---------------------------------------------------------------------------
--
-- `brands_updated_at` is SUPPRESSED for step 1 and step 7 and LEFT ENABLED for
-- step 3, and the split is the point:
--
--   * step 1 respells how a fact is stored — a representation change, the same
--     treatment 20260820130000:1383 gave the slug backfill. A moved timestamp
--     would churn sitemap `lastmod` for every brand that merely carried a
--     craft tag.
--   * step 3 is a genuine editorial reassignment of the brand's L1, exactly
--     like the four-brand `kids-pets` split at 20260820090000:98-102, where the
--     timestamp was deliberately left to move.
--
-- The closing contract proves that split: the ONLY brands whose `updated_at`
-- moved must be the ones step 3 re-filed.
--
-- `brands_search_vector_trigger` stays enabled throughout and fires on
-- `category` and `subcategories`, so steps 1 and 3 rebuild search documents
-- against the OLD `taxonomy_terms`. Step 7 recomputes them after the re-seed,
-- which is what makes the intermediate state harmless. `brands_content_
-- provenance` fires only on the four description columns and is untouched.
--
-- `protect_refresh_snapshot` (20260720140736:282-307) is SUPPRESSED for the two
-- statements that write `brand_submissions.base_brand_data` — step 1d and step
-- 7 — and re-enabled immediately after each. That BEFORE UPDATE guard raises
-- 'Refresh snapshot is immutable' on ANY change to that column of a `refresh`
-- row, which is exactly what step 1d does to a pending refresh on a crafts
-- brand. Left armed it does not skip the row, it aborts all seven steps.
--
-- The invariant yields because the snapshot is not being EDITED here, it is
-- being respelled: the guard defends a captured base against operator and owner
-- writes during normal operation, and this migration is rewriting the taxonomy
-- vocabulary INSIDE that capture. Leaving the snapshot on the retired L1 is the
-- outcome the guard would buy — the refresh gate then feeds `crafts` into a
-- column whose step-5 CHECK no longer admits it and raises 23514 inside the
-- admin queue, days later.
--
-- NOT VERIFIABLE ON STAGING, the same class as the md5 pins above: staging
-- holds ZERO rows in `brand_submissions`, so the rehearsal never fires the
-- trigger at all. Production holds 1434 submissions, six of them pending on
-- crafts brands, plus a scheduled refresh job.
--
-- ---------------------------------------------------------------------------
-- THE DELETE
-- ---------------------------------------------------------------------------
--
-- The `hidden` crafts brands are deleted; their pre-migration state is exported
-- as rollback evidence at
-- `docs/reports/2026-08-20-crafts-premigration-corpus.csv` (437 rows, 146
-- distinct brands — a brand is included when it carries a departing label OR
-- sits on the crafts L1, and the second condition is what captures the hidden
-- rows, which carry no departing tag and would otherwise be unrecoverable).
--
-- Production held 127 crafts brands on 2026-08-20: 109 `approved` + 18
-- `hidden`. The count is RAISED AS A NOTICE, never asserted: staging holds 14
-- crafts brands and none of them is hidden, so an equality check would block
-- the staging rehearsal for no reason. The load-bearing contract is the one
-- after step 3 — nothing may be left on the retired L1.
--
-- Every inbound FK on `brands` cascades except `brand_submissions.brand_id`,
-- which 20260626150000:38-41 moved to ON DELETE SET NULL. A pending refresh
-- whose brand is deleted therefore loses its `brand_id` and can no longer be
-- applied, which is correct — its subject is gone. `curation_job_targets` holds
-- no FK at all (see 20260715050002:135-152), so rows pointing at a deleted
-- brand id are left as inert history.

begin;

-- ===========================================================================
-- Helpers — migration-scoped, dropped before commit
-- ===========================================================================
--
-- The first two are re-created here because 20260819090000, 20260819130000 and
-- 20260820090000 each drop both at their own tail.

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

-- The slug transform, order-preserving and de-duplicating. De-duplication is
-- not cosmetic: a brand may already carry `floral-arrangements` alongside
-- `dried-flowers-and-floral-design`, and the merge would otherwise leave the
-- same slug twice in one array. `wall-art` cannot collide the same way — it did
-- not exist before this migration — but the transform is written once for both.
--
-- A NULL element is dropped rather than propagated; `<> all(...)` is NULL for a
-- NULL input, so the filter removes it either way, and saying so is better than
-- leaving it as an accident.
create or replace function public.dev1507_retire_craft_slugs(p_slugs text[])
returns text[]
language sql
immutable
set search_path = ''
as $function$
  select case
    when p_slugs is null then null
    else coalesce(
      (
        select array_agg(kept.slug order by kept.ord)
        from (
          select distinct on (mapped.slug) mapped.slug, mapped.ord
          from (
            select
              case entry.slug
                when 'illustration-and-art' then 'wall-art'
                when 'dried-flowers-and-floral-design' then 'floral-arrangements'
                else entry.slug
              end as slug,
              entry.ord
            from unnest(p_slugs) with ordinality as entry(slug, ord)
            where entry.slug <> all (array[
              'ceramics', 'woodcraft', 'metalwork', 'bamboo-craft', 'glass-art',
              'natural-dyeing', 'leather-craft', 'embroidery', 'needle-felting',
              'weaving-and-crochet'
            ])
          ) as mapped
          order by mapped.slug, mapped.ord
        ) as kept
      ),
      '{}'::text[]
    )
  end;
$function$;

-- The container transform. Four jsonb shapes exist in the wild and all four are
-- load-bearing; the list and the reasoning are at 20260820130000:1173-1188.
-- `subcategories_en` / `subcategoriesEn` are NOT projected here: they read
-- `taxonomy_terms`, which step 6 has not re-seeded yet. Step 7 owns them.
--
-- `p_l1` replaces the retired L1 wherever a container names it. `categorySlug`
-- is the canonical key on every container except `suggested_tags`, which uses
-- `category` (20260819090000:537-538). Passing NULL leaves both alone.
create or replace function public.dev1507_retire_craft_json(
  p_value jsonb,
  p_l1 text default null
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_result jsonb := p_value;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return p_value;
  end if;

  if jsonb_typeof(p_value) = 'array' then
    return to_jsonb(
      public.dev1507_retire_craft_slugs(
        array(select jsonb_array_elements_text(p_value))
      )
    );
  end if;

  if jsonb_typeof(p_value) <> 'object' then
    return p_value;
  end if;

  if jsonb_typeof(v_result -> 'subcategories') = 'array' then
    v_result := jsonb_set(
      v_result, '{subcategories}',
      to_jsonb(
        public.dev1507_retire_craft_slugs(
          array(select jsonb_array_elements_text(v_result -> 'subcategories'))
        )
      )
    );
  end if;

  if jsonb_typeof(v_result -> 'values') = 'array' then
    v_result := jsonb_set(
      v_result, '{values}',
      to_jsonb(
        public.dev1507_retire_craft_slugs(
          array(select jsonb_array_elements_text(v_result -> 'values'))
        )
      )
    );
  end if;

  if p_l1 is not null then
    if v_result ->> 'categorySlug' = 'crafts' then
      v_result := jsonb_set(v_result, '{categorySlug}', to_jsonb(p_l1));
    end if;
    if v_result ->> 'category' = 'crafts' then
      v_result := jsonb_set(v_result, '{category}', to_jsonb(p_l1));
    end if;
  end if;

  return v_result;
end;
$function$;

-- The `_en` re-projection, split out so it can run at step 7 against the
-- re-seeded `taxonomy_terms`. `subcategories_en` is DERIVED, never converted
-- (ADR decision 9): it holds English display names, so it is re-projected from
-- the slugs rather than translated from the labels being dropped.
create or replace function public.dev1507_project_json_en(p_value jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_result jsonb := p_value;
  v_names text[];
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    return p_value;
  end if;
  if jsonb_typeof(v_result -> 'subcategories') <> 'array' then
    return v_result;
  end if;

  v_names := public.subcategory_slugs_to_names_en(
    array(select jsonb_array_elements_text(v_result -> 'subcategories'))
  );

  if v_result ? 'subcategories_en' then
    v_result := jsonb_set(v_result, '{subcategories_en}', to_jsonb(v_names));
  end if;
  if v_result ? 'subcategoriesEn' then
    v_result := jsonb_set(v_result, '{subcategoriesEn}', to_jsonb(v_names));
  end if;
  return v_result;
end;
$function$;

-- The re-file rule as one function, so brands and pending submissions cannot
-- drift apart: the same votes decide both. Returns NULL when the rule does not
-- resolve, and the caller raises by name rather than defaulting.
--
-- The L2 -> L1 parent map is transcribed from `L2_SUBCATEGORIES` in
-- `src/lib/taxonomy/ontology.ts` at 164 nodes; SQL has no other source for it,
-- because `taxonomy_terms` stores a flat (axis, slug, label) triple with no
-- parent column. It is migration-scoped and dropped before commit, so it cannot
-- become a second standing source of truth.
create or replace function public.dev1507_refile_l1(p_subcategories text[])
returns text
language sql
stable
set search_path = ''
as $function$
  with node as (
    select distinct entry.slug
    from unnest(coalesce(p_subcategories, '{}'::text[])) as entry(slug)
    where nullif(btrim(entry.slug), '') is not null
  ),
  craft_map (slug, l1) as (
    values
      ('illustration-and-art', 'home'),
      ('ceramics', 'home'),
      ('woodcraft', 'home'),
      ('glass-art', 'home'),
      ('bamboo-craft', 'home'),
      ('dried-flowers-and-floral-design', 'home'),
      ('metalwork', 'jewelry'),
      ('embroidery', 'bags-accessories'),
      ('needle-felting', 'bags-accessories'),
      ('leather-craft', 'bags-accessories'),
      ('weaving-and-crochet', 'stationery')
      -- `natural-dyeing` is absent on purpose. See the header.
  ),
  parent_group (l1, slugs) as (
    values
    ('fashion', array[
      'tops-and-tshirts', 'dresses', 'skirts', 'pants', 'outerwear',
      'underwear-and-intimates', 'loungewear', 'swimwear',
      'performance-apparel', 'activewear', 'socks', 'casual-shoes',
      'leather-shoes', 'heels', 'sandals-and-slippers', 'boots'
    ]),
    ('bags-accessories', array[
      'backpacks', 'tote-bags', 'crossbody-bags', 'handbags', 'clutches',
      'clasp-frame-bags', 'bucket-bags', 'belt-and-sling-bags',
      'eco-and-shopping-bags', 'wallets', 'coin-purses', 'card-holders',
      'storage-pouches', 'cosmetic-bags', 'laptop-bags', 'camera-bags',
      'luggage-and-travel', 'hats', 'scarves-and-shawls', 'eyewear',
      'watches', 'keychains', 'charms', 'phone-bags', 'phone-straps',
      'umbrellas', 'gloves'
    ]),
    ('jewelry', array[
      'earrings', 'necklaces', 'rings', 'bracelets-and-bangles',
      'wedding-and-couple-rings', 'brooches', 'hair-accessories',
      'cufflinks-and-tie-clips'
    ]),
    ('beauty', array[
      'handmade-soap', 'skincare', 'face-masks', 'body-care',
      'bath-and-shower', 'hair-care', 'makeup', 'sun-care', 'fragrance',
      'essential-oils-and-hydrosols', 'oral-care', 'protective-sprays',
      'feminine-care', 'beauty-tools'
    ]),
    ('home', array[
      'bedding', 'mattresses', 'furniture', 'kids-furniture', 'lighting',
      'clocks', 'home-decor', 'wall-art', 'towels', 'home-textiles',
      'rugs-and-mats', 'tableware', 'tea-and-coffee-ware', 'cookware',
      'tumblers-and-bottles', 'reusable-utensils-and-straws', 'storage',
      'cleaning', 'home-appliances', 'home-fragrance', 'candles',
      'floral-arrangements', 'plants', 'curtains', 'bath-accessories',
      'hand-tools', 'pest-control', 'figurines-and-plush'
    ]),
    ('food-drink', array[
      'tea', 'tea-bags', 'tea-drinks', 'coffee', 'chocolate-and-cacao',
      'honey', 'jams-and-spreads', 'desserts-and-pastries',
      'cookies-and-rice-crackers', 'snacks', 'dried-fruits',
      'rice-and-grains', 'fresh-produce', 'dairy', 'milk-powder', 'alcohol',
      'beverages', 'seasonings-and-sauces', 'ready-meals', 'supplements'
    ]),
    ('stationery', array[
      'journals-and-notebooks', 'washi-tape', 'stickers',
      'stamps-and-seals', 'cards-and-postcards', 'pens-and-writing',
      'calendars', 'desk-mats', 'paper-goods', 'desk-organization',
      'bookmarks', 'craft-kits-and-supplies'
    ]),
    ('tech', array[
      'phone-cases', 'device-sleeves', 'chargers-and-cables', 'power-banks',
      'wireless-charging', 'earphones-and-headphones', 'speakers',
      'stands-and-mounts', 'storage-devices', 'security-cameras',
      'smart-doorbells'
    ]),
    ('outdoor', array[
      'hiking-and-camping-gear', 'picnic-supplies',
      'wetsuits-and-water-sports', 'cycling-and-riding', 'helmets',
      'outdoor-accessories'
    ]),
    ('fitness', array[
      'yoga-gear', 'fitness-equipment', 'massage-and-recovery',
      'protective-gear', 'care-and-mobility-aids'
    ]),
    ('kids', array[
      'kids-clothing', 'family-matching', 'baby-clothing', 'baby-bedding',
      'bibs-and-muslin', 'kids-tableware', 'toys', 'learning-aids',
      'play-mats-and-fences', 'parenting-essentials'
    ]),
    ('pets', array[
      'pet-food', 'pet-treats', 'pet-supplements', 'pet-apparel',
      'pet-beds-and-scratchers', 'pet-grooming', 'pet-supplies'
    ])
  ),
  parent (slug, l1) as (
    select unnest(parent_group.slugs), parent_group.l1
    from parent_group
  ),
  vote as (
    select
      coalesce(craft_map.l1, parent.l1) as l1,
      craft_map.l1 is not null as is_craft
    from node
    left join craft_map on craft_map.slug = node.slug
    left join parent on parent.slug = node.slug
    where coalesce(craft_map.l1, parent.l1) is not null
  ),
  tally as (
    select vote.l1, count(*) as votes from vote group by vote.l1
  ),
  winner as (
    select tally.l1 from tally
    where tally.votes = (select max(inner_tally.votes) from tally as inner_tally)
  ),
  craft_tally as (
    select vote.l1, count(*) as votes from vote where vote.is_craft group by vote.l1
  ),
  craft_winner as (
    select craft_tally.l1 from craft_tally
    where craft_tally.votes
      = (select max(inner_craft.votes) from craft_tally as inner_craft)
  )
  select case
    when (select count(*) from winner) = 1
      then (select winner.l1 from winner)
    -- The tiebreak OVERRIDES the tied use-axis winners rather than filtering
    -- them: the craft majority may name an L1 that is not among them.
    when (select count(*) from winner) > 1
      and (select count(*) from craft_winner) = 1
      then (select craft_winner.l1 from craft_winner)
    else null
  end;
$function$;

-- ===========================================================================
-- Step 0 — snapshots and the re-file plan, computed before anything is written
-- ===========================================================================
--
-- The vote reads the subcategories the brand held BEFORE step 1, so the plan is
-- built first and merely APPLIED at step 3. Building it here also lets step 1
-- give each pending submission the same L1 its brand is about to receive,
-- without reordering the two steps.

create temporary table dev1507_brands_before on commit drop as
select id, slug, status, category, subcategories, subcategories_en, updated_at
from public.brands;

create temporary table dev1507_refile_plan on commit drop as
select
  before.id,
  before.slug,
  before.status,
  coalesce(explicit.l1, public.dev1507_refile_l1(before.subcategories)) as target
from dev1507_brands_before as before
left join (
  values
    -- The 13 explicit assignments, confirmed by the human on 2026-08-20.
    -- Distribution: stationery 6, home 5, bags-accessories 1, beauty 1.
    -- Reasons, one per row, are in the frozen inputs file.
    ('nagi-nagi', 'stationery'),
    ('jmofinger', 'stationery'),
    ('sweet-house', 'stationery'),
    ('singezih', 'stationery'),
    ('gshop', 'stationery'),
    ('littdlework', 'stationery'),
    ('chuji-handmade', 'beauty'),
    ('dawn-creative', 'home'),
    ('homm-sound', 'home'),
    ('tp-minihorn', 'home'),
    ('chang-che', 'home'),
    ('v-j-studio', 'home'),
    ('embroidery', 'bags-accessories')
) as explicit (slug, l1) on explicit.slug = before.slug
where before.category = 'crafts';

do $migration$
declare
  v_total integer;
  v_unresolved text;
begin
  select count(*) into v_total from dev1507_refile_plan;
  raise notice 'DEV-1507 re-file plan covers % brand(s) on the crafts L1', v_total;

  -- Reported, not raised: a `hidden` row is deleted at step 2 and never needs a
  -- target. The load-bearing check is the leftover assertion after step 3.
  select string_agg(plan.slug || '/' || plan.status, ', ' order by plan.slug)
  into v_unresolved
  from dev1507_refile_plan as plan
  where plan.target is null;

  if v_unresolved is not null then
    raise notice
      'DEV-1507 the rule leaves these brand(s) unresolved: %', v_unresolved;
  end if;
end
$migration$;

-- The pending submissions the retired L1 can still reach. Captured now so step
-- 7 can re-project exactly these rows and no others.
--
-- THE SELECTION MUST NOT KEY ON ONE CONTAINER. `enriched_data ->> 'categorySlug'`
-- alone finds almost none of them:
--
--   * a refresh snapshot carries the L1 as `base_brand_data ->> 'category'` —
--     20260720140736:112 builds it as `to_jsonb(v_brand) - …`, so it holds the
--     snake_case ROW columns and never a `categorySlug` key at all, which is
--     what `refreshReviewSource` reads back (src/lib/services/submissions.ts:759-767);
--   * `owner_data` and `suggested_tags` key on `category` too
--     (src/lib/services/submissions.ts:464-466) — the same two spellings
--     `dev1507_retire_craft_json` already handles on the WRITE side;
--   * `->>` on an absent key or a NULL column yields NULL, and `NULL = 'crafts'`
--     is NULL, so a missing key excludes the row SILENTLY rather than failing.
--
-- 20260820130000:1491-1504 set the precedent by converting all five columns for
-- every `status = 'pending'` row with no container filter at all. The predicate
-- below is that predicate plus a reason to be there: it asks the transform
-- itself whether the row moves, and adds the ten L1 spellings the L2-only
-- transform cannot see. Keeping the filter is what lets step 7 re-project
-- exactly these rows, and what keeps the unresolved-target assertion below
-- about crafts rather than about every pending submission in the queue.
create temporary table dev1507_pending_submissions on commit drop as
select
  submission.id,
  -- The owning brand's status, carried so the assertion below can tell an
  -- unresolved submission that needs a human from one whose brand step 2 is
  -- about to delete.
  plan.status as brand_status,
  coalesce(
    plan.target,
    public.dev1507_refile_l1(
      -- Guarded rather than unwrapped: `jsonb_array_elements_text` ERRORS on a
      -- scalar or a missing key, and an enriched blob whose `subcategories` is
      -- null is a legitimate shape. A row with no votes falls through to the
      -- assertion below and is named, not defaulted.
      case
        when jsonb_typeof(submission.enriched_data -> 'subcategories') = 'array'
          then array(
            select jsonb_array_elements_text(submission.enriched_data -> 'subcategories')
          )
        else '{}'::text[]
      end
    )
  ) as target
from public.brand_submissions as submission
left join dev1507_refile_plan as plan on plan.id = submission.brand_id
where submission.status = 'pending'
  and (
    -- Any container carrying a retired L2, asked of the transform rather than
    -- guessed. The one-argument form leaves the L1 alone, so this tests the L2
    -- axis only.
    submission.base_brand_data
      is distinct from public.dev1507_retire_craft_json(submission.base_brand_data)
    or submission.review_overrides
      is distinct from public.dev1507_retire_craft_json(submission.review_overrides)
    or submission.owner_data
      is distinct from public.dev1507_retire_craft_json(submission.owner_data)
    or submission.enriched_data
      is distinct from public.dev1507_retire_craft_json(submission.enriched_data)
    or submission.suggested_tags
      is distinct from public.dev1507_retire_craft_json(submission.suggested_tags)
    -- Plus any container naming the retired L1 under either spelling. `= any`
    -- over an array of NULLs is NULL, not false, so the coalesce is required.
    or coalesce(
      'crafts' = any (array[
        submission.base_brand_data  ->> 'category',
        submission.base_brand_data  ->> 'categorySlug',
        submission.review_overrides ->> 'category',
        submission.review_overrides ->> 'categorySlug',
        submission.owner_data       ->> 'category',
        submission.owner_data       ->> 'categorySlug',
        submission.enriched_data    ->> 'category',
        submission.enriched_data    ->> 'categorySlug',
        submission.suggested_tags   ->> 'category',
        submission.suggested_tags   ->> 'categorySlug'
      ]),
      false
    )
  );

-- ===========================================================================
-- Step 1 — rewrite the slugs
-- ===========================================================================

-- 1a. brands.subcategories. Representation-only: no brand timestamp may move.
alter table public.brands disable trigger brands_updated_at;

update public.brands as b
set subcategories = public.dev1507_retire_craft_slugs(b.subcategories)
where b.subcategories is distinct from public.dev1507_retire_craft_slugs(b.subcategories);

-- 1b. brands.draft_data — the camelCase container holding an owner's unsaved
-- edit (`BRAND_DRAFT_EDITABLE_KEYS`, src/lib/services/brands.ts:495-512), and
-- one of the four load-bearing jsonb shapes listed at 20260820130000:1173-1188.
-- Rewritten for the same reason 20260820130000:1468-1480 rewrote it: nothing
-- else does. `publishDraft` (src/lib/services/brands.ts:2376) feeds the
-- snapshot straight back through `updateBrand`, so a draft still naming the
-- retired L1 writes `crafts` into a column whose step-5 CHECK no longer admits
-- it and raises 23514 — days after this migration, inside the owner's UI. Short
-- of that, the edit form preselects a `categorySlug` that is not in its own
-- `<select>` and renders the retired L2s as chips resolving to nothing.
--
-- The L1 comes from the plan, so a draft receives exactly the L1 its brand is
-- about to receive at step 3. A brand that never sat on `crafts` and merely
-- carries a retired L2 in its draft has no plan row; the scalar subquery is
-- NULL there, which leaves `categorySlug` untouched — correct, that brand's L1
-- was never `crafts` — while the L2s are still stripped.
--
-- No step-7 companion: `BRAND_DRAFT_EDITABLE_KEYS` carries no `subcategoriesEn`
-- key, so this container holds no English projection to re-derive.
update public.brands as b
set draft_data = public.dev1507_retire_craft_json(
      b.draft_data,
      (select plan.target from dev1507_refile_plan as plan where plan.id = b.id)
    )
where b.draft_data is not null
  and b.draft_data is distinct from public.dev1507_retire_craft_json(
        b.draft_data,
        (select plan.target from dev1507_refile_plan as plan where plan.id = b.id)
      );

alter table public.brands enable trigger brands_updated_at;

-- 1c. curated_products.subcategories. The table has no `subcategories_en`
-- column, so there is nothing to re-project at step 7.
update public.curated_products as p
set subcategories = public.dev1507_retire_craft_slugs(p.subcategories)
where p.subcategories is distinct from public.dev1507_retire_craft_slugs(p.subcategories);

-- 1d. The pending submission blobs, all five jsonb containers.
--
-- The L2 arrays would in fact self-heal: `approve_submission` and the refresh
-- gate both pass their payload through `subcategory_json_to_slugs`
-- (baseline dump lines 186 and 447), and step 4 leaves every departing label
-- keyed either to its successor or to a recorded eviction. They are rewritten
-- anyway, because the admin queue RENDERS the stored blob before approval and a
-- retired slug shows there as a chip that resolves to nothing.
--
-- The L1 does NOT self-heal — no resolver exists for `categorySlug` — so
-- without this a pending crafts submission would pass every check until an
-- admin clicked approve, and then raise inside the queue.
--
-- `protect_refresh_snapshot` (20260720140736:282-307) is suppressed for this
-- statement and re-enabled immediately after — see the header. It raises
-- 'Refresh snapshot is immutable' the moment `base_brand_data` differs on a
-- `refresh` row, and on a pending refresh over a crafts brand it genuinely
-- does differ: `category`/`categorySlug` becomes the plan's L1 and the retired
-- L2 slugs are stripped. The guard protects a captured base from being edited
-- during normal operation, not from having its vocabulary respelled by a
-- migration, and a snapshot left naming the retired L1 is what raises 23514
-- inside the admin queue later. Staging could not exercise it: it holds no
-- `brand_submissions` rows.
alter table public.brand_submissions disable trigger protect_refresh_snapshot;

update public.brand_submissions as submission
set base_brand_data  = public.dev1507_retire_craft_json(submission.base_brand_data, pending.target),
    review_overrides = public.dev1507_retire_craft_json(submission.review_overrides, pending.target),
    owner_data       = public.dev1507_retire_craft_json(submission.owner_data, pending.target),
    enriched_data    = public.dev1507_retire_craft_json(submission.enriched_data, pending.target),
    suggested_tags   = public.dev1507_retire_craft_json(submission.suggested_tags, pending.target)
from dev1507_pending_submissions as pending
where pending.id = submission.id;

alter table public.brand_submissions enable trigger protect_refresh_snapshot;

do $migration$
declare
  v_pending integer;
  v_doomed text;
  v_unresolved text;
begin
  select count(*) into v_pending from dev1507_pending_submissions;
  raise notice 'DEV-1507 converted % pending submission blob(s)', v_pending;

  -- Reported, not raised — the same choice step 0 makes for the same condition,
  -- and for the same reason. The owning brand is `hidden`, so step 2 deletes it
  -- and 20260626150000:38-41 nulls this row's `brand_id`; the submission can
  -- never be applied again and never needs a target. Raising here would also
  -- print a hint ("add the owning brand slug to the explicit block") that is
  -- meaningless advice about a brand which is about to stop existing.
  -- 20260720140736:98 admits `hidden` brands to refresh, so the path is real:
  -- production held 18 hidden crafts brands on 2026-08-20.
  select string_agg(pending.id::text, ', ' order by pending.id::text)
  into v_doomed
  from dev1507_pending_submissions as pending
  where pending.target is null
    and pending.brand_status = 'hidden';

  if v_doomed is not null then
    raise notice
      'DEV-1507 pending submission(s) left without a target because their hidden crafts brand is deleted at step 2: %',
      v_doomed;
  end if;

  select string_agg(pending.id::text, ', ' order by pending.id::text)
  into v_unresolved
  from dev1507_pending_submissions as pending
  where pending.target is null
    and pending.brand_status is distinct from 'hidden';

  if v_unresolved is not null then
    raise exception
      'DEV-1507 pending submission(s) on the retired crafts L1 that the re-file rule cannot resolve: %; assign each one explicitly before deploying',
      v_unresolved
      using errcode = 'P0001',
            hint = 'Add the owning brand slug to the explicit block in this migration, or reject the submission.';
  end if;
end
$migration$;

-- ===========================================================================
-- Step 2 — delete the `hidden` crafts brands
-- ===========================================================================

do $migration$
declare
  v_deleted integer;
begin
  delete from public.brands
  where category = 'crafts' and status = 'hidden';

  get diagnostics v_deleted = row_count;

  -- Production held 18 on 2026-08-20; staging holds none. A notice, not an
  -- assertion — see the header.
  raise notice 'DEV-1507 deleted % hidden crafts brand(s)', v_deleted;
end
$migration$;

-- ===========================================================================
-- Step 3 — re-file brands.category
-- ===========================================================================
--
-- The timestamp trigger stays ENABLED here: this is an editorial reassignment,
-- not a respelling.

update public.brands as b
set category = plan.target
from dev1507_refile_plan as plan
where plan.id = b.id
  and plan.target is not null
  and b.category = 'crafts';

do $migration$
declare
  v_orphans text;
  v_products text;
begin
  select string_agg(b.slug, ', ' order by b.slug)
  into v_orphans
  from public.brands as b
  where b.category = 'crafts';

  if v_orphans is not null then
    raise exception
      'DEV-1507 brand(s) still on the retired crafts L1 and unresolved by the map, the tiebreak and the explicit list: %; classify each one before deploying',
      v_orphans
      using errcode = 'P0001',
            hint = 'Add the slug to the explicit assignment block in this migration; see docs/reports/2026-08-20-crafts-refile-assignments.md.';
  end if;

  -- Curated products inherit their brand's decision. A product whose brand was
  -- deleted at step 2 went with it (ON DELETE CASCADE), so after this nothing
  -- can be left — the assertion is the proof, not the hope.
  update public.curated_products as p
  set category = b.category
  from public.brands as b
  where b.id = p.brand_id
    and p.category = 'crafts';

  select string_agg(p.key, ', ' order by p.key)
  into v_products
  from public.curated_products as p
  where p.category = 'crafts';

  if v_products is not null then
    raise exception
      'DEV-1507 curated product(s) still on the retired crafts L1: %', v_products
      using errcode = 'P0001';
  end if;
end
$migration$;

-- ===========================================================================
-- Step 4 — the label ledger
-- ===========================================================================
--
-- `subcategory_label_map` is the table that makes a dropped label an EXPLICIT
-- outcome rather than a silent one: every string the storage layer accepts is
-- either a slug (`disposition = 'resolve'`) or a recorded removal, and anything
-- absent RAISES (20260820130000:1131-1137). 55 rows target one of the twelve
-- departing slugs; all 55 move, and none is deleted.
--
-- Leaving the 42 at `resolve` would let approval accept a label that resolves
-- to a slug the reader can no longer look up — the exact silent drop this table
-- exists to prevent. Deleting them would be worse still: absence raises, so a
-- brand carrying the label could never be re-approved at all.

update public.subcategory_label_map
set target_slug = 'wall-art'
where target_slug = 'illustration-and-art';

update public.subcategory_label_map
set target_slug = 'floral-arrangements'
where target_slug = 'dried-flowers-and-floral-design';

update public.subcategory_label_map
set target_slug = null,
    disposition = 'evicted'
where target_slug in (
  'ceramics', 'woodcraft', 'metalwork', 'bamboo-craft', 'glass-art',
  'natural-dyeing', 'leather-craft', 'embroidery', 'needle-felting',
  'weaving-and-crochet'
);

-- The identity rows for the relocated node. `wall-art` did not exist when
-- 20260820130000 generated this table, so its slug, its zh-TW name and its
-- English name key NOTHING — and a stored `wall-art` reaching
-- `subcategory_labels_to_slugs` through either `approve_submission` or the
-- refresh gate would raise "resolves to no slug". This migration WRITES that
-- slug into brands.subcategories at step 1, so the three keys are not optional.
-- The eight keys that already pointed at `illustration-and-art`
-- (`illustration & art`, `illustration-and-art`, 插畫, 插畫畫作, 水彩, 無框畫,
-- 版畫, 畫作) were re-pointed above and now serve as its aliases, which is what
-- makes an old stored spelling self-heal on read. `floral-arrangements` needs
-- nothing: it was already a node and already carries its own identity rows.
--
-- One known gap is deliberately NOT closed here: 永生花, an alias Wave 2 added
-- to `floral-arrangements`, is absent from this table entirely. Nothing stores
-- it, so nothing breaks; it is a generator-parity item for the next
-- `scripts/backfill-subcategory-slugs.ts --emit`, not a migration deliverable.
insert into public.subcategory_label_map (label_key, target_slug, disposition)
select public.subcategory_label_key(raw.label), 'wall-art', 'resolve'
from (values ('wall-art'), ('Wall Art'), ('掛畫・畫作')) as raw (label)
on conflict (label_key) do update
  set target_slug = excluded.target_slug,
      disposition = excluded.disposition;

do $migration$
declare
  v_repointed integer;
  v_evicted integer;
  v_stragglers text;
begin
  select count(*) into v_repointed
  from public.subcategory_label_map
  where target_slug in ('wall-art', 'floral-arrangements');

  select count(*) into v_evicted
  from public.subcategory_label_map
  where disposition = 'evicted';

  raise notice
    'DEV-1507 label ledger: % row(s) now resolve to wall-art or floral-arrangements, % evicted in total',
    v_repointed, v_evicted;

  -- The load-bearing contract: no row may still point at a retired slug.
  select string_agg(label_key, ', ' order by label_key)
  into v_stragglers
  from public.subcategory_label_map
  where target_slug in (
    'illustration-and-art', 'dried-flowers-and-floral-design',
    'ceramics', 'woodcraft', 'metalwork', 'bamboo-craft', 'glass-art',
    'natural-dyeing', 'leather-craft', 'embroidery', 'needle-felting',
    'weaving-and-crochet'
  );

  if v_stragglers is not null then
    raise exception
      'DEV-1507 subcategory_label_map row(s) still resolve to a retired craft slug: %',
      v_stragglers
      using errcode = 'P0001';
  end if;
end
$migration$;

-- ===========================================================================
-- Step 5, site 1/5 — brands_category_check
-- ===========================================================================

alter table public.brands
  drop constraint if exists brands_category_check;

alter table public.brands
  add constraint brands_category_check
  check (category in (
    'fashion', 'bags-accessories', 'jewelry', 'beauty', 'home',
    'food-drink', 'stationery', 'tech', 'outdoor',
    'fitness', 'kids', 'pets'
  ));

-- ===========================================================================
-- Step 5, site 2/5 — curated_products_category_check
-- ===========================================================================
--
-- Drop and re-add, not rename: 20260819120000:55-95 renamed this constraint
-- precisely so its predicate could not drift, and that protection ends the
-- moment the vocabulary itself changes — a rename cannot remove a slug. It is
-- safe here because a CHECK carries no grants, unlike DROP FUNCTION, which
-- re-applies Supabase's default privileges to anon and authenticated.

alter table public.curated_products
  drop constraint if exists curated_products_category_check;

alter table public.curated_products
  add constraint curated_products_category_check
  check (category in (
    'fashion', 'bags-accessories', 'jewelry', 'beauty', 'home',
    'food-drink', 'stationery', 'tech', 'outdoor',
    'fitness', 'kids', 'pets'
  ));

-- ===========================================================================
-- Step 5, sites 3/5 and 4/5 — the two hand-patched function bodies
-- ===========================================================================

do $migration$
declare
  v_legacy_l1_list text;
  v_final_l1_list text;
  v_approve text;
  v_refresh text;
begin
  -- Fingerprints first: nothing is rewritten until both bodies match the
  -- 2026-08-20 03:04:52 UTC dump recorded in this file's header.
  perform public.dev1503_contract_assert_function(
    'public.approve_submission(uuid,uuid,jsonb)'::regprocedure,
    '912cfb416ad6e5d6baed4cc067d90736'
  );
  perform public.dev1503_contract_assert_function(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure,
    '755f6933919d0f4eb1b8aeb59d9d29d5'
  );

  -- The six-space indent on the continuation lines is PART OF THE ANCHOR.
  -- dev1503_contract_replace_exact matches bytes, not SQL tokens, and this is
  -- exactly how pg_get_functiondef re-prints both bodies. Reformatting the
  -- three lines below makes the expected-count contract raise rather than
  -- silently miss.
  v_legacy_l1_list :=
    $anchor$'fashion', 'bags-accessories', 'jewelry', 'beauty', 'home',$anchor$ || E'\n' ||
    $anchor$      'food-drink', 'crafts', 'stationery', 'tech', 'outdoor',$anchor$ || E'\n' ||
    $anchor$      'fitness', 'kids', 'pets'$anchor$;

  v_final_l1_list :=
    $anchor$'fashion', 'bags-accessories', 'jewelry', 'beauty', 'home',$anchor$ || E'\n' ||
    $anchor$      'food-drink', 'stationery', 'tech', 'outdoor',$anchor$ || E'\n' ||
    $anchor$      'fitness', 'kids', 'pets'$anchor$;

  -- 3/5 approve_submission — one occurrence, the publishable-core guard that
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
    v_approve, 'crafts', 'crafts', 0
  );
  execute v_approve;

  -- 4/5 apply_brand_refresh_with_protected_location_gate — one occurrence,
  -- OCCURRENCE 6/6 in that body's own numbering (the publishable-core guard,
  -- not one of the five purchase-channel array allow-lists).
  v_refresh := pg_get_functiondef(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
  );
  v_refresh := public.dev1503_contract_replace_exact(
    v_refresh, v_legacy_l1_list, v_final_l1_list, 1
  );
  v_refresh := public.dev1503_contract_replace_exact(
    v_refresh, 'crafts', 'crafts', 0
  );
  execute v_refresh;
end
$migration$;

-- ===========================================================================
-- Step 6 — re-seed taxonomy_terms IN FULL
-- ===========================================================================
--
-- The block below is generated by `scripts/generate-taxonomy-terms.ts` and
-- carries all 188 rows, not a crafts-shaped delta: the generator rewrites
-- whatever sits between its markers, and the parity test compares the parsed
-- block against the whole ontology. Expected per-axis counts after this
-- migration: l1 12, l2 164, material 12.
--
-- Safe to rebuild rather than merge: the table has no triggers and no inbound
-- FKs (20260820100000:62-72), which is the same reasoning 20260820170000:144
-- recorded.
delete from public.taxonomy_terms;
-- >>> generated by scripts/generate-taxonomy-terms.ts - do not edit by hand
insert into public.taxonomy_terms (axis, slug, name_zh, name_en) values
  ('l1', 'fashion', '服飾鞋履', 'Fashion & Apparel'),
  ('l1', 'bags-accessories', '包袋配件', 'Bags & Accessories'),
  ('l1', 'jewelry', '飾品珠寶', 'Jewelry'),
  ('l1', 'beauty', '美妝保養', 'Beauty & Personal Care'),
  ('l1', 'home', '居家生活', 'Home & Living'),
  ('l1', 'food-drink', '食品飲料', 'Food & Beverage'),
  ('l1', 'stationery', '文具設計', 'Stationery & Design'),
  ('l1', 'tech', '3C科技', 'Tech & Electronics'),
  ('l1', 'outdoor', '戶外露營', 'Outdoor & Camping'),
  ('l1', 'fitness', '運動健身', 'Sports & Fitness'),
  ('l1', 'kids', '母嬰童', 'Kids & Baby'),
  ('l1', 'pets', '寵物', 'Pets'),
  ('l2', 'tops-and-tshirts', '上衣・T恤', 'Tops & T-shirts'),
  ('l2', 'dresses', '洋裝', 'Dresses'),
  ('l2', 'skirts', '裙裝', 'Skirts'),
  ('l2', 'pants', '褲裝', 'Pants'),
  ('l2', 'outerwear', '外套', 'Outerwear'),
  ('l2', 'underwear-and-intimates', '貼身衣物', 'Underwear & Intimates'),
  ('l2', 'loungewear', '睡衣・居家服', 'Loungewear'),
  ('l2', 'swimwear', '泳裝', 'Swimwear'),
  ('l2', 'performance-apparel', '機能服飾', 'Performance Apparel'),
  ('l2', 'activewear', '運動服飾', 'Activewear'),
  ('l2', 'socks', '襪子', 'Socks'),
  ('l2', 'casual-shoes', '休閒鞋', 'Casual Shoes'),
  ('l2', 'leather-shoes', '皮鞋', 'Leather Shoes'),
  ('l2', 'heels', '高跟鞋', 'Heels'),
  ('l2', 'sandals-and-slippers', '涼鞋・拖鞋', 'Sandals & Slippers'),
  ('l2', 'boots', '靴子', 'Boots'),
  ('l2', 'backpacks', '後背包', 'Backpacks'),
  ('l2', 'tote-bags', '托特包', 'Tote Bags'),
  ('l2', 'crossbody-bags', '斜背包', 'Crossbody Bags'),
  ('l2', 'handbags', '手提包', 'Handbags'),
  ('l2', 'clutches', '手拿包', 'Clutches'),
  ('l2', 'clasp-frame-bags', '口金包', 'Clasp-Frame Bags'),
  ('l2', 'bucket-bags', '水桶包', 'Bucket Bags'),
  ('l2', 'belt-and-sling-bags', '腰包・胸包', 'Belt & Sling Bags'),
  ('l2', 'eco-and-shopping-bags', '環保袋・購物袋', 'Eco & Shopping Bags'),
  ('l2', 'wallets', '皮夾・錢包', 'Wallets'),
  ('l2', 'coin-purses', '零錢包', 'Coin Purses'),
  ('l2', 'card-holders', '卡夾・證件套', 'Card Holders'),
  ('l2', 'storage-pouches', '收納包', 'Storage Pouches'),
  ('l2', 'cosmetic-bags', '化妝包', 'Cosmetic Bags'),
  ('l2', 'laptop-bags', '筆電包', 'Laptop Bags'),
  ('l2', 'camera-bags', '相機包', 'Camera Bags'),
  ('l2', 'luggage-and-travel', '行李箱・旅行袋', 'Luggage & Travel'),
  ('l2', 'hats', '帽子', 'Hats'),
  ('l2', 'scarves-and-shawls', '圍巾・披肩', 'Scarves & Shawls'),
  ('l2', 'eyewear', '眼鏡・太陽眼鏡', 'Eyewear'),
  ('l2', 'watches', '手錶', 'Watches'),
  ('l2', 'keychains', '鑰匙圈', 'Keychains'),
  ('l2', 'charms', '吊飾', 'Charms'),
  ('l2', 'phone-bags', '手機袋', 'Phone Bags'),
  ('l2', 'phone-straps', '手機背帶', 'Phone Straps'),
  ('l2', 'umbrellas', '雨傘・陽傘', 'Umbrellas'),
  ('l2', 'gloves', '手套', 'Gloves & Mittens'),
  ('l2', 'earrings', '耳環', 'Earrings'),
  ('l2', 'necklaces', '項鍊', 'Necklaces'),
  ('l2', 'rings', '戒指', 'Rings'),
  ('l2', 'bracelets-and-bangles', '手鍊・手環', 'Bracelets & Bangles'),
  ('l2', 'wedding-and-couple-rings', '婚戒・對戒', 'Wedding & Couple Rings'),
  ('l2', 'brooches', '胸針', 'Brooches'),
  ('l2', 'hair-accessories', '髮飾', 'Hair Accessories'),
  ('l2', 'cufflinks-and-tie-clips', '袖扣・領帶夾', 'Cufflinks & Tie Clips'),
  ('l2', 'handmade-soap', '手工皂', 'Handmade Soap'),
  ('l2', 'skincare', '臉部保養', 'Skincare'),
  ('l2', 'face-masks', '面膜', 'Face Masks'),
  ('l2', 'body-care', '身體保養', 'Body Care'),
  ('l2', 'bath-and-shower', '洗沐清潔', 'Bath & Shower'),
  ('l2', 'hair-care', '髮品・頭皮護理', 'Hair Care'),
  ('l2', 'makeup', '彩妝', 'Makeup'),
  ('l2', 'sun-care', '防曬', 'Sun Care'),
  ('l2', 'fragrance', '香水', 'Fragrance'),
  ('l2', 'essential-oils-and-hydrosols', '精油・純露', 'Essential Oils & Hydrosols'),
  ('l2', 'oral-care', '口腔護理', 'Oral Care'),
  ('l2', 'protective-sprays', '防蚊・止汗噴霧', 'Protective Sprays'),
  ('l2', 'feminine-care', '生理用品', 'Feminine Care'),
  ('l2', 'beauty-tools', '美妝工具・儀器', 'Beauty Tools & Devices'),
  ('l2', 'bedding', '寢具', 'Bedding'),
  ('l2', 'mattresses', '床墊', 'Mattresses'),
  ('l2', 'furniture', '家具', 'Furniture'),
  ('l2', 'kids-furniture', '兒童家具', 'Kids'' Furniture'),
  ('l2', 'lighting', '燈飾', 'Lighting'),
  ('l2', 'clocks', '時鐘', 'Clocks'),
  ('l2', 'home-decor', '居家擺飾', 'Home Décor'),
  ('l2', 'wall-art', '掛畫・畫作', 'Wall Art'),
  ('l2', 'towels', '毛巾', 'Towels'),
  ('l2', 'home-textiles', '居家織品', 'Home Textiles'),
  ('l2', 'rugs-and-mats', '地墊・地毯', 'Rugs & Mats'),
  ('l2', 'tableware', '餐具', 'Tableware'),
  ('l2', 'tea-and-coffee-ware', '茶具・咖啡器具', 'Tea & Coffee Ware'),
  ('l2', 'cookware', '鍋具', 'Cookware'),
  ('l2', 'tumblers-and-bottles', '隨行杯・保溫瓶', 'Tumblers & Bottles'),
  ('l2', 'reusable-utensils-and-straws', '環保餐具・吸管', 'Reusable Utensils & Straws'),
  ('l2', 'storage', '收納用品', 'Storage'),
  ('l2', 'cleaning', '清潔用品', 'Cleaning'),
  ('l2', 'home-appliances', '生活家電', 'Home Appliances'),
  ('l2', 'home-fragrance', '居家香氛', 'Home Fragrance'),
  ('l2', 'candles', '蠟燭', 'Candles'),
  ('l2', 'floral-arrangements', '花藝', 'Floral Arrangements'),
  ('l2', 'plants', '植栽', 'Plants'),
  ('l2', 'curtains', '窗簾', 'Curtains'),
  ('l2', 'bath-accessories', '衛浴用品', 'Bath Accessories'),
  ('l2', 'hand-tools', '手工具', 'Hand Tools'),
  ('l2', 'pest-control', '防蟲用品', 'Pest Control'),
  ('l2', 'figurines-and-plush', '公仔・玩偶', 'Figurines & Plush'),
  ('l2', 'tea', '茶葉', 'Tea'),
  ('l2', 'tea-bags', '茶包', 'Tea Bags'),
  ('l2', 'tea-drinks', '茶飲', 'Tea Drinks'),
  ('l2', 'coffee', '咖啡', 'Coffee'),
  ('l2', 'chocolate-and-cacao', '巧克力・可可', 'Chocolate & Cacao'),
  ('l2', 'honey', '蜂蜜', 'Honey'),
  ('l2', 'jams-and-spreads', '果醬・抹醬', 'Jams & Spreads'),
  ('l2', 'desserts-and-pastries', '甜點・糕點', 'Desserts & Pastries'),
  ('l2', 'cookies-and-rice-crackers', '餅乾・米餅', 'Cookies & Rice Crackers'),
  ('l2', 'snacks', '零食', 'Snacks'),
  ('l2', 'dried-fruits', '果乾', 'Dried Fruits'),
  ('l2', 'rice-and-grains', '米・雜糧', 'Rice & Grains'),
  ('l2', 'fresh-produce', '生鮮蔬果', 'Fresh Produce'),
  ('l2', 'dairy', '乳製品', 'Dairy'),
  ('l2', 'milk-powder', '奶粉', 'Milk Powder'),
  ('l2', 'alcohol', '酒類', 'Alcohol'),
  ('l2', 'beverages', '飲品', 'Beverages'),
  ('l2', 'seasonings-and-sauces', '調味料・醬料', 'Seasonings & Sauces'),
  ('l2', 'ready-meals', '料理包・加工食品', 'Ready Meals'),
  ('l2', 'supplements', '保健食品', 'Supplements'),
  ('l2', 'journals-and-notebooks', '手帳・筆記本', 'Journals & Notebooks'),
  ('l2', 'washi-tape', '紙膠帶', 'Washi Tape'),
  ('l2', 'stickers', '貼紙', 'Stickers'),
  ('l2', 'stamps-and-seals', '印章', 'Stamps & Seals'),
  ('l2', 'cards-and-postcards', '卡片・明信片', 'Cards & Postcards'),
  ('l2', 'pens-and-writing', '筆具', 'Pens & Writing'),
  ('l2', 'calendars', '月曆・日曆', 'Calendars'),
  ('l2', 'desk-mats', '桌墊', 'Desk Mats'),
  ('l2', 'paper-goods', '紙品', 'Paper Goods'),
  ('l2', 'desk-organization', '文具收納', 'Desk Organization'),
  ('l2', 'bookmarks', '書籤', 'Bookmarks'),
  ('l2', 'craft-kits-and-supplies', '手作材料・工具', 'Craft Kits & Supplies'),
  ('l2', 'phone-cases', '手機殼', 'Phone Cases'),
  ('l2', 'device-sleeves', '保護套・皮套', 'Device Sleeves'),
  ('l2', 'chargers-and-cables', '充電器・充電線', 'Chargers & Cables'),
  ('l2', 'power-banks', '行動電源', 'Power Banks'),
  ('l2', 'wireless-charging', '無線充電', 'Wireless Charging'),
  ('l2', 'earphones-and-headphones', '耳機', 'Earphones & Headphones'),
  ('l2', 'speakers', '藍牙喇叭', 'Speakers'),
  ('l2', 'stands-and-mounts', '支架', 'Stands & Mounts'),
  ('l2', 'storage-devices', '儲存裝置', 'Storage Devices'),
  ('l2', 'security-cameras', '攝影機', 'Security Cameras'),
  ('l2', 'smart-doorbells', '智慧門鈴', 'Smart Doorbells'),
  ('l2', 'hiking-and-camping-gear', '登山・露營用品', 'Hiking & Camping Gear'),
  ('l2', 'picnic-supplies', '野餐用品', 'Picnic Supplies'),
  ('l2', 'wetsuits-and-water-sports', '防寒衣・水上運動', 'Wetsuits & Water Sports'),
  ('l2', 'cycling-and-riding', '自行車・騎士用品', 'Cycling & Riding'),
  ('l2', 'helmets', '安全帽', 'Helmets'),
  ('l2', 'outdoor-accessories', '戶外配件', 'Outdoor Accessories'),
  ('l2', 'yoga-gear', '瑜珈用品', 'Yoga Gear'),
  ('l2', 'fitness-equipment', '健身器材', 'Fitness Equipment'),
  ('l2', 'massage-and-recovery', '按摩・放鬆', 'Massage & Recovery'),
  ('l2', 'protective-gear', '護具', 'Protective Gear'),
  ('l2', 'care-and-mobility-aids', '照護輔具', 'Care & Mobility Aids'),
  ('l2', 'kids-clothing', '童裝', 'Kids'' Clothing'),
  ('l2', 'family-matching', '親子裝', 'Family Matching'),
  ('l2', 'baby-clothing', '嬰幼兒服飾', 'Baby Clothing'),
  ('l2', 'baby-bedding', '嬰幼兒寢具', 'Baby Bedding'),
  ('l2', 'bibs-and-muslin', '圍兜・紗布巾', 'Bibs & Muslin'),
  ('l2', 'kids-tableware', '兒童餐具', 'Kids'' Tableware'),
  ('l2', 'toys', '玩具', 'Toys'),
  ('l2', 'learning-aids', '教具', 'Learning Aids'),
  ('l2', 'play-mats-and-fences', '遊戲地墊・圍欄', 'Play Mats & Fences'),
  ('l2', 'parenting-essentials', '育兒用品', 'Parenting Essentials'),
  ('l2', 'pet-food', '寵物食品', 'Pet Food'),
  ('l2', 'pet-treats', '寵物零食', 'Pet Treats'),
  ('l2', 'pet-supplements', '寵物保健', 'Pet Supplements'),
  ('l2', 'pet-apparel', '寵物服飾・配件', 'Pet Apparel'),
  ('l2', 'pet-beds-and-scratchers', '貓抓板・寵物床窩', 'Pet Beds & Scratchers'),
  ('l2', 'pet-grooming', '寵物清潔・美容', 'Pet Grooming'),
  ('l2', 'pet-supplies', '寵物生活用品', 'Pet Supplies'),
  ('material', 'ceramic', '陶瓷', 'Ceramic'),
  ('material', 'wood', '木', 'Wood'),
  ('material', 'textile', '織品', 'Textile'),
  ('material', 'glass', '玻璃', 'Glass'),
  ('material', 'metal', '金屬', 'Metal'),
  ('material', 'bamboo', '竹', 'Bamboo'),
  ('material', 'wool', '羊毛', 'Wool'),
  ('material', 'leather', '皮革', 'Leather'),
  ('material', 'paper', '紙', 'Paper'),
  ('material', 'stone', '石', 'Stone'),
  ('material', 'rattan', '藤', 'Rattan'),
  ('material', 'lacquer', '漆', 'Lacquer');

do $seed$
declare
  v_expected constant jsonb := '{"l1":12,"l2":164,"material":12}'::jsonb;
  v_actual jsonb;
begin
  select coalesce(jsonb_object_agg(counted.axis, counted.total), '{}'::jsonb)
    into v_actual
    from (
      select axis, count(*) as total
      from public.taxonomy_terms
      group by axis
    ) as counted;

  if v_actual is distinct from v_expected then
    raise exception
      'DEV-1510 taxonomy_terms axis counts are %, expected %',
      v_actual, v_expected
      using errcode = 'P0001';
  end if;
end
$seed$;
-- <<< end generated block

-- ===========================================================================
-- Step 7 — re-project everything that reads taxonomy_terms
-- ===========================================================================
--
-- Only now: `subcategory_slugs_to_names_en` and `taxonomy_expand_subcategories`
-- both read the table step 6 just re-seeded. Running either before it would
-- project `wall-art` to itself and index it with no zh-TW label.
--
-- Representation-only, so `brands_updated_at` is suppressed and the closing
-- contract proves that only the step-3 re-file moved a timestamp.

alter table public.brands disable trigger brands_updated_at;

update public.brands as b
set subcategories_en = public.subcategory_slugs_to_names_en(b.subcategories)
from dev1507_brands_before as before
where before.id = b.id
  and before.subcategories is distinct from b.subcategories
  and b.subcategories_en
      is distinct from public.subcategory_slugs_to_names_en(b.subcategories);

-- Search documents for every brand this migration touched on either axis. The
-- WHERE clause keeps it off the rest of the catalogue: `brands_search_document`
-- puts `category` through `to_tsvector` directly and expands only
-- `subcategories` through `taxonomy_terms`, so a brand that changed neither
-- indexes identically before and after.
update public.brands as b
set search_vector = public.brands_search_document(
  b.name, b.slug, b.category,
  b.subcategories, b.subcategories_en,
  b.description, b.blurb_en
)
from dev1507_brands_before as before
where before.id = b.id
  and (before.subcategories is distinct from b.subcategories
       or before.category is distinct from b.category);

alter table public.brands enable trigger brands_updated_at;

-- `protect_refresh_snapshot` is suppressed a second time, for the reason step
-- 1d gives: this statement writes `base_brand_data` on the same pending rows,
-- and the guard cannot tell an English re-projection from an operator's edit.
-- Both sites need it — suppressing only one still aborts the transaction.
alter table public.brand_submissions disable trigger protect_refresh_snapshot;

update public.brand_submissions as submission
set base_brand_data  = public.dev1507_project_json_en(submission.base_brand_data),
    review_overrides = public.dev1507_project_json_en(submission.review_overrides),
    owner_data       = public.dev1507_project_json_en(submission.owner_data),
    enriched_data    = public.dev1507_project_json_en(submission.enriched_data)
from dev1507_pending_submissions as pending
where pending.id = submission.id;

alter table public.brand_submissions enable trigger protect_refresh_snapshot;

-- The four DEV-1507 helpers are dropped HERE, not at the tail, and the reason
-- is the contract that follows: `dev1507_retire_craft_json` carries the literal
-- `'crafts'` in its own body, so the catalog-wide scan below would report this
-- migration's own scaffolding as a surviving site. A helper that outlived its
-- last caller by three statements is not worth weakening the scan for.
drop function public.dev1507_retire_craft_slugs(text[]);
drop function public.dev1507_retire_craft_json(jsonb, text);
drop function public.dev1507_project_json_en(jsonb);
drop function public.dev1507_refile_l1(text[]);

-- ===========================================================================
-- Closing contract — every site, read back through the live catalog
-- ===========================================================================

do $migration$
declare
  v_surface jsonb;
  v_slug text;
  v_offenders text;
  v_thin integer;
  v_craft_slugs constant text[] := array[
    'illustration-and-art', 'dried-flowers-and-floral-design',
    'ceramics', 'woodcraft', 'metalwork', 'bamboo-craft', 'glass-art',
    'natural-dyeing', 'leather-craft', 'embroidery', 'needle-felting',
    'weaving-and-crochet'
  ];
begin
  -- Sites 1/5 and 2/5, plus any CHECK anywhere that still names the retired L1.
  select string_agg(rel.relname || '.' || con.conname, ', ' order by rel.relname || '.' || con.conname)
  into v_offenders
  from pg_catalog.pg_constraint as con
  join pg_catalog.pg_class as rel on rel.oid = con.conrelid
  join pg_catalog.pg_namespace as nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and con.contype = 'c'
    and pg_catalog.pg_get_constraintdef(con.oid) like '%crafts%';

  if v_offenders is not null then
    raise exception 'DEV-1507 crafts remains in CHECK constraint(s): %', v_offenders
      using errcode = 'P0001';
  end if;

  -- Sites 3/5 and 4/5, plus anything else. Functions AND procedures; the
  -- prokind filter stays because pg_get_functiondef() errors on aggregates.
  -- The pattern is the BARE word, the same shape 20260820090000:369 used for
  -- `kids-pets`: it also catches the slug inside a comment or a second list the
  -- byte anchor never covered. `craft-kits-and-supplies` does not match it, and
  -- the 2026-08-20 census confirmed no other live object names the L1, so a
  -- false positive here would itself be the finding.
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
  into v_offenders
  from pg_catalog.pg_proc as p
  join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind in ('f', 'p')
    and pg_catalog.pg_get_functiondef(p.oid) like '%crafts%';

  if v_offenders is not null then
    raise exception 'DEV-1507 crafts remains in function or procedure: %', v_offenders
      using errcode = 'P0001';
  end if;

  -- Site 5/5 — the replicated verification loop. `purchase_channel_sql_surface`
  -- names the four functions and reads them through pg_get_functiondef at CALL
  -- time, so it re-materializes the patched bodies automatically. What it needs
  -- is proof: without this call the re-pin is an assumption; with it, the
  -- meta-guard the parity suite reads is verified inside the same transaction
  -- that moved the list.
  v_surface := public.purchase_channel_sql_surface();

  foreach v_slug in array array[
    'fashion', 'bags-accessories', 'jewelry', 'beauty', 'home',
    'food-drink', 'stationery', 'tech', 'outdoor',
    'fitness', 'kids', 'pets'
  ]
  loop
    if (v_surface -> 'functions' ->> 'approve_submission')
         not like '%''' || v_slug || '''%'
      or (v_surface -> 'functions' ->> 'apply_brand_refresh_with_protected_location_gate')
         not like '%''' || v_slug || '''%'
    then
      raise exception
        'DEV-1507 purchase_channel_sql_surface re-pin missing L1 slug %', v_slug
        using errcode = 'P0001';
    end if;
  end loop;

  if (v_surface -> 'functions' ->> 'approve_submission') like '%crafts%'
    or (v_surface -> 'functions' ->> 'apply_brand_refresh_with_protected_location_gate')
       like '%crafts%'
  then
    raise exception
      'DEV-1507 purchase_channel_sql_surface still returns a body naming crafts'
      using errcode = 'P0001';
  end if;

  -- The data side: no row on any surface may still carry a retired L2 slug.
  select string_agg(b.slug, ', ' order by b.slug)
  into v_offenders
  from public.brands as b
  where b.subcategories && v_craft_slugs;

  if v_offenders is not null then
    raise exception 'DEV-1507 brand(s) still carry a retired craft slug: %', v_offenders
      using errcode = 'P0001';
  end if;

  select string_agg(p.key, ', ' order by p.key)
  into v_offenders
  from public.curated_products as p
  where p.subcategories && v_craft_slugs;

  if v_offenders is not null then
    raise exception
      'DEV-1507 curated product(s) still carry a retired craft slug: %', v_offenders
      using errcode = 'P0001';
  end if;

  -- brands.draft_data (step 1b). It gets its own proof because it is the one
  -- container an ordinary user action replays into a live column: `publishDraft`
  -- writes `categorySlug` back to `brands.category`, so a draft this step missed
  -- would raise 23514 against the CHECK step 5 just installed. Both axes are
  -- checked — the L1 under either spelling, and the L2 array.
  select string_agg(b.slug, ', ' order by b.slug)
  into v_offenders
  from public.brands as b
  where b.draft_data is not null
    and (
      coalesce(
        'crafts' = any (array[
          b.draft_data ->> 'categorySlug',
          b.draft_data ->> 'category'
        ]),
        false
      )
      or exists (
        select 1
        from jsonb_array_elements_text(
          case
            when jsonb_typeof(b.draft_data -> 'subcategories') = 'array'
              then b.draft_data -> 'subcategories'
            else '[]'::jsonb
          end
        ) as entry(slug)
        where entry.slug = any (v_craft_slugs)
      )
    );

  if v_offenders is not null then
    raise exception
      'DEV-1507 brand(s) whose draft_data still names the retired L1 or a retired craft slug: %',
      v_offenders
      using errcode = 'P0001';
  end if;

  -- The timestamp split, proved rather than asserted in prose: step 3 is the
  -- only step allowed to move a brand's updated_at.
  select string_agg(b.slug, ', ' order by b.slug)
  into v_offenders
  from public.brands as b
  join dev1507_brands_before as before on before.id = b.id
  where b.updated_at is distinct from before.updated_at
    and not exists (
      select 1 from dev1507_refile_plan as plan where plan.id = b.id
    );

  if v_offenders is not null then
    raise exception
      'DEV-1507 brands.updated_at moved on brand(s) the re-file did not touch: %',
      v_offenders
      using errcode = 'P0001';
  end if;

  -- The tracked debt, reported so DEV-1509 gets a number rather than a guess.
  -- ~20 is expected and correct: the map is L1-only and no receiving L2 is
  -- invented (ADR decision 3).
  --
  -- Counted against the step-0 snapshot, NOT against `dev1507_refile_plan`. The
  -- plan is built `where before.category = 'crafts'`, but step 1a strips the ten
  -- retired slugs from EVERY brand, so a brand already on `home` whose only tag
  -- was `ceramics` is emptied by this migration and belongs in the number —
  -- while a crafts brand that was already empty before it ran does not. Joining
  -- the plan gets both cases backwards, and the `&& v_craft_slugs` assertion
  -- above cannot catch either: an empty array intersects nothing.
  select count(*) into v_thin
  from public.brands as b
  join dev1507_brands_before as before on before.id = b.id
  where coalesce(cardinality(b.subcategories), 0) = 0
    and coalesce(cardinality(before.subcategories), 0) > 0;

  raise notice
    'DEV-1507 % brand(s) were emptied of subcategories by this migration; export them for DEV-1509',
    v_thin;
end
$migration$;

drop function public.dev1503_contract_assert_function(regprocedure, text);
drop function public.dev1503_contract_replace_exact(text, text, text, integer);

commit;
