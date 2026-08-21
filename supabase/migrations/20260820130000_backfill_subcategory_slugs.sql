-- DEV-1510 Task 9 — the forward backfill: zh-TW subcategory labels -> English slugs.
--
-- `brands.subcategories` becomes the same representation `curated_products`
-- has always used. Six jsonb surfaces plus the base column move together,
-- because a half-migrated catalogue is worse than either end state: a filter
-- that matches by exact-string array overlap silently drops every row still on
-- the old representation, with no error and no type break.
--
--   1/7  brands.subcategories (+ subcategories_en, derived)
--   2/7  brands.draft_data                        — camelCase keys
--   3/7  brand_submissions x 5 jsonb columns      — pending only
--   4/7  brand_field_corrections.proposed_value / previous_value
--   5/7  brand_field_events.old_value / new_value
--   6/7  brand_ai_results.subcategories           — latest per target per phase
--   7/7  approve_submission(uuid,uuid,jsonb)      — conversion ON READ
--
-- ---------------------------------------------------------------------------
-- THE SAFETY PROPERTY: an unrecognised string RAISES, it is never skipped
-- ---------------------------------------------------------------------------
--
-- A label that resolves to nothing is indistinguishable from one meant to be
-- evicted. `public.subcategory_label_map` therefore records BOTH outcomes
-- explicitly — a slug, or a recorded removal — and anything outside the map
-- aborts the transaction naming the offending string.
--
-- Two surfaces take a LENIENT variant instead, and the reason is a contract,
-- not convenience: `brand_field_corrections` and `brand_field_events` carry the
-- novel-subcategory escape hatch (`docs/decisions/2026-07-27-correction-novel-
-- tag-escape-hatch.md`), and a correction's `remove` list is unrestricted by
-- design so that a bad stored value can always be repaired. Raising there would
-- abort the backfill on a documented feature. Those two convert what resolves,
-- pass anything else through verbatim, and RAISE NOTICE with the full list, so
-- the residue is reported rather than hidden.
--
-- ---------------------------------------------------------------------------
-- CORPUS RE-EXPORT
-- ---------------------------------------------------------------------------
--
-- The plan requires the corpus re-exported immediately before this migration
-- runs rather than reused from the 2026-08-19 snapshot, because the catalogue
-- grows and a spelling added after the snapshot is exactly what a closed list
-- misses.
--
--   Re-exported from staging (xwkigpvnheecihpxyvsl) at
--   **2026-08-19 09:04:31 UTC**, by
--   `pnpm exec tsx scripts/backfill-subcategory-slugs.ts` (dry run), which
--   reads `public.brands` live and audits every stored string against the map
--   generated below. Result: 104 brands / 323 tag-uses, **0 unresolved**.
--
--   The 795-brand / 2,446-tag-use PRODUCTION corpus is the committed
--   `scripts/slug-reverse-corpus.json` (`docs/reports/2026-08-19-taxonomy-pre-
--   migration-corpus.csv` is gitignored and absent from a fresh clone). The
--   same dry run audits it in the same pass: 2,251 resolve, 195 removed,
--   **0 unresolved**. Production carries none of the 2026-08-19 migration chain
--   and is promoted later as one deliberate release (ADR decision 3), so it
--   cannot be re-exported from here.
--
-- ---------------------------------------------------------------------------
-- DUMP PROVENANCE — site 7/7 has NO source file
-- ---------------------------------------------------------------------------
--
-- `approve_submission` is a hand-patched object that exists only in the live
-- catalog. Re-materialized live from staging (`xwkigpvnheecihpxyvsl`) at
-- **2026-08-19 14:05:52 UTC**, with:
--
--   psql "$SUPABASE_DB_URL" -At -c "
--     select p.oid::regprocedure::text,
--            md5(pg_get_functiondef(p.oid)),
--            length(pg_get_functiondef(p.oid))
--     from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public' and p.proname = 'approve_submission'"
--
-- which returned:
--
--   approve_submission(uuid,uuid,jsonb)
--     | a69ae6d982130bf3d2b666e6a3f8de15 | 8487 bytes
--
-- That md5 is the post-20260820090000 body (the kids/pets L1 split) and is
-- asserted below BEFORE anything is rewritten. This migration never re-types
-- the body: it reads it back with pg_get_functiondef at run time and
-- anchor-patches exactly one literal, the shape at
-- 20260819090000_contract_category_subcategory_vocabulary.sql:7-52.
--
-- ---------------------------------------------------------------------------
-- TRIGGERS
-- ---------------------------------------------------------------------------
--
-- Only `brands_updated_at` is disabled, following the vector-recompute pattern
-- at 20260819090000:804-809. `brands_search_vector_trigger` STAYS ENABLED and
-- must: the stored representation changes, so every search document has to be
-- rebuilt through the `taxonomy_terms` expansion that 20260820110000 installed.
-- `brands_content_provenance` fires only on the four description columns and is
-- untouched. No brand timestamp may move — this is a representation swap, not
-- an editorial edit — and the closing contract proves it.
--
-- ---------------------------------------------------------------------------
-- THE 34-ROW `體驗課程・DIY材料` TRIAGE
-- ---------------------------------------------------------------------------
--
-- ADR decision 4: 10 named brands keep `craft-kits-and-supplies`, 24 drop the
-- label. That is why `體驗課程・DIY材料` sits in `EVICTED_LABELS` (the default)
-- rather than as an alias, and why the keeper list is per-brand and explicit —
-- a rule derived from a neighbouring column would launder an editorial
-- judgement behind a heuristic that mis-files the next brand silently.
--
-- `gshop` is load-bearing. Under a plain forward transform with no triage it
-- becomes a FIFTH zero-subcategory brand — the Wave 2 rollback rehearsal found
-- exactly that — because the label is its only surviving tag.
--
-- ---------------------------------------------------------------------------
-- GENERATED BLOCKS
-- ---------------------------------------------------------------------------
--
-- The `label map` and `craft kit keepers` blocks are generated from
-- `src/lib/taxonomy/ontology.ts` by
-- `pnpm exec tsx scripts/backfill-subcategory-slugs.ts --emit`, and
-- `src/lib/services/__tests__/subcategory-backfill.integration.test.ts`
-- re-parses them so the SQL copy cannot drift away from the TypeScript
-- ontology. Do not hand-edit either block.

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
-- 0/7 — the permanent resolution registry
-- ===========================================================================
--
-- These objects OUTLIVE the migration. Site 7/7 converts on read, and a
-- submission created before the deploy can be approved months after it, so the
-- map has to be queryable at approval time rather than only during this
-- transaction. `taxonomy_terms` cannot serve: it carries canonical names only,
-- and the residual list is mostly ALIAS spellings (`帆布包`, `蛋黃酥`, `皮帶`)
-- plus 42 recorded removals that have no canonical name at all.

