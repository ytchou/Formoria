-- Material as a first-class axis, and the curated_products L1/L2 rename
-- (DEV-1502).
--
-- `material` is what people actually search a Taiwanese product by — 陶瓷, 木,
-- 麻 — and it was previously buried inside brands.category_attributes, a jsonb
-- blob nothing could index. It becomes a text[] on both the brand and the
-- curated product, with a GIN index each so containment queries stay cheap.
--
-- The rename is the other half: `l1`/`l2` were positional names from the
-- taxonomy migration and carried no meaning at the read site. `category` and
-- `subcategories` match what brands already calls the same two things, so the
-- service layer stops translating between two vocabularies for one concept.
--
-- ORDERING IS LOAD-BEARING.
--
--   1. Against DEV-1503: every migration from 20260818150000 through
--      20260819110000 must ALREADY be applied. Those migrations rewrote the
--      function bodies that touch curated_products; running this rename first
--      leaves them selecting l1/l2 and every apply 42703s.
--   2. Against the deployment: the previously deployed service selects l1/l2.
--      This migration runs only after the DEV-1502 code has merged AND Railway
--      has deployed it, or every brand page read 42703s.
--
-- NO CHECK CONSTRAINT ON EITHER `material` COLUMN. This is deliberate, not an
-- omission: the vocabulary is not settled yet, and a CHECK written now would
-- have to be dropped and rewritten by the time it is. DEV-1506 adds it once
-- the term list is fixed.

alter table public.brands
  add column if not exists material text[] not null default '{}';
alter table public.curated_products
  add column if not exists material text[] not null default '{}';

create index if not exists idx_brands_material
  on public.brands using gin (material);
create index if not exists idx_curated_products_material
  on public.curated_products using gin (material);

comment on column public.brands.material is
  'Materials the brand works in, e.g. {ceramic,wood}. Free vocabulary until DEV-1506 fixes the term list.';
comment on column public.curated_products.material is
  'Materials this product is made of. Free vocabulary until DEV-1506 fixes the term list.';

alter table public.curated_products rename column l1 to category;
alter table public.curated_products rename column l2 to subcategories;

-- The 12-slug CHECK was written inline and unnamed
-- (20260813120000_curated_products.sql:30-33), so Postgres generated
-- `curated_products_l1_check` and the column rename does NOT rename it.
--
-- RENAME, never drop-and-recreate: a rename preserves the predicate byte for
-- byte and so cannot silently widen or narrow the 12 allowed slugs. Re-typing
-- the list here would make this migration a second, drifting source of truth.
do $$
declare v_name text;
begin
  if exists (
    select 1
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public' and rel.relname = 'curated_products'
      and con.contype = 'c' and con.conname = 'curated_products_category_check'
  ) then
    return;  -- already renamed; this migration is being re-run
  end if;

  select con.conname into v_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public' and rel.relname = 'curated_products'
    and con.contype = 'c' and pg_get_constraintdef(con.oid) like '%category%';

  if v_name is null then
    raise exception 'expected a category CHECK on curated_products, found none';
  end if;

  execute format(
    'alter table public.curated_products rename constraint %I to curated_products_category_check',
    v_name
  );
end $$;
