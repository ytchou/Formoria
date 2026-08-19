-- Reverse of DEV-1525: `brands.material` goes back from English slugs to the
-- zh-TW labels it stored before the conversion, and both CHECKs go back to the
-- zh vocabulary.
--
-- Applying it for real, against a target confirmed by hand, in a fresh session:
--
--   psql "$SUPABASE_DB_URL" --single-transaction \
--     -f supabase/migrations/reverse/20260820170000_revert_material_slugs.sql
--
-- `supabase/migrations/reverse/` is a rollback holding area, NOT part of the
-- forward ledger. `scripts/db-deploy.ts:430` enumerates `supabase/migrations`
-- non-recursively and keeps only `*.sql`, and `supabase db push` reads the same
-- flat directory, so nothing in here is ever applied by `pnpm db:migrate` or
-- counted by `db:verify`.
--
-- LOSSLESS, unlike the subcategory reverse
--
-- The forward mapping is a bijection over twelve pairs: one slug per label, one
-- label per slug, no aliases and no collapse. The stored slug is therefore
-- enough to reconstruct exactly what the row held before, with no corpus file
-- and no per-brand overlay.
--
-- WHAT THIS FILE DOES NOT REVERT
--
--  * `public.taxonomy_terms`. The forward migration re-seeds it in full from
--    `src/lib/taxonomy/ontology.ts`, so restoring the pre-DEV-1525 rows means
--    reverting the ontology and re-running
--    `pnpm exec tsx scripts/generate-taxonomy-terms.ts --write` against
--    whichever migration `TAXONOMY_TERMS_MIGRATION` then names. Left as-is the
--    material rows stay slug-keyed while `brands.material` holds labels, which
--    costs CJK recall on the material axis only — the `cjk_bigrams` expansion
--    finds no row for `陶瓷` and falls through. Revert both or neither.
--  * `curated_products.material`, which the forward migration asserted was
--    empty and did not convert. Only its CHECK moves back.
--
-- `brands_updated_at` is suppressed here for the same reason the forward
-- migration suppresses it: a rollback of a spelling change is not an editorial
-- edit, and a moved timestamp would churn sitemap `lastmod`.

-- 1. Precondition: both CHECKs must be holding the slug vocabulary. Running
--    this against a database the forward migration never reached would drop a
--    constraint that is already the one being restored.
do $reverse$
declare
  v_expected constant text := 'CHECK ((material <@ ARRAY[''ceramic''::text, ''wood''::text, '
    || '''textile''::text, ''glass''::text, ''metal''::text, ''bamboo''::text, ''wool''::text, '
    || '''leather''::text, ''paper''::text, ''stone''::text, ''rattan''::text, ''lacquer''::text]))';
  v_name text;
  v_actual text;
begin
  foreach v_name in array array['brands_material_check', 'curated_products_material_check'] loop
    select pg_get_constraintdef(oid) into v_actual from pg_constraint where conname = v_name;
    if v_actual is distinct from v_expected then
      raise exception 'DEV-1525 reverse: % is %, expected the slug vocabulary',
        v_name, coalesce(v_actual, '<missing>') using errcode = 'P0001';
    end if;
  end loop;
end
$reverse$;

alter table public.brands drop constraint brands_material_check;
alter table public.curated_products drop constraint curated_products_material_check;

-- 2. Convert back. The rank column preserves MATERIALS order, so a reverted row
--    holds its terms in the same sequence the pre-migration backfill wrote.
create temporary table dev1525_reverse_snapshot on commit drop as
select id, material from public.brands where cardinality(material) > 0;

alter table public.brands disable trigger brands_updated_at;

update public.brands as b
set material = (
  select coalesce(array_agg(mapping.label order by mapping.rank), '{}')
  from unnest(b.material) as stored
  join (values
    ('ceramic','陶瓷',1), ('wood','木',2),      ('textile','織品',3), ('glass','玻璃',4),
    ('metal','金屬',5),   ('bamboo','竹',6),    ('wool','羊毛',7),    ('leather','皮革',8),
    ('paper','紙',9),     ('stone','石',10),    ('rattan','藤',11),   ('lacquer','漆',12)
  ) as mapping(slug, label, rank) on mapping.slug = stored
)
where cardinality(b.material) > 0;

alter table public.brands enable trigger brands_updated_at;

-- 3. Post-conditions: nothing lost, nothing invented.
do $reverse$
declare v_before bigint; v_after bigint; v_bad text;
begin
  select count(*) into v_before from dev1525_reverse_snapshot;
  select count(*) into v_after from public.brands where cardinality(material) > 0;
  if v_before <> v_after then
    raise exception 'DEV-1525 reverse: brands carrying material went % -> %', v_before, v_after
      using errcode = 'P0001';
  end if;

  select string_agg(s.id::text, ', ') into v_bad
    from dev1525_reverse_snapshot s
    join public.brands b on b.id = s.id
   where cardinality(b.material) <> cardinality(s.material);
  if v_bad is not null then
    raise exception 'DEV-1525 reverse: material cardinality changed for brand(s): %', v_bad
      using errcode = 'P0001';
  end if;

  select string_agg(distinct m, ', ') into v_bad
    from public.brands, unnest(material) m
   where m <> all (array['陶瓷', '木', '織品', '玻璃', '金屬', '竹',
                         '羊毛', '皮革', '紙', '石', '藤', '漆']);
  if v_bad is not null then
    raise exception 'DEV-1525 reverse: unmapped material value(s) survived: %', v_bad
      using errcode = 'P0001';
  end if;
end
$reverse$;

-- 4. Re-install the zh CHECKs, byte-identical to 20260820140000 so a later
--    forward re-run finds the precondition it expects.
alter table public.brands
  add constraint brands_material_check
  check (material <@ array[
    '陶瓷', '木', '織品', '玻璃', '金屬', '竹',
    '羊毛', '皮革', '紙', '石', '藤', '漆'
  ]::text[]);

alter table public.curated_products
  add constraint curated_products_material_check
  check (material <@ array[
    '陶瓷', '木', '織品', '玻璃', '金屬', '竹',
    '羊毛', '皮革', '紙', '石', '藤', '漆'
  ]::text[]);

comment on column public.brands.material is
  'DEV-1510: the material axis, closed to the 12 terms in MATERIALS (src/lib/taxonomy/ontology.ts). Independent of the use axis — a brand may carry both, either or neither.';
comment on column public.curated_products.material is
  'Materials this product is made of. Free vocabulary until DEV-1506 fixes the term list.';

do $ledger$
declare v_labelled integer;
begin
  select count(*) into v_labelled
    from public.brands where cardinality(material) > 0;
  raise notice 'DEV-1525 reverted: % brand(s) carry zh-TW material labels', v_labelled;
end;
$ledger$;