-- The single matching basis, byte-compatible with `normalizeSubcategoryKey`
-- (`src/lib/taxonomy/ontology.ts`): NFKC, strip the katakana middle dot
-- (U+30FB), lowercase, collapse whitespace, trim. Order differs from the
-- TypeScript only where it cannot matter — collapsing before trimming and
-- trimming after produce the same string.
create or replace function public.subcategory_label_key(p_label text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $function$
  select btrim(
    regexp_replace(
      lower(replace(normalize(p_label, NFKC), U&'\30FB', '')),
      '\s+', ' ', 'g'
    )
  );
$function$;

create table if not exists public.subcategory_label_map (
  label_key text primary key,
  target_slug text,
  disposition text not null
    check (disposition in ('resolve', 'evicted', 'out-of-frame')),
  constraint subcategory_label_map_slug_matches_disposition
    check ((disposition = 'resolve') = (target_slug is not null))
);

comment on table public.subcategory_label_map is
  'DEV-1510: every subcategory string the storage layer accepts, keyed by public.subcategory_label_key. A row is either a slug (disposition = resolve) or a RECORDED REMOVAL (evicted / out-of-frame). Absence is a hard error, never a silent drop. Generated from src/lib/taxonomy/ontology.ts.';

-- Mirrors public.taxonomy_terms (20260820100000:87-92): RLS on, read policy,
-- no anon/authenticated grant. Only postgres and service_role ever read it.
alter table public.subcategory_label_map enable row level security;
drop policy if exists subcategory_label_map_service_read on public.subcategory_label_map;
create policy subcategory_label_map_service_read
  on public.subcategory_label_map for select using (true);
revoke all on table public.subcategory_label_map from public, anon, authenticated;
grant all on table public.subcategory_label_map to postgres, service_role;

-- Idempotent on re-apply: the generated block is the whole truth, so the table
-- is rebuilt rather than merged.
delete from public.subcategory_label_map;

insert into public.subcategory_label_map (label_key, target_slug, disposition)
values
-- >>> label map
  ('activewear', 'activewear', 'resolve'),
  ('alcohol', 'alcohol', 'resolve'),
  ('baby bedding', 'baby-bedding', 'resolve'),
  ('baby clothing', 'baby-clothing', 'resolve'),
  ('baby-bedding', 'baby-bedding', 'resolve'),
  ('baby-clothing', 'baby-clothing', 'resolve'),
  ('backpacks', 'backpacks', 'resolve'),
  ('bamboo craft', 'bamboo-craft', 'resolve'),
  ('bamboo-craft', 'bamboo-craft', 'resolve'),
  ('bath & shower', 'bath-and-shower', 'resolve'),
  ('bath accessories', 'bath-accessories', 'resolve'),
  ('bath-accessories', 'bath-accessories', 'resolve'),
  ('bath-and-shower', 'bath-and-shower', 'resolve'),
  ('beauty tools & devices', 'beauty-tools', 'resolve'),
  ('beauty-tools', 'beauty-tools', 'resolve'),
  ('bedding', 'bedding', 'resolve'),
  ('belt & sling bags', 'belt-and-sling-bags', 'resolve'),
  ('belt-and-sling-bags', 'belt-and-sling-bags', 'resolve'),
  ('beverages', 'beverages', 'resolve'),
  ('bibs & muslin', 'bibs-and-muslin', 'resolve'),
  ('bibs-and-muslin', 'bibs-and-muslin', 'resolve'),
  ('body care', 'body-care', 'resolve'),
  ('body-care', 'body-care', 'resolve'),
  ('bookmarks', 'bookmarks', 'resolve'),
  ('boots', 'boots', 'resolve'),
  ('bracelets & bangles', 'bracelets-and-bangles', 'resolve'),
  ('bracelets-and-bangles', 'bracelets-and-bangles', 'resolve'),
  ('brooches', 'brooches', 'resolve'),
  ('bucket bags', 'bucket-bags', 'resolve'),
  ('bucket-bags', 'bucket-bags', 'resolve'),
  ('calendars', 'calendars', 'resolve'),
  ('camera bags', 'camera-bags', 'resolve'),
  ('camera-bags', 'camera-bags', 'resolve'),
  ('candles', 'candles', 'resolve'),
  ('card holders', 'card-holders', 'resolve'),
  ('card-holders', 'card-holders', 'resolve'),
  ('cards & postcards', 'cards-and-postcards', 'resolve'),
  ('cards-and-postcards', 'cards-and-postcards', 'resolve'),
  ('care & mobility aids', 'care-and-mobility-aids', 'resolve'),
  ('care-and-mobility-aids', 'care-and-mobility-aids', 'resolve'),
  ('casual shoes', 'casual-shoes', 'resolve'),
  ('casual-shoes', 'casual-shoes', 'resolve'),
  ('ceramics', 'ceramics', 'resolve'),
  ('chargers & cables', 'chargers-and-cables', 'resolve'),
  ('chargers-and-cables', 'chargers-and-cables', 'resolve'),
  ('charms', 'charms', 'resolve'),
  ('chocolate & cacao', 'chocolate-and-cacao', 'resolve'),
  ('chocolate-and-cacao', 'chocolate-and-cacao', 'resolve'),
  ('clasp-frame bags', 'clasp-frame-bags', 'resolve'),
  ('clasp-frame-bags', 'clasp-frame-bags', 'resolve'),
  ('cleaning', 'cleaning', 'resolve'),
  ('clocks', 'clocks', 'resolve'),
  ('clutches', 'clutches', 'resolve'),
  ('coffee', 'coffee', 'resolve'),
  ('coin purses', 'coin-purses', 'resolve'),
  ('coin-purses', 'coin-purses', 'resolve'),
  ('cookies & rice crackers', 'cookies-and-rice-crackers', 'resolve'),
  ('cookies-and-rice-crackers', 'cookies-and-rice-crackers', 'resolve'),
  ('cookware', 'cookware', 'resolve'),
  ('cosmetic bags', 'cosmetic-bags', 'resolve'),
  ('cosmetic-bags', 'cosmetic-bags', 'resolve'),
  ('craft kits & supplies', 'craft-kits-and-supplies', 'resolve'),
  ('craft-kits-and-supplies', 'craft-kits-and-supplies', 'resolve'),
  ('crossbody bags', 'crossbody-bags', 'resolve'),
  ('crossbody-bags', 'crossbody-bags', 'resolve'),
  ('cufflinks & tie clips', 'cufflinks-and-tie-clips', 'resolve'),
  ('cufflinks-and-tie-clips', 'cufflinks-and-tie-clips', 'resolve'),
  ('curtains', 'curtains', 'resolve'),
  ('cycling & riding', 'cycling-and-riding', 'resolve'),
  ('cycling-and-riding', 'cycling-and-riding', 'resolve'),
  ('dairy', 'dairy', 'resolve'),
  ('desk mats', 'desk-mats', 'resolve'),
  ('desk organization', 'desk-organization', 'resolve'),
  ('desk-mats', 'desk-mats', 'resolve'),
  ('desk-organization', 'desk-organization', 'resolve'),
  ('desserts & pastries', 'desserts-and-pastries', 'resolve'),
  ('desserts-and-pastries', 'desserts-and-pastries', 'resolve'),
  ('device sleeves', 'device-sleeves', 'resolve'),
  ('device-sleeves', 'device-sleeves', 'resolve'),
  ('diy材料包', 'craft-kits-and-supplies', 'resolve'),
  ('dresses', 'dresses', 'resolve'),
  ('dried flowers & floral design', 'dried-flowers-and-floral-design', 'resolve'),
  ('dried fruits', 'dried-fruits', 'resolve'),
  ('dried-flowers-and-floral-design', 'dried-flowers-and-floral-design', 'resolve'),
  ('dried-fruits', 'dried-fruits', 'resolve'),
  ('earphones & headphones', 'earphones-and-headphones', 'resolve'),
  ('earphones-and-headphones', 'earphones-and-headphones', 'resolve'),
  ('earrings', 'earrings', 'resolve'),
  ('eco & shopping bags', 'eco-and-shopping-bags', 'resolve'),
  ('eco-and-shopping-bags', 'eco-and-shopping-bags', 'resolve'),
  ('embroidery', 'embroidery', 'resolve'),
  ('essential oils & hydrosols', 'essential-oils-and-hydrosols', 'resolve'),
  ('essential-oils-and-hydrosols', 'essential-oils-and-hydrosols', 'resolve'),
  ('eyewear', 'eyewear', 'resolve'),
  ('face masks', 'face-masks', 'resolve'),
  ('face-masks', 'face-masks', 'resolve'),
  ('family matching', 'family-matching', 'resolve'),
  ('family-matching', 'family-matching', 'resolve'),
  ('feminine care', 'feminine-care', 'resolve'),
  ('feminine-care', 'feminine-care', 'resolve'),
  ('figurines & plush', 'figurines-and-plush', 'resolve'),
  ('figurines-and-plush', 'figurines-and-plush', 'resolve'),
  ('fitness equipment', 'fitness-equipment', 'resolve'),
  ('fitness-equipment', 'fitness-equipment', 'resolve'),
  ('floral arrangements', 'floral-arrangements', 'resolve'),
  ('floral-arrangements', 'floral-arrangements', 'resolve'),
  ('fragrance', 'fragrance', 'resolve'),
  ('fresh produce', 'fresh-produce', 'resolve'),
  ('fresh-produce', 'fresh-produce', 'resolve'),
  ('furniture', 'furniture', 'resolve'),
  ('glass art', 'glass-art', 'resolve'),
  ('glass-art', 'glass-art', 'resolve'),
  ('gloves', 'gloves', 'resolve'),
  ('gloves & mittens', 'gloves', 'resolve'),
  ('hair accessories', 'hair-accessories', 'resolve'),
  ('hair care', 'hair-care', 'resolve'),
  ('hair-accessories', 'hair-accessories', 'resolve'),
  ('hair-care', 'hair-care', 'resolve'),
  ('hand tools', 'hand-tools', 'resolve'),
  ('hand-tools', 'hand-tools', 'resolve'),
  ('handbags', 'handbags', 'resolve'),
  ('handmade soap', 'handmade-soap', 'resolve'),
  ('handmade-soap', 'handmade-soap', 'resolve'),
  ('hats', 'hats', 'resolve'),
  ('heels', 'heels', 'resolve'),
  ('helmets', 'helmets', 'resolve'),
  ('hiking & camping gear', 'hiking-and-camping-gear', 'resolve'),
  ('hiking-and-camping-gear', 'hiking-and-camping-gear', 'resolve'),
  ('home appliances', 'home-appliances', 'resolve'),
  ('home décor', 'home-decor', 'resolve'),
  ('home fragrance', 'home-fragrance', 'resolve'),
  ('home textiles', 'home-textiles', 'resolve'),
  ('home-appliances', 'home-appliances', 'resolve'),
  ('home-decor', 'home-decor', 'resolve'),
  ('home-fragrance', 'home-fragrance', 'resolve'),
  ('home-textiles', 'home-textiles', 'resolve'),
  ('honey', 'honey', 'resolve'),
  ('illustration & art', 'illustration-and-art', 'resolve'),
  ('illustration-and-art', 'illustration-and-art', 'resolve'),
  ('jams & spreads', 'jams-and-spreads', 'resolve'),
  ('jams-and-spreads', 'jams-and-spreads', 'resolve'),
  ('journals & notebooks', 'journals-and-notebooks', 'resolve'),
  ('journals-and-notebooks', 'journals-and-notebooks', 'resolve'),
  ('keychains', 'keychains', 'resolve'),
  ('kids'' clothing', 'kids-clothing', 'resolve'),
  ('kids'' furniture', 'kids-furniture', 'resolve'),
  ('kids'' tableware', 'kids-tableware', 'resolve'),
  ('kids-clothing', 'kids-clothing', 'resolve'),
  ('kids-furniture', 'kids-furniture', 'resolve'),
  ('kids-tableware', 'kids-tableware', 'resolve'),
  ('laptop bags', 'laptop-bags', 'resolve'),
  ('laptop-bags', 'laptop-bags', 'resolve'),
  ('learning aids', 'learning-aids', 'resolve'),
  ('learning-aids', 'learning-aids', 'resolve'),
  ('leather craft', 'leather-craft', 'resolve'),
  ('leather shoes', 'leather-shoes', 'resolve'),
  ('leather-craft', 'leather-craft', 'resolve'),
  ('leather-shoes', 'leather-shoes', 'resolve'),
  ('lighting', 'lighting', 'resolve'),
  ('loungewear', 'loungewear', 'resolve'),
  ('luggage & travel', 'luggage-and-travel', 'resolve'),
  ('luggage-and-travel', 'luggage-and-travel', 'resolve'),
  ('magsafe', 'wireless-charging', 'resolve'),
  ('makeup', 'makeup', 'resolve'),
  ('massage & recovery', 'massage-and-recovery', 'resolve'),
  ('massage-and-recovery', 'massage-and-recovery', 'resolve'),
  ('mattresses', 'mattresses', 'resolve'),
  ('metalwork', 'metalwork', 'resolve'),
  ('milk powder', 'milk-powder', 'resolve'),
  ('milk-powder', 'milk-powder', 'resolve'),
  ('natural dyeing', 'natural-dyeing', 'resolve'),
  ('natural-dyeing', 'natural-dyeing', 'resolve'),
  ('necklaces', 'necklaces', 'resolve'),
  ('needle felting', 'needle-felting', 'resolve'),
  ('needle-felting', 'needle-felting', 'resolve'),
  ('oral care', 'oral-care', 'resolve'),
  ('oral-care', 'oral-care', 'resolve'),
  ('outdoor accessories', 'outdoor-accessories', 'resolve'),
  ('outdoor-accessories', 'outdoor-accessories', 'resolve'),
  ('outerwear', 'outerwear', 'resolve'),
  ('pants', 'pants', 'resolve'),
  ('paper goods', 'paper-goods', 'resolve'),
  ('paper-goods', 'paper-goods', 'resolve'),
  ('parenting essentials', 'parenting-essentials', 'resolve'),
  ('parenting-essentials', 'parenting-essentials', 'resolve'),
  ('pens & writing', 'pens-and-writing', 'resolve'),
  ('pens-and-writing', 'pens-and-writing', 'resolve'),
  ('performance apparel', 'performance-apparel', 'resolve'),
  ('performance-apparel', 'performance-apparel', 'resolve'),
  ('pest control', 'pest-control', 'resolve'),
  ('pest-control', 'pest-control', 'resolve'),
  ('pet apparel', 'pet-apparel', 'resolve'),
  ('pet beds & scratchers', 'pet-beds-and-scratchers', 'resolve'),
  ('pet food', 'pet-food', 'resolve'),
  ('pet grooming', 'pet-grooming', 'resolve'),
  ('pet supplements', 'pet-supplements', 'resolve'),
  ('pet supplies', 'pet-supplies', 'resolve'),
  ('pet treats', 'pet-treats', 'resolve'),
  ('pet-apparel', 'pet-apparel', 'resolve'),
  ('pet-beds-and-scratchers', 'pet-beds-and-scratchers', 'resolve'),
  ('pet-food', 'pet-food', 'resolve'),
  ('pet-grooming', 'pet-grooming', 'resolve'),
  ('pet-supplements', 'pet-supplements', 'resolve'),
  ('pet-supplies', 'pet-supplies', 'resolve'),
  ('pet-treats', 'pet-treats', 'resolve'),
  ('phone bags', 'phone-bags', 'resolve'),
  ('phone cases', 'phone-cases', 'resolve'),
  ('phone straps', 'phone-straps', 'resolve'),
  ('phone-bags', 'phone-bags', 'resolve'),
  ('phone-cases', 'phone-cases', 'resolve'),
  ('phone-straps', 'phone-straps', 'resolve'),
  ('picnic supplies', 'picnic-supplies', 'resolve'),
  ('picnic-supplies', 'picnic-supplies', 'resolve'),
  ('plants', 'plants', 'resolve'),
  ('play mats & fences', 'play-mats-and-fences', 'resolve'),
  ('play-mats-and-fences', 'play-mats-and-fences', 'resolve'),
  ('polo衫', 'tops-and-tshirts', 'resolve'),
  ('power banks', 'power-banks', 'resolve'),
  ('power-banks', 'power-banks', 'resolve'),
  ('protective gear', 'protective-gear', 'resolve'),
  ('protective sprays', 'protective-sprays', 'resolve'),
  ('protective-gear', 'protective-gear', 'resolve'),
  ('protective-sprays', 'protective-sprays', 'resolve'),
  ('ready meals', 'ready-meals', 'resolve'),
  ('ready-meals', 'ready-meals', 'resolve'),
  ('reusable utensils & straws', 'reusable-utensils-and-straws', 'resolve'),
  ('reusable-utensils-and-straws', 'reusable-utensils-and-straws', 'resolve'),
  ('rice & grains', 'rice-and-grains', 'resolve'),
  ('rice-and-grains', 'rice-and-grains', 'resolve'),
  ('rings', 'rings', 'resolve'),
  ('rugs & mats', 'rugs-and-mats', 'resolve'),
  ('rugs-and-mats', 'rugs-and-mats', 'resolve'),
  ('sandals & slippers', 'sandals-and-slippers', 'resolve'),
  ('sandals-and-slippers', 'sandals-and-slippers', 'resolve'),
  ('scarves & shawls', 'scarves-and-shawls', 'resolve'),
  ('scarves-and-shawls', 'scarves-and-shawls', 'resolve'),
  ('seasonings & sauces', 'seasonings-and-sauces', 'resolve'),
  ('seasonings-and-sauces', 'seasonings-and-sauces', 'resolve'),
  ('security cameras', 'security-cameras', 'resolve'),
  ('security-cameras', 'security-cameras', 'resolve'),
  ('skincare', 'skincare', 'resolve'),
  ('skirts', 'skirts', 'resolve'),
  ('smart doorbells', 'smart-doorbells', 'resolve'),
  ('smart-doorbells', 'smart-doorbells', 'resolve'),
  ('snacks', 'snacks', 'resolve'),
  ('socks', 'socks', 'resolve'),
  ('speakers', 'speakers', 'resolve'),
  ('stamps & seals', 'stamps-and-seals', 'resolve'),
  ('stamps-and-seals', 'stamps-and-seals', 'resolve'),
  ('stands & mounts', 'stands-and-mounts', 'resolve'),
  ('stands-and-mounts', 'stands-and-mounts', 'resolve'),
  ('stickers', 'stickers', 'resolve'),
  ('storage', 'storage', 'resolve'),
  ('storage devices', 'storage-devices', 'resolve'),
  ('storage pouches', 'storage-pouches', 'resolve'),
  ('storage-devices', 'storage-devices', 'resolve'),
  ('storage-pouches', 'storage-pouches', 'resolve'),
  ('sun care', 'sun-care', 'resolve'),
  ('sun-care', 'sun-care', 'resolve'),
  ('supplements', 'supplements', 'resolve'),
  ('sup體驗', null, 'out-of-frame'),
  ('swimwear', 'swimwear', 'resolve'),
  ('tableware', 'tableware', 'resolve'),
  ('tea', 'tea', 'resolve'),
  ('tea & coffee ware', 'tea-and-coffee-ware', 'resolve'),
  ('tea bags', 'tea-bags', 'resolve'),
  ('tea drinks', 'tea-drinks', 'resolve'),
  ('tea-and-coffee-ware', 'tea-and-coffee-ware', 'resolve'),
  ('tea-bags', 'tea-bags', 'resolve'),
  ('tea-drinks', 'tea-drinks', 'resolve'),
  ('tops & t-shirts', 'tops-and-tshirts', 'resolve'),
  ('tops-and-tshirts', 'tops-and-tshirts', 'resolve'),
  ('tote bags', 'tote-bags', 'resolve'),
  ('tote-bags', 'tote-bags', 'resolve'),
  ('towels', 'towels', 'resolve'),
  ('toys', 'toys', 'resolve'),
  ('tumblers & bottles', 'tumblers-and-bottles', 'resolve'),
  ('tumblers-and-bottles', 'tumblers-and-bottles', 'resolve'),
  ('t恤', 'tops-and-tshirts', 'resolve'),
  ('umbrellas', 'umbrellas', 'resolve'),
  ('underwear & intimates', 'underwear-and-intimates', 'resolve'),
  ('underwear-and-intimates', 'underwear-and-intimates', 'resolve'),
  ('wallets', 'wallets', 'resolve'),
  ('washi tape', 'washi-tape', 'resolve'),
  ('washi-tape', 'washi-tape', 'resolve'),
  ('watches', 'watches', 'resolve'),
  ('weaving & crochet', 'weaving-and-crochet', 'resolve'),
  ('weaving-and-crochet', 'weaving-and-crochet', 'resolve'),
  ('wedding & couple rings', 'wedding-and-couple-rings', 'resolve'),
  ('wedding-and-couple-rings', 'wedding-and-couple-rings', 'resolve'),
  ('wetsuits & water sports', 'wetsuits-and-water-sports', 'resolve'),
  ('wetsuits-and-water-sports', 'wetsuits-and-water-sports', 'resolve'),
  ('wireless charging', 'wireless-charging', 'resolve'),
  ('wireless-charging', 'wireless-charging', 'resolve'),
  ('woodcraft', 'woodcraft', 'resolve'),
  ('yoga gear', 'yoga-gear', 'resolve'),
  ('yoga-gear', 'yoga-gear', 'resolve'),
  ('上衣', 'tops-and-tshirts', 'resolve'),
  ('上衣t恤', 'tops-and-tshirts', 'resolve'),
  ('中夾', 'wallets', 'resolve'),
  ('主食罐', 'pet-food', 'resolve'),
  ('乳液', 'skincare', 'resolve'),
  ('乳膠墊', 'mattresses', 'resolve'),
  ('乳製品', 'dairy', 'resolve'),
  ('乳酪', 'dairy', 'resolve'),
  ('乾燥花', 'dried-flowers-and-floral-design', 'resolve'),
  ('乾燥花花藝設計', 'dried-flowers-and-floral-design', 'resolve'),
  ('休閒鞋', 'casual-shoes', 'resolve'),
  ('保健食品', 'supplements', 'resolve'),
  ('保溫杯', 'tumblers-and-bottles', 'resolve'),
  ('保溫瓶', 'tumblers-and-bottles', 'resolve'),
  ('保護套', 'device-sleeves', 'resolve'),
  ('保護套皮套', 'device-sleeves', 'resolve'),
  ('保護貼', null, 'evicted'),
  ('個人護理', null, 'evicted'),
  ('偏光', 'eyewear', 'resolve'),
  ('健身器材', 'fitness-equipment', 'resolve'),
  ('側背包', 'crossbody-bags', 'resolve'),
  ('優格', 'dairy', 'resolve'),
  ('儲存裝置', 'storage-devices', 'resolve'),
  ('充電器', 'chargers-and-cables', 'resolve'),
  ('充電器充電線', 'chargers-and-cables', 'resolve'),
  ('充電線', 'chargers-and-cables', 'resolve'),
  ('兒童家具', 'kids-furniture', 'resolve'),
  ('兒童耳機', 'earphones-and-headphones', 'resolve'),
  ('兒童餐具', 'kids-tableware', 'resolve'),
  ('內搭褲', 'pants', 'resolve'),
  ('內衣', 'underwear-and-intimates', 'resolve'),
  ('內褲', 'underwear-and-intimates', 'resolve'),
  ('公仔', 'figurines-and-plush', 'resolve'),
  ('公仔玩偶', 'figurines-and-plush', 'resolve'),
  ('冷泡茶', 'tea-drinks', 'resolve'),
  ('冷製皂', 'handmade-soap', 'resolve'),
  ('切割墊', 'desk-mats', 'resolve'),
  ('刺繡', 'embroidery', 'resolve'),
  ('剪刀', 'hand-tools', 'resolve'),
  ('創作工具', 'craft-kits-and-supplies', 'resolve'),
  ('加工食品', 'ready-meals', 'resolve'),
  ('助行器', 'care-and-mobility-aids', 'resolve'),
  ('包包', null, 'evicted'),
  ('包屁衣', 'baby-clothing', 'resolve'),
  ('化妝包', 'cosmetic-bags', 'resolve'),
  ('卡夾', 'card-holders', 'resolve'),
  ('卡夾證件套', 'card-holders', 'resolve'),
  ('卡套', 'card-holders', 'resolve'),
  ('卡片', 'cards-and-postcards', 'resolve'),
  ('卡片明信片', 'cards-and-postcards', 'resolve'),
  ('印章', 'stamps-and-seals', 'resolve'),
  ('口水巾', 'bibs-and-muslin', 'resolve'),
  ('口罩', null, 'evicted'),
  ('口腔護理', 'oral-care', 'resolve'),
  ('口金包', 'clasp-frame-bags', 'resolve'),
  ('口金夾', 'clasp-frame-bags', 'resolve'),
  ('口金零錢包', 'clasp-frame-bags', 'resolve'),
  ('可可', 'chocolate-and-cacao', 'resolve'),
  ('可麗露', 'desserts-and-pastries', 'resolve'),
  ('吊扇', 'home-appliances', 'resolve'),
  ('吊飾', 'charms', 'resolve'),
  ('吸塵器', 'home-appliances', 'resolve'),
  ('吸盤碗', 'kids-tableware', 'resolve'),
  ('吸管', 'reusable-utensils-and-straws', 'resolve'),
  ('味噌', 'seasonings-and-sauces', 'resolve'),
  ('咖啡', 'coffee', 'resolve'),
  ('咖啡器具', 'tea-and-coffee-ware', 'resolve'),
  ('咖啡豆', 'coffee', 'resolve'),
  ('品茗杯', 'tea-and-coffee-ware', 'resolve'),
  ('唇膏', 'makeup', 'resolve'),
  ('單車遊湖', null, 'out-of-frame'),
  ('圍兜', 'bibs-and-muslin', 'resolve'),
  ('圍兜紗布巾', 'bibs-and-muslin', 'resolve'),
  ('圍巾', 'scarves-and-shawls', 'resolve'),
  ('圍巾披肩', 'scarves-and-shawls', 'resolve'),
  ('圍欄', 'play-mats-and-fences', 'resolve'),
  ('地墊', 'rugs-and-mats', 'resolve'),
  ('地墊地毯', 'rugs-and-mats', 'resolve'),
  ('地毯', 'rugs-and-mats', 'resolve'),
  ('堅果', 'snacks', 'resolve'),
  ('堅果醬', 'jams-and-spreads', 'resolve'),
  ('塑身衣', 'underwear-and-intimates', 'resolve'),
  ('塔', 'desserts-and-pastries', 'resolve'),
  ('壁飾', 'home-decor', 'resolve'),
  ('壓力褲', 'performance-apparel', 'resolve'),
  ('壓力襪', 'socks', 'resolve'),
  ('外套', 'outerwear', 'resolve'),
  ('多肉園藝', 'plants', 'resolve'),
  ('夜燈', 'lighting', 'resolve'),
  ('天花板材料', null, 'out-of-frame'),
  ('太陽眼鏡', 'eyewear', 'resolve'),
  ('夾克', 'outerwear', 'resolve'),
  ('奶粉', 'milk-powder', 'resolve'),
  ('婚戒', 'wedding-and-couple-rings', 'resolve'),
  ('婚戒對戒', 'wedding-and-couple-rings', 'resolve'),
  ('婚鞋', 'heels', 'resolve'),
  ('媽媽包', 'backpacks', 'resolve'),
  ('嬰兒床', 'kids-furniture', 'resolve'),
  ('嬰幼兒寢具', 'baby-bedding', 'resolve'),
  ('嬰幼兒服飾', 'baby-clothing', 'resolve'),
  ('字型', null, 'out-of-frame'),
  ('字型教育', null, 'out-of-frame'),
  ('字體授權', null, 'out-of-frame'),
  ('孟克鞋', 'leather-shoes', 'resolve'),
  ('學習湯匙', 'kids-tableware', 'resolve'),
  ('安全帽', 'helmets', 'resolve'),
  ('安撫巾', 'bibs-and-muslin', 'resolve'),
  ('客製化禮品', null, 'evicted'),
  ('家具', 'furniture', 'resolve'),
  ('寢具', 'bedding', 'resolve'),
  ('寵物保健', 'pet-supplements', 'resolve'),
  ('寵物床窩', 'pet-beds-and-scratchers', 'resolve'),
  ('寵物服飾', 'pet-apparel', 'resolve'),
  ('寵物服飾配件', 'pet-apparel', 'resolve'),
  ('寵物清潔', 'pet-grooming', 'resolve'),
  ('寵物清潔美容', 'pet-grooming', 'resolve'),
  ('寵物玩具', 'pet-supplies', 'resolve'),
  ('寵物生活用品', 'pet-supplies', 'resolve'),
  ('寵物零食', 'pet-treats', 'resolve'),
  ('寵物食品', 'pet-food', 'resolve'),
  ('對戒', 'wedding-and-couple-rings', 'resolve'),
  ('小白鞋', 'casual-shoes', 'resolve'),
  ('居家修繕服務', null, 'out-of-frame'),
  ('居家擺飾', 'home-decor', 'resolve'),
  ('居家服', 'loungewear', 'resolve'),
  ('居家清潔', 'cleaning', 'resolve'),
  ('居家生活', null, 'evicted'),
  ('居家織品', 'home-textiles', 'resolve'),
  ('居家香氛', 'home-fragrance', 'resolve'),
  ('工業用布', null, 'out-of-frame'),
  ('巧克力', 'chocolate-and-cacao', 'resolve'),
  ('巧克力可可', 'chocolate-and-cacao', 'resolve'),
  ('布丁', 'desserts-and-pastries', 'resolve'),
  ('布偶', 'toys', 'resolve'),
  ('布料', 'craft-kits-and-supplies', 'resolve'),
  ('帆布包', 'tote-bags', 'resolve'),
  ('帆布袋', 'eco-and-shopping-bags', 'resolve'),
  ('帆布鞋', 'casual-shoes', 'resolve'),
  ('帽t', 'tops-and-tshirts', 'resolve'),
  ('帽子', 'hats', 'resolve'),
  ('床包', 'bedding', 'resolve'),
  ('床墊', 'mattresses', 'resolve'),
  ('底妝', 'makeup', 'resolve'),
  ('康普茶', 'beverages', 'resolve'),
  ('彈力帶', 'fitness-equipment', 'resolve'),
  ('彌月禮盒', null, 'evicted'),
  ('彩妝', 'makeup', 'resolve'),
  ('彩妝刷具', 'beauty-tools', 'resolve'),
  ('後背包', 'backpacks', 'resolve'),
  ('德比鞋', 'leather-shoes', 'resolve'),
  ('德訓鞋', 'casual-shoes', 'resolve'),
  ('徽章', 'brooches', 'resolve'),
  ('快充頭', 'chargers-and-cables', 'resolve'),
  ('懶人鞋', 'casual-shoes', 'resolve'),
  ('成長書桌', 'kids-furniture', 'resolve'),
  ('戒指', 'rings', 'resolve'),
  ('戶外配件', 'outdoor-accessories', 'resolve'),
  ('手作材料工具', 'craft-kits-and-supplies', 'resolve'),
  ('手套', 'gloves', 'resolve'),
  ('手工具', 'hand-tools', 'resolve'),
  ('手工皂', 'handmade-soap', 'resolve'),
  ('手工皮件', 'leather-craft', 'resolve'),
  ('手帕', 'scarves-and-shawls', 'resolve'),
  ('手帳', 'journals-and-notebooks', 'resolve'),
  ('手帳筆記本', 'journals-and-notebooks', 'resolve'),
  ('手拿包', 'clutches', 'resolve'),
  ('手提包', 'handbags', 'resolve'),
  ('手染', 'natural-dyeing', 'resolve'),
  ('手機吊飾', 'phone-straps', 'resolve'),
  ('手機掛繩', 'phone-straps', 'resolve'),
  ('手機殼', 'phone-cases', 'resolve'),
  ('手機背帶', 'phone-straps', 'resolve'),
  ('手機袋', 'phone-bags', 'resolve'),
  ('手機配件', null, 'evicted'),
  ('手環', 'bracelets-and-bangles', 'resolve'),
  ('手錶', 'watches', 'resolve'),
  ('手鍊', 'bracelets-and-bangles', 'resolve'),
  ('手鍊手環', 'bracelets-and-bangles', 'resolve'),
  ('托特包', 'tote-bags', 'resolve'),
  ('扳手', 'hand-tools', 'resolve'),
  ('折疊傘', 'umbrellas', 'resolve'),
  ('披肩', 'scarves-and-shawls', 'resolve'),
  ('抱枕', 'home-textiles', 'resolve'),
  ('抱枕娃娃', 'figurines-and-plush', 'resolve'),
  ('抹布', 'cleaning', 'resolve'),
  ('抹醬', 'jams-and-spreads', 'resolve'),
  ('拖鞋', 'sandals-and-slippers', 'resolve'),
  ('按摩', 'massage-and-recovery', 'resolve'),
  ('按摩放鬆', 'massage-and-recovery', 'resolve'),
  ('按摩槍', 'massage-and-recovery', 'resolve'),
  ('排汗衣', 'performance-apparel', 'resolve'),
  ('掛鐘', 'clocks', 'resolve'),
  ('插畫', 'illustration-and-art', 'resolve'),
  ('插畫畫作', 'illustration-and-art', 'resolve'),
  ('擴香', 'home-fragrance', 'resolve'),
  ('擴香瓶', 'home-fragrance', 'resolve'),
  ('擴香石', 'home-decor', 'resolve'),
  ('攝影機', 'security-cameras', 'resolve'),
  ('支架', 'stands-and-mounts', 'resolve'),
  ('收納包', 'storage-pouches', 'resolve'),
  ('收納用品', 'storage', 'resolve'),
  ('收納盒', 'storage', 'resolve'),
  ('放鬆', 'massage-and-recovery', 'resolve'),
  ('教具', 'learning-aids', 'resolve'),
  ('文具', null, 'evicted'),
  ('文具收納', 'desk-organization', 'resolve'),
  ('文具用品', null, 'evicted'),
  ('文具禮盒', null, 'evicted'),
  ('料理包', 'ready-meals', 'resolve'),
  ('料理包加工食品', 'ready-meals', 'resolve'),
  ('斜挎包', 'crossbody-bags', 'resolve'),
  ('斜背包', 'crossbody-bags', 'resolve'),
  ('旅行收納包', 'storage-pouches', 'resolve'),
  ('旅行用品', null, 'evicted'),
  ('旅行袋', 'luggage-and-travel', 'resolve'),
  ('旅行頸枕', 'luggage-and-travel', 'resolve'),
  ('日曆', 'calendars', 'resolve'),
  ('明信片', 'cards-and-postcards', 'resolve'),
  ('時鐘', 'clocks', 'resolve'),
  ('晚宴包', 'clutches', 'resolve'),
  ('智慧門鈴', 'smart-doorbells', 'resolve'),
  ('書桌', 'furniture', 'resolve'),
  ('書籤', 'bookmarks', 'resolve'),
  ('月曆', 'calendars', 'resolve'),
  ('月曆日曆', 'calendars', 'resolve'),
  ('服飾', null, 'evicted'),
  ('服飾配件', null, 'evicted'),
  ('木作', 'woodcraft', 'resolve'),
  ('木工', 'woodcraft', 'resolve'),
  ('木藝', 'woodcraft', 'resolve'),
  ('木藝木作', 'woodcraft', 'resolve'),
  ('束口袋', 'storage-pouches', 'resolve'),
  ('杯墊', 'tableware', 'resolve'),
  ('枕頭', 'bedding', 'resolve'),
  ('果乾', 'dried-fruits', 'resolve'),
  ('果汁', 'beverages', 'resolve'),
  ('果醬', 'jams-and-spreads', 'resolve'),
  ('果醬抹醬', 'jams-and-spreads', 'resolve'),
  ('桌墊', 'desk-mats', 'resolve'),
  ('桌燈', 'lighting', 'resolve'),
  ('桌鐘', 'clocks', 'resolve'),
  ('桌面配件', 'desk-organization', 'resolve'),
  ('椅', 'furniture', 'resolve'),
  ('植栽', 'plants', 'resolve'),
  ('植物染', 'natural-dyeing', 'resolve'),
  ('樂器', null, 'evicted'),
  ('樂福鞋', 'leather-shoes', 'resolve'),
  ('模型擺飾', 'figurines-and-plush', 'resolve'),
  ('模型禮盒', null, 'evicted'),
  ('機能服飾', 'performance-apparel', 'resolve'),
  ('機能襪', 'socks', 'resolve'),
  ('機能食品', 'supplements', 'resolve'),
  ('檜木製品', 'woodcraft', 'resolve'),
  ('櫃', 'furniture', 'resolve'),
  ('止汗噴霧', 'protective-sprays', 'resolve'),
  ('止滑墊', null, 'evicted'),
  ('毛巾', 'towels', 'resolve'),
  ('毛毯', 'home-textiles', 'resolve'),
  ('毯', 'home-textiles', 'resolve'),
  ('民宿住宿', null, 'out-of-frame'),
  ('氣泡酒', 'alcohol', 'resolve'),
  ('氮化鎵', 'chargers-and-cables', 'resolve'),
  ('水上運動', 'wetsuits-and-water-sports', 'resolve'),
  ('水壺', 'tumblers-and-bottles', 'resolve'),
  ('水彩', 'illustration-and-art', 'resolve'),
  ('水桶包', 'bucket-bags', 'resolve'),
  ('沐浴乳', 'bath-and-shower', 'resolve'),
  ('沐浴露', 'pet-grooming', 'resolve'),
  ('沙發', 'furniture', 'resolve'),
  ('泳裝', 'swimwear', 'resolve'),
  ('洋裝', 'dresses', 'resolve'),
  ('洗沐清潔', 'bath-and-shower', 'resolve'),
  ('洗衣清潔用品', 'cleaning', 'resolve'),
  ('洗衣用品', 'cleaning', 'resolve'),
  ('洗衣精', 'cleaning', 'resolve'),
  ('洗面露', 'bath-and-shower', 'resolve'),
  ('洗顏皂', 'handmade-soap', 'resolve'),
  ('洗髮精', 'hair-care', 'resolve'),
  ('洗髮餅', 'hair-care', 'resolve'),
  ('洞洞毯', 'baby-bedding', 'resolve'),
  ('浴巾', 'towels', 'resolve'),
  ('涼被', 'bedding', 'resolve'),
  ('涼鞋', 'sandals-and-slippers', 'resolve'),
  ('涼鞋拖鞋', 'sandals-and-slippers', 'resolve'),
  ('淨潭淨山活動', null, 'out-of-frame'),
  ('清潔刷', 'cleaning', 'resolve'),
  ('清潔液', 'cleaning', 'resolve'),
  ('清潔用品', 'cleaning', 'resolve'),
  ('清酒', 'alcohol', 'resolve'),
  ('滾筒', 'massage-and-recovery', 'resolve'),
  ('漱口水', 'oral-care', 'resolve'),
  ('潛水', 'wetsuits-and-water-sports', 'resolve'),
  ('濕紙巾', 'parenting-essentials', 'resolve'),
  ('濾掛', 'coffee', 'resolve'),
  ('烏龍茶', 'tea', 'resolve'),
  ('無框畫', 'illustration-and-art', 'resolve'),
  ('無線充電', 'wireless-charging', 'resolve'),
  ('照護輔具', 'care-and-mobility-aids', 'resolve'),
  ('燈飾', 'lighting', 'resolve'),
  ('版畫', 'illustration-and-art', 'resolve'),
  ('牙刷', 'oral-care', 'resolve'),
  ('牙線', 'oral-care', 'resolve'),
  ('牙膏', 'oral-care', 'resolve'),
  ('牙間刷', 'oral-care', 'resolve'),
  ('牛仔褲', 'pants', 'resolve'),
  ('牛津鞋', 'leather-shoes', 'resolve'),
  ('牽繩', 'pet-apparel', 'resolve'),
  ('獨立筒', 'mattresses', 'resolve'),
  ('玩具', 'toys', 'resolve'),
  ('玻璃', 'glass-art', 'resolve'),
  ('玻璃杯盤', 'tableware', 'resolve'),
  ('玻璃琉璃', 'glass-art', 'resolve'),
  ('珍珠飾品', null, 'evicted'),
  ('琉璃', 'glass-art', 'resolve'),
  ('瑜珈墊', 'yoga-gear', 'resolve'),
  ('瑜珈服', 'activewear', 'resolve'),
  ('瑜珈用品', 'yoga-gear', 'resolve'),
  ('瑪莉珍鞋', 'leather-shoes', 'resolve'),
  ('環', 'yoga-gear', 'resolve'),
  ('環保袋', 'eco-and-shopping-bags', 'resolve'),
  ('環保袋購物袋', 'eco-and-shopping-bags', 'resolve'),
  ('環保餐具', 'reusable-utensils-and-straws', 'resolve'),
  ('環保餐具吸管', 'reusable-utensils-and-straws', 'resolve'),
  ('環境用藥', 'pest-control', 'resolve'),
  ('甜點', 'desserts-and-pastries', 'resolve'),
  ('甜點糕點', 'desserts-and-pastries', 'resolve'),
  ('生活家電', 'home-appliances', 'resolve'),
  ('生理用品', 'feminine-care', 'resolve'),
  ('生鮮蔬果', 'fresh-produce', 'resolve'),
  ('畫作', 'illustration-and-art', 'resolve'),
  ('登山', 'hiking-and-camping-gear', 'resolve'),
  ('登山背包', 'backpacks', 'resolve'),
  ('登山露營用品', 'hiking-and-camping-gear', 'resolve'),
  ('皮夾', 'wallets', 'resolve'),
  ('皮夾錢包', 'wallets', 'resolve'),
  ('皮套', 'device-sleeves', 'resolve'),
  ('皮帶', 'belt-and-sling-bags', 'resolve'),
  ('皮革工藝', 'leather-craft', 'resolve'),
  ('皮鞋', 'leather-shoes', 'resolve'),
  ('盆栽', 'plants', 'resolve'),
  ('益智玩具', 'toys', 'resolve'),
  ('益生菌', 'supplements', 'resolve'),
  ('監控攝影機', 'security-cameras', 'resolve'),
  ('監視器', 'security-cameras', 'resolve'),
  ('盤香', 'home-fragrance', 'resolve'),
  ('盲包', null, 'evicted'),
  ('相機包', 'camera-bags', 'resolve'),
  ('真無線藍牙耳機', 'earphones-and-headphones', 'resolve'),
  ('眼鏡', 'eyewear', 'resolve'),
  ('眼鏡太陽眼鏡', 'eyewear', 'resolve'),
  ('睡衣', 'loungewear', 'resolve'),
  ('睡衣居家服', 'loungewear', 'resolve'),
  ('短夾', 'wallets', 'resolve'),
  ('短靴', 'boots', 'resolve'),
  ('石材', null, 'out-of-frame'),
  ('碗盤', 'tableware', 'resolve'),
  ('磁吸', 'wireless-charging', 'resolve'),
  ('磁吸娃娃', 'figurines-and-plush', 'resolve'),
  ('磚', 'yoga-gear', 'resolve'),
  ('禮盒', null, 'evicted'),
  ('穆勒鞋', 'sandals-and-slippers', 'resolve'),
  ('空氣清淨機', 'home-appliances', 'resolve'),
  ('窗簾', 'curtains', 'resolve'),
  ('童裝', 'kids-clothing', 'resolve'),
  ('童褲', 'kids-clothing', 'resolve'),
  ('童鞋', 'kids-clothing', 'resolve'),
  ('竹編', 'bamboo-craft', 'resolve'),
  ('竹編竹藝', 'bamboo-craft', 'resolve'),
  ('竹藝', 'bamboo-craft', 'resolve'),
  ('筆具', 'pens-and-writing', 'resolve'),
  ('筆記本', 'journals-and-notebooks', 'resolve'),
  ('筆電包', 'laptop-bags', 'resolve'),
  ('筋膜球', 'fitness-equipment', 'resolve'),
  ('筷子', 'tableware', 'resolve'),
  ('米', 'rice-and-grains', 'resolve'),
  ('米雜糧', 'rice-and-grains', 'resolve'),
  ('米餅', 'cookies-and-rice-crackers', 'resolve'),
  ('米香', 'cookies-and-rice-crackers', 'resolve'),
  ('精油', 'essential-oils-and-hydrosols', 'resolve'),
  ('精油純露', 'essential-oils-and-hydrosols', 'resolve'),
  ('精華液', 'skincare', 'resolve'),
  ('糕點', 'desserts-and-pastries', 'resolve'),
  ('糙米', 'rice-and-grains', 'resolve'),
  ('紅茶', 'tea', 'resolve'),
  ('紅藜', 'rice-and-grains', 'resolve'),
  ('純露', 'essential-oils-and-hydrosols', 'resolve'),
  ('紗布巾', 'bibs-and-muslin', 'resolve'),
  ('紗布衣', 'baby-clothing', 'resolve'),
  ('紙品', 'paper-goods', 'resolve'),
  ('紙膠帶', 'washi-tape', 'resolve'),
  ('絨毛玩偶', 'figurines-and-plush', 'resolve'),
  ('網路攝影機', 'security-cameras', 'resolve'),
  ('線香', 'home-fragrance', 'resolve'),
  ('編織', 'weaving-and-crochet', 'resolve'),
  ('編織鉤織', 'weaving-and-crochet', 'resolve'),
  ('織物', null, 'evicted'),
  ('置物架', 'storage', 'resolve'),
  ('羊毛氈', 'needle-felting', 'resolve'),
  ('羊毛氈公仔', 'figurines-and-plush', 'resolve'),
  ('美妝工具儀器', 'beauty-tools', 'resolve'),
  ('美容', 'pet-grooming', 'resolve'),
  ('美容儀器', 'beauty-tools', 'resolve'),
  ('耳夾', 'earrings', 'resolve'),
  ('耳機', 'earphones-and-headphones', 'resolve'),
  ('耳環', 'earrings', 'resolve'),
  ('肉泥', 'pet-treats', 'resolve'),
  ('肩背包', 'crossbody-bags', 'resolve'),
  ('育兒用品', 'parenting-essentials', 'resolve'),
  ('胸包', 'belt-and-sling-bags', 'resolve'),
  ('胸針', 'brooches', 'resolve'),
  ('腰包', 'belt-and-sling-bags', 'resolve'),
  ('腰包胸包', 'belt-and-sling-bags', 'resolve'),
  ('膠囊', 'supplements', 'resolve'),
  ('臉部保養', 'skincare', 'resolve'),
  ('自力造筏', null, 'out-of-frame'),
  ('自然景觀體驗', null, 'out-of-frame'),
  ('自行車', 'cycling-and-riding', 'resolve'),
  ('自行車騎士用品', 'cycling-and-riding', 'resolve'),
  ('花藝', 'floral-arrangements', 'resolve'),
  ('花藝設計', 'dried-flowers-and-floral-design', 'resolve'),
  ('茶具', 'tea-and-coffee-ware', 'resolve'),
  ('茶具咖啡器具', 'tea-and-coffee-ware', 'resolve'),
  ('茶包', 'tea-bags', 'resolve'),
  ('茶會製作', null, 'out-of-frame'),
  ('茶葉', 'tea', 'resolve'),
  ('茶飲', 'tea-drinks', 'resolve'),
  ('萬年曆', 'calendars', 'resolve'),
  ('蔬果清潔用品', 'cleaning', 'resolve'),
  ('藍染', 'natural-dyeing', 'resolve'),
  ('藍染植物染', 'natural-dyeing', 'resolve'),
  ('藍牙喇叭', 'speakers', 'resolve'),
  ('藍牙耳機', 'earphones-and-headphones', 'resolve'),
  ('虱目魚鱗胜肽服飾', null, 'evicted'),
  ('蛋捲', 'cookies-and-rice-crackers', 'resolve'),
  ('蛋糕', 'desserts-and-pastries', 'resolve'),
  ('蛋黃酥', 'desserts-and-pastries', 'resolve'),
  ('蜂蜜', 'honey', 'resolve'),
  ('蠟燭', 'candles', 'resolve'),
  ('行動電源', 'power-banks', 'resolve'),
  ('行李箱', 'luggage-and-travel', 'resolve'),
  ('行李箱旅行袋', 'luggage-and-travel', 'resolve'),
  ('衛浴用品', 'bath-accessories', 'resolve'),
  ('衛生棉', 'feminine-care', 'resolve'),
  ('衣架', 'storage', 'resolve'),
  ('袖套', 'gloves', 'resolve'),
  ('袖扣', 'cufflinks-and-tie-clips', 'resolve'),
  ('袖扣領帶夾', 'cufflinks-and-tie-clips', 'resolve'),
  ('裙裝', 'skirts', 'resolve'),
  ('裝飾畫', 'home-decor', 'resolve'),
  ('褲裝', 'pants', 'resolve'),
  ('襪子', 'socks', 'resolve'),
  ('襯衫', 'tops-and-tshirts', 'resolve'),
  ('視訊門鈴', 'smart-doorbells', 'resolve'),
  ('親子裝', 'family-matching', 'resolve'),
  ('記憶卡', 'storage-devices', 'resolve'),
  ('調味料', 'seasonings-and-sauces', 'resolve'),
  ('調味料醬料', 'seasonings-and-sauces', 'resolve'),
  ('證件套', 'card-holders', 'resolve'),
  ('護具', 'protective-gear', 'resolve'),
  ('護墊', 'feminine-care', 'resolve'),
  ('護理手套', 'gloves', 'resolve'),
  ('護髮', 'hair-care', 'resolve'),
  ('貓屋', 'pet-beds-and-scratchers', 'resolve'),
  ('貓抓板', 'pet-beds-and-scratchers', 'resolve'),
  ('貓抓板寵物床窩', 'pet-beds-and-scratchers', 'resolve'),
  ('貓砂', 'pet-grooming', 'resolve'),
  ('貼紙', 'stickers', 'resolve'),
  ('貼身衣物', 'underwear-and-intimates', 'resolve'),
  ('購物袋', 'eco-and-shopping-bags', 'resolve'),
  ('起子', 'hand-tools', 'resolve'),
  ('超慢跑墊', 'fitness-equipment', 'resolve'),
  ('身體保養', 'body-care', 'resolve'),
  ('輪椅', 'care-and-mobility-aids', 'resolve'),
  ('連身裙', 'dresses', 'resolve'),
  ('遊戲地墊', 'play-mats-and-fences', 'resolve'),
  ('遊戲地墊圍欄', 'play-mats-and-fences', 'resolve'),
  ('運動內衣', 'underwear-and-intimates', 'resolve'),
  ('運動太陽眼鏡', 'eyewear', 'resolve'),
  ('運動服飾', 'activewear', 'resolve'),
  ('邊桌', 'furniture', 'resolve'),
  ('郵差包', 'crossbody-bags', 'resolve'),
  ('配件', 'pet-apparel', 'resolve'),
  ('酒類', 'alcohol', 'resolve'),
  ('醋', 'seasonings-and-sauces', 'resolve'),
  ('醬料', 'seasonings-and-sauces', 'resolve'),
  ('野餐墊', 'picnic-supplies', 'resolve'),
  ('野餐用品', 'picnic-supplies', 'resolve'),
  ('金工', 'metalwork', 'resolve'),
  ('針織衫', 'tops-and-tshirts', 'resolve'),
  ('鉤織', 'weaving-and-crochet', 'resolve'),
  ('錢包', 'wallets', 'resolve'),
  ('鍋具', 'cookware', 'resolve'),
  ('鎖骨鍊', 'necklaces', 'resolve'),
  ('鏡子', 'beauty-tools', 'resolve'),
  ('鑰匙圈', 'keychains', 'resolve'),
  ('長夾', 'wallets', 'resolve'),
  ('門鈴', 'smart-doorbells', 'resolve'),
  ('開放式耳罩耳機', 'earphones-and-headphones', 'resolve'),
  ('防寒衣', 'wetsuits-and-water-sports', 'resolve'),
  ('防寒衣水上運動', 'wetsuits-and-water-sports', 'resolve'),
  ('防摔殼', 'phone-cases', 'resolve'),
  ('防曬', 'sun-care', 'resolve'),
  ('防曬外套', 'outerwear', 'resolve'),
  ('防蚊', 'protective-sprays', 'resolve'),
  ('防蚊止汗噴霧', 'protective-sprays', 'resolve'),
  ('防蟲用品', 'pest-control', 'resolve'),
  ('防護用品', null, 'evicted'),
  ('防踢被', 'baby-bedding', 'resolve'),
  ('防風傘', 'umbrellas', 'resolve'),
  ('降噪耳機', 'earphones-and-headphones', 'resolve'),
  ('除臭襪', 'socks', 'resolve'),
  ('除蟲用品', 'pest-control', 'resolve'),
  ('陶瓷', 'ceramics', 'resolve'),
  ('陶瓷陶藝', 'ceramics', 'resolve'),
  ('陶藝', 'ceramics', 'resolve'),
  ('陽傘', 'umbrellas', 'resolve'),
  ('隨行杯', 'tumblers-and-bottles', 'resolve'),
  ('隨行杯保溫瓶', 'tumblers-and-bottles', 'resolve'),
  ('隨身碟', 'storage-devices', 'resolve'),
  ('隱形襪', 'socks', 'resolve'),
  ('雜糧', 'rice-and-grains', 'resolve'),
  ('雨傘', 'umbrellas', 'resolve'),
  ('雨傘陽傘', 'umbrellas', 'resolve'),
  ('雨衣', 'pet-apparel', 'resolve'),
  ('雨靴', 'boots', 'resolve'),
  ('雲端攝影機', 'security-cameras', 'resolve'),
  ('零錢包', 'coin-purses', 'resolve'),
  ('零食', 'snacks', 'resolve'),
  ('電動床', 'care-and-mobility-aids', 'resolve'),
  ('露營燈', 'hiking-and-camping-gear', 'resolve'),
  ('露營用品', 'hiking-and-camping-gear', 'resolve'),
  ('面膜', 'face-masks', 'resolve'),
  ('靴子', 'boots', 'resolve'),
  ('鞋子', null, 'evicted'),
  ('項圈', 'pet-apparel', 'resolve'),
  ('項鍊', 'necklaces', 'resolve'),
  ('頭皮護理', 'hair-care', 'resolve'),
  ('食品禮盒', null, 'evicted'),
  ('食器', 'pet-supplies', 'resolve'),
  ('飲品', 'beverages', 'resolve'),
  ('飲料提繩', 'eco-and-shopping-bags', 'resolve'),
  ('飲料提袋', 'eco-and-shopping-bags', 'resolve'),
  ('飼料', 'pet-food', 'resolve'),
  ('飾品珠寶', null, 'evicted'),
  ('餅乾', 'cookies-and-rice-crackers', 'resolve'),
  ('餅乾米餅', 'cookies-and-rice-crackers', 'resolve'),
  ('餐具', 'tableware', 'resolve'),
  ('餐桌', 'furniture', 'resolve'),
  ('香氛袋', 'home-fragrance', 'resolve'),
  ('香水', 'fragrance', 'resolve'),
  ('香粉', 'home-fragrance', 'resolve'),
  ('香道具', 'home-fragrance', 'resolve'),
  ('騎士服', 'cycling-and-riding', 'resolve'),
  ('騎士用品', 'cycling-and-riding', 'resolve'),
  ('骨傳導', 'earphones-and-headphones', 'resolve'),
  ('體驗課程diy材料', null, 'evicted'),
  ('高山茶', 'tea', 'resolve'),
  ('高爾夫球桿套', null, 'evicted'),
  ('高跟鞋', 'heels', 'resolve'),
  ('髮品', 'hair-care', 'resolve'),
  ('髮品頭皮護理', 'hair-care', 'resolve'),
  ('髮飾', 'hair-accessories', 'resolve'),
  ('鮮乳', 'dairy', 'resolve'),
  ('鮮食', 'pet-food', 'resolve'),
  ('麵包', 'desserts-and-pastries', 'resolve'),
  ('三角褲', 'underwear-and-intimates', 'resolve'),
  ('平口褲', 'underwear-and-intimates', 'resolve'),
  ('束衣褲', 'underwear-and-intimates', 'resolve'),
  ('比基尼', 'swimwear', 'resolve'),
  ('衝浪褲', 'swimwear', 'resolve'),
  ('雨鞋', 'boots', 'resolve'),
  ('掛畫', 'illustration-and-art', 'resolve'),
  ('護髮產品', 'hair-care', 'resolve'),
  ('玩具教具', null, 'evicted'),
  ('香氛蠟燭', null, 'evicted');
-- <<< label map

-- Strict resolver. Raises on anything the map does not know; drops recorded
-- removals; dedupes on first occurrence, preserving stored order.
--
-- IDEMPOTENT: an L2 slug is a key in the map that resolves to itself, so a
-- second apply, a row written by a post-deploy picker, and a submission created
-- after the deploy all pass through unchanged.
create or replace function public.subcategory_labels_to_slugs(p_labels text[])
returns text[]
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_label text;
  v_key text;
  v_row public.subcategory_label_map%rowtype;
  v_out text[] := '{}'::text[];
begin
  if p_labels is null then
    return null;
  end if;

  foreach v_label in array p_labels loop
    v_key := public.subcategory_label_key(v_label);
    if v_key is null or v_key = '' then
      continue;
    end if;

    select * into v_row
    from public.subcategory_label_map
    where label_key = v_key;

    if not found then
      raise exception
        'DEV-1510 subcategory "%" resolves to no slug, alias or recorded removal',
        v_label
        using errcode = 'P0001',
              hint = 'Classify it in src/lib/taxonomy/ontology.ts (node alias, EVICTED_LABELS or OUT_OF_FRAME_LABELS) then re-run scripts/backfill-subcategory-slugs.ts --emit';
    end if;

    if v_row.disposition <> 'resolve' then
      continue;
    end if;

    if not (v_row.target_slug = any(v_out)) then
      v_out := v_out || v_row.target_slug;
    end if;
  end loop;

  return v_out;
end;
$function$;

-- `subcategories_en` is DERIVED, never converted: it holds English display
-- names (ADR decision 9), so it is re-projected from the slugs the strict
-- resolver produced rather than translated from the labels being dropped.
create or replace function public.subcategory_slugs_to_names_en(p_slugs text[])
returns text[]
language sql
stable
set search_path = ''
as $function$
  select case
    when p_slugs is null then null
    else coalesce(
      (
        select array_agg(coalesce(term.name_en, entry.slug) order by entry.ord)
        from unnest(p_slugs) with ordinality as entry(slug, ord)
        left join public.taxonomy_terms as term
          on term.axis = 'l2' and term.slug = entry.slug
      ),
      '{}'::text[]
    )
  end;
$function$;

-- Container converter for every jsonb surface. Four shapes exist in the wild
-- and all four are load-bearing:
--
--   * a bare array of labels                 — older `suggested_tags` rows
--   * `{ subcategories, subcategories_en }`  — snake_case containers
--     (`enriched_data`, `base_brand_data`)
--   * `{ subcategories, subcategoriesEn }`   — camelCase containers
--     (`brands.draft_data`, `review_overrides`, `owner_data`), keyed by
--     BRAND_DRAFT_EDITABLE_KEYS (`src/lib/services/brands.ts:486-503`)
--   * `{ values, category }`                 — structured `suggested_tags`
--
-- `category` / `categorySlug` are L1 slugs and are ALREADY the storage
-- representation, so they are read but never rewritten. A converter that knew
-- only the snake_case spelling would leave every camelCase container on labels
-- while reporting success — which is the whole reason this function is keyed on
-- both.
create or replace function public.subcategory_json_to_slugs(p_value jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_result jsonb := p_value;
  v_slugs text[];
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return p_value;
  end if;

  if jsonb_typeof(p_value) = 'array' then
    return to_jsonb(
      public.subcategory_labels_to_slugs(
        array(select jsonb_array_elements_text(p_value))
      )
    );
  end if;

  if jsonb_typeof(p_value) <> 'object' then
    return p_value;
  end if;

  if jsonb_typeof(v_result -> 'subcategories') = 'array' then
    v_slugs := public.subcategory_labels_to_slugs(
      array(select jsonb_array_elements_text(v_result -> 'subcategories'))
    );
    v_result := jsonb_set(v_result, '{subcategories}', to_jsonb(v_slugs));
    if v_result ? 'subcategories_en' then
      v_result := jsonb_set(
        v_result, '{subcategories_en}',
        to_jsonb(public.subcategory_slugs_to_names_en(v_slugs))
      );
    end if;
    if v_result ? 'subcategoriesEn' then
      v_result := jsonb_set(
        v_result, '{subcategoriesEn}',
        to_jsonb(public.subcategory_slugs_to_names_en(v_slugs))
      );
    end if;
  end if;

  if jsonb_typeof(v_result -> 'values') = 'array' then
    v_result := jsonb_set(
      v_result, '{values}',
      to_jsonb(
        public.subcategory_labels_to_slugs(
          array(select jsonb_array_elements_text(v_result -> 'values'))
        )
      )
    );
  end if;

  return v_result;
end;
$function$;

revoke all on function public.subcategory_label_key(text) from public, anon, authenticated;
revoke all on function public.subcategory_labels_to_slugs(text[]) from public, anon, authenticated;
revoke all on function public.subcategory_slugs_to_names_en(text[]) from public, anon, authenticated;
revoke all on function public.subcategory_json_to_slugs(jsonb) from public, anon, authenticated;
grant execute on function public.subcategory_label_key(text) to postgres, service_role;
grant execute on function public.subcategory_labels_to_slugs(text[]) to postgres, service_role;
grant execute on function public.subcategory_slugs_to_names_en(text[]) to postgres, service_role;
grant execute on function public.subcategory_json_to_slugs(jsonb) to postgres, service_role;

-- Lenient resolver, migration-scoped. Converts what resolves, passes anything
-- else through verbatim, and accumulates the residue for one closing notice.
-- Used ONLY on the two correction surfaces; see the header for why.
--
-- The residue table is TEMPORARY and `on commit drop`, so it leaves no public
-- object behind and needs no DDL to remove. The two functions below reach it
-- through `pg_temp.` explicitly because they carry `set search_path = ''`.
create temporary table dev1510_lenient_residue (
  value text primary key,
  surface text not null
) on commit drop;

create or replace function public.dev1510_labels_to_slugs_lenient(
  p_labels text[],
  p_surface text
)
returns text[]
language plpgsql
volatile
set search_path = ''
as $function$
declare
  v_label text;
  v_key text;
  v_row public.subcategory_label_map%rowtype;
  v_out text[] := '{}'::text[];
begin
  if p_labels is null then
    return null;
  end if;

  foreach v_label in array p_labels loop
    v_key := public.subcategory_label_key(v_label);
    if v_key is null or v_key = '' then
      continue;
    end if;

    select * into v_row
    from public.subcategory_label_map
    where label_key = v_key;

    if not found then
      insert into pg_temp.dev1510_lenient_residue (value, surface)
      values (v_label, p_surface)
      on conflict (value) do nothing;
      if not (v_label = any(v_out)) then
        v_out := v_out || v_label;
      end if;
      continue;
    end if;

    if v_row.disposition <> 'resolve' then
      continue;
    end if;

    if not (v_row.target_slug = any(v_out)) then
      v_out := v_out || v_row.target_slug;
    end if;
  end loop;

  return v_out;
end;
$function$;

create or replace function public.dev1510_json_to_slugs_lenient(
  p_value jsonb,
  p_surface text
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $function$
declare
  v_result jsonb := p_value;
  v_key text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return p_value;
  end if;

  if jsonb_typeof(p_value) = 'array' then
    return to_jsonb(
      public.dev1510_labels_to_slugs_lenient(
        array(select jsonb_array_elements_text(p_value)), p_surface
      )
    );
  end if;

  if jsonb_typeof(p_value) <> 'object' then
    return p_value;
  end if;

  -- A subcategories correction is a delta, not a value: `{ add, remove }`
  -- (`isSubcategoriesDelta`, src/lib/services/subcategories.ts:231). Both arms
  -- are matched against the brand's stored array by `normalizeSubcategoryKey`,
  -- so both have to move to the new representation or the correction silently
  -- stops matching anything.
  foreach v_key in array array['add', 'remove', 'subcategories', 'values'] loop
    if jsonb_typeof(v_result -> v_key) = 'array' then
      v_result := jsonb_set(
        v_result, array[v_key],
        to_jsonb(
          public.dev1510_labels_to_slugs_lenient(
            array(select jsonb_array_elements_text(v_result -> v_key)), p_surface
          )
        )
      );
    end if;
  end loop;

  return v_result;
end;
$function$;

revoke all on function public.dev1510_labels_to_slugs_lenient(text[], text) from public, anon, authenticated;
revoke all on function public.dev1510_json_to_slugs_lenient(jsonb, text) from public, anon, authenticated;

-- ===========================================================================
-- 1/7 — brands.subcategories, plus the 34-row triage
-- ===========================================================================

create temporary table dev1510_updated_at_snapshot on commit drop as
select id, updated_at from public.brands;

alter table public.brands disable trigger brands_updated_at;

update public.brands as b
set subcategories = plan.slugs,
    subcategories_en = public.subcategory_slugs_to_names_en(plan.slugs)
from (
  select
    scoped.id,
    case
      when scoped.keeps_craft_kits
        and not ('craft-kits-and-supplies' = any(scoped.base))
        then scoped.base || 'craft-kits-and-supplies'::text
      else scoped.base
    end as slugs
  from (
    select
      source.id,
      public.subcategory_labels_to_slugs(source.subcategories) as base,
      (
        source.slug in (
          select keeper.brand_slug
          from (
            values
-- >>> craft kit keepers
              ('1cmhandmake'),
              ('away-studio'),
              ('billnogates'),
              ('celebrate-today'),
              ('evies-drawing-daily'),
              ('gshop'),
              ('mr-sci-science-factory'),
              ('tobe-craft'),
              ('v-j-studio'),
              ('wooso')
-- <<< craft kit keepers
          ) as keeper (brand_slug)
        )
        and exists (
          select 1
          from unnest(source.subcategories) as tag(value)
          where public.subcategory_label_key(tag.value)
              = public.subcategory_label_key('體驗課程・DIY材料')
        )
      ) as keeps_craft_kits
    from public.brands as source
  ) as scoped
) as plan
where plan.id = b.id
  and (
    b.subcategories is distinct from plan.slugs
    or b.subcategories_en is distinct from public.subcategory_slugs_to_names_en(plan.slugs)
  );

alter table public.brands enable trigger brands_updated_at;

do $migration$
declare
  v_offenders text;
  v_moved integer;
begin
  select count(*)
  into v_moved
  from public.brands as brand
  join dev1510_updated_at_snapshot as snapshot on snapshot.id = brand.id
  where brand.updated_at is distinct from snapshot.updated_at;

  if v_moved > 0 then
    raise exception 'DEV-1510 backfill moved brands.updated_at on % row(s)', v_moved
      using errcode = 'P0001';
  end if;

  -- MAX_SUBCATEGORIES is 5 (src/lib/services/subcategories.ts:26). The triage
  -- appends a slug, so it is the one step that can push a row over the cap.
  select string_agg(brand.slug, ', ' order by brand.slug)
  into v_offenders
  from public.brands as brand
  where cardinality(brand.subcategories) > 5;

  if v_offenders is not null then
    raise exception 'DEV-1510 brand(s) exceed the 5-subcategory cap: %', v_offenders
      using errcode = 'P0001';
  end if;
end
$migration$;

-- ===========================================================================
-- 2/7 — brands.draft_data (camelCase container)
-- ===========================================================================

alter table public.brands disable trigger brands_updated_at;

update public.brands
set draft_data = public.subcategory_json_to_slugs(draft_data)
where draft_data is not null
  and draft_data ? 'subcategories'
  and draft_data is distinct from public.subcategory_json_to_slugs(draft_data);

alter table public.brands enable trigger brands_updated_at;

-- ===========================================================================
-- 3/7 — brand_submissions, all five jsonb columns, pending only
-- ===========================================================================
--
-- ADR decision 7. The DEV-1503 normalizers for these containers were dropped at
-- 20260819090000:748-769, so nothing normalizes them now — every one has to be
-- converted here or read through site 7/7. Non-pending rows are historical and
-- are deliberately left on labels; they are never approved again.

update public.brand_submissions
set base_brand_data  = public.subcategory_json_to_slugs(base_brand_data),
    review_overrides = public.subcategory_json_to_slugs(review_overrides),
    owner_data       = public.subcategory_json_to_slugs(owner_data),
    enriched_data    = public.subcategory_json_to_slugs(enriched_data),
    suggested_tags   = public.subcategory_json_to_slugs(suggested_tags)
where status = 'pending'
  and (
    base_brand_data     is distinct from public.subcategory_json_to_slugs(base_brand_data)
    or review_overrides is distinct from public.subcategory_json_to_slugs(review_overrides)
    or owner_data       is distinct from public.subcategory_json_to_slugs(owner_data)
    or enriched_data    is distinct from public.subcategory_json_to_slugs(enriched_data)
    or suggested_tags   is distinct from public.subcategory_json_to_slugs(suggested_tags)
  );

-- ===========================================================================
-- 4/7 — brand_field_corrections.proposed_value / previous_value
-- ===========================================================================

update public.brand_field_corrections
set proposed_value = public.dev1510_json_to_slugs_lenient(
      proposed_value, 'brand_field_corrections.proposed_value'
    ),
    previous_value = public.dev1510_json_to_slugs_lenient(
      previous_value, 'brand_field_corrections.previous_value'
    )
where field = 'subcategories';

-- ===========================================================================
-- 5/7 — brand_field_events.old_value / new_value
-- ===========================================================================
--
-- `field` is the patched brand column (20260707100000:78-95), so the payload
-- for a subcategories event is a bare jsonb array. `subcategories_en` events
-- hold English display names and are left alone.

update public.brand_field_events
set old_value = public.dev1510_json_to_slugs_lenient(
      old_value, 'brand_field_events.old_value'
    ),
    new_value = public.dev1510_json_to_slugs_lenient(
      new_value, 'brand_field_events.new_value'
    )
where field = 'subcategories';

-- ===========================================================================
-- 6/7 — brand_ai_results, latest row per target per phase only
-- ===========================================================================
--
-- ADR decision 6, of 31,320 rows. History is an audit trail of what the model
-- actually returned; rewriting it would destroy the evidence a replay depends
-- on. Only the row a reader would pick up moves.
--
-- The target key is `brand_id` OR `submission_id` — a row carries exactly one,
-- and approve_submission re-points submission rows at the new brand. Recency is
-- (created_at desc, id desc), matching `latestAiResultKey` /
-- `latestAiResultIds` in `src/lib/services/_shared/ai-results.ts`, which is the
-- TypeScript half of this same scope.

with latest as (
  select distinct on (coalesce(result.brand_id, result.submission_id), result.phase)
    result.id
  from public.brand_ai_results as result
  where result.brand_id is not null or result.submission_id is not null
  order by
    coalesce(result.brand_id, result.submission_id),
    result.phase,
    result.created_at desc,
    result.id desc
)
update public.brand_ai_results as result
set subcategories = public.subcategory_labels_to_slugs(result.subcategories)
from latest
where latest.id = result.id
  and result.subcategories is not null
  and result.subcategories
      is distinct from public.subcategory_labels_to_slugs(result.subcategories);

-- ===========================================================================
-- 7/7 — approve_submission converts on read
-- ===========================================================================
--
-- A submission created before this deploy can be approved after it. The
-- conversion sits immediately after the one statement that already rewrites
-- p_brand_data, so BOTH downstream readers see slugs: the publishable-core
-- guard (which counts 1..5 distinct entries) and the INSERT into public.brands,
-- each of which re-reads p_brand_data through its own jsonb_to_record.
--
-- Placing it here rather than at the two read sites is deliberate: two patches
-- can drift apart, and the guard validating labels while the INSERT wrote slugs
-- would be invisible until a brand landed unfilterable.

do $migration$
declare
  v_approve text;
  v_legacy text;
  v_final text;
begin
  perform public.dev1503_contract_assert_function(
    'public.approve_submission(uuid,uuid,jsonb)'::regprocedure,
    'a69ae6d982130bf3d2b666e6a3f8de15'
  );

  -- The two-space indent is PART OF THE ANCHOR: dev1503_contract_replace_exact
  -- matches bytes, not SQL tokens, and this is exactly how pg_get_functiondef
  -- re-prints the line. Reformatting makes the expected-count contract raise
  -- rather than silently miss.
  v_legacy := $anchor$  p_brand_data := p_brand_data - 'hero_image_url';$anchor$;
  v_final :=
    v_legacy || E'\n\n' ||
    $anchor$  -- DEV-1510: a submission created before the slug migration can be$anchor$ || E'\n' ||
    $anchor$  -- approved after it. Convert stored zh-TW subcategory labels to slugs$anchor$ || E'\n' ||
    $anchor$  -- ON READ, before the publishable-core guard and the INSERT below both$anchor$ || E'\n' ||
    $anchor$  -- re-read this container. Unresolvable input raises rather than being$anchor$ || E'\n' ||
    $anchor$  -- dropped, so a missing vocabulary entry fails the approval loudly.$anchor$ || E'\n' ||
    $anchor$  p_brand_data := public.subcategory_json_to_slugs(p_brand_data);$anchor$;

  v_approve := pg_get_functiondef(
    'public.approve_submission(uuid,uuid,jsonb)'::regprocedure
  );
  v_approve := public.dev1503_contract_replace_exact(v_approve, v_legacy, v_final, 1);
  execute v_approve;
end
$migration$;

-- ===========================================================================
-- Closing contracts
-- ===========================================================================

do $migration$
declare
  v_offenders text;
  v_residue text;
  v_zero text;
  v_surface jsonb;
begin
  -- No zh-TW label may survive in the base column. An L2 slug is
  -- lowercase-ASCII-with-hyphens by construction; anything else is a label the
  -- conversion missed.
  select string_agg(brand.slug, ', ' order by brand.slug)
  into v_offenders
  from public.brands as brand
  where exists (
    select 1
    from unnest(brand.subcategories) as tag(value)
    where tag.value !~ '^[a-z0-9-]+$'
  );

  if v_offenders is not null then
    raise exception 'DEV-1510 brand(s) still hold zh-TW subcategory labels: %', v_offenders
      using errcode = 'P0001';
  end if;

  -- Every surviving slug must be a live L2. This catches a map row pointing at
  -- a node that DEV-1507 or a later ticket removed.
  select string_agg(distinct tag.value, ', ')
  into v_offenders
  from public.brands as brand,
       unnest(brand.subcategories) as tag(value)
  where not exists (
    select 1 from public.taxonomy_terms as term
    where term.axis = 'l2' and term.slug = tag.value
  );

  if v_offenders is not null then
    raise exception 'DEV-1510 brand(s) hold slug(s) absent from taxonomy_terms: %', v_offenders
      using errcode = 'P0001';
  end if;

  -- The zero-subcategory outcome is the check that closes the residual list.
  -- Three brands reach zero unintentionally and one by design; a FIFTH means a
  -- label was evicted whose holder had no other surviving tag, and the triage
  -- above exists because `gshop` was exactly that.
  select string_agg(brand.slug, ', ' order by brand.slug)
  into v_zero
  from public.brands as brand
  where brand.status = 'approved'
    and coalesce(cardinality(brand.subcategories), 0) = 0
    and brand.slug not in (
      'dawn-creative',       -- unintended: 客製化禮品 evicted, no replacement
      'homm-sound',          -- unintended: 樂器 evicted, not a triage keeper
      'tp-minihorn',         -- unintended: 止滑墊 has no admissible node
      '蟬說-漫步台灣-蟬說生活'  -- BY DESIGN: hospitality, leaves the directory
    );

  if v_zero is not null then
    raise exception
      'DEV-1510 unexpected zero-subcategory brand(s): %; classify each label before deploying',
      v_zero
      using errcode = 'P0001';
  end if;

  select string_agg(residue.value || ' (' || residue.surface || ')', ', ' order by residue.value)
  into v_residue
  from pg_temp.dev1510_lenient_residue as residue;

  if v_residue is not null then
    raise notice
      'DEV-1510 correction/event strings passed through unresolved: %', v_residue;
  else
    raise notice 'DEV-1510 correction/event surfaces: no unresolved strings';
  end if;

  -- purchase_channel_sql_surface() (20260805120500:17-59) snapshots
  -- approve_submission and re-materializes it through pg_get_functiondef at
  -- CALL time, so the re-pin needs no edit — only proof. Without this call the
  -- re-pin is an assumption; with it, the meta-guard the parity suite reads is
  -- verified inside the transaction that moved the body.
  v_surface := public.purchase_channel_sql_surface();
  if (v_surface -> 'functions' ->> 'approve_submission')
       not like '%subcategory_json_to_slugs%' then
    raise exception
      'DEV-1510 purchase_channel_sql_surface re-pin missing the approve_submission conversion'
      using errcode = 'P0001';
  end if;
end
$migration$;

drop function public.dev1510_json_to_slugs_lenient(jsonb, text);
drop function public.dev1510_labels_to_slugs_lenient(text[], text);
drop function public.dev1503_contract_assert_function(regprocedure, text);
drop function public.dev1503_contract_replace_exact(text, text, text, integer);

-- DROP FUNCTION re-applies Supabase's default privileges in the public schema,
-- and revoking from `public` does not undo a grant made to a role by name. The
-- four drops above are the trigger, so the four surviving helpers are verified
-- AFTER them rather than at the point they were created.
do $migration$
declare
  v_signature text;
  v_role text;
begin
  foreach v_signature in array array[
    'public.subcategory_label_key(text)',
    'public.subcategory_labels_to_slugs(text[])',
    'public.subcategory_slugs_to_names_en(text[])',
    'public.subcategory_json_to_slugs(jsonb)'
  ]
  loop
    foreach v_role in array array['anon', 'authenticated'] loop
      if pg_catalog.has_function_privilege(v_role, v_signature, 'EXECUTE') then
        raise exception 'DEV-1510 % is executable by %', v_signature, v_role
          using errcode = 'P0001';
      end if;
    end loop;

    if not pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE') then
      raise exception 'DEV-1510 % is NOT executable by service_role', v_signature
        using errcode = 'P0001';
    end if;
  end loop;

  if pg_catalog.has_table_privilege('anon', 'public.subcategory_label_map', 'SELECT')
    or pg_catalog.has_table_privilege('authenticated', 'public.subcategory_label_map', 'SELECT')
  then
    raise exception 'DEV-1510 subcategory_label_map is readable by anon/authenticated'
      using errcode = 'P0001';
  end if;
end
$migration$;

commit;
