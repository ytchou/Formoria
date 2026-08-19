-- Close the material vocabulary (DEV-1506).
--
-- 20260819120000 added `material text[] not null default '{}'` to BOTH
-- public.brands and public.curated_products and deliberately shipped no CHECK:
-- the term list was not ratified yet, and a constraint written then would have
-- had to be dropped and rewritten by now. The list is ratified — twelve terms
-- — so this migration installs the constraint on both columns.
--
-- The mirror in TypeScript is `MATERIALS` in src/lib/taxonomy/ontology.ts, and
-- these two lists are one vocabulary in two places. A term added to one without
-- the other is the failure mode: a slug the ontology knows and this CHECK does
-- not turns every write into a 23514, and a slug this CHECK allows and the
-- ontology does not renders as a dead filter.
--
-- ARRAY-ELEMENT FORM, not scalar `in`. `material` is a text[]: `<@`
-- ("is contained by") asserts EVERY element is in the allow-list, which is the
-- claim being made. A scalar `material in (...)` would compare the whole array
-- against text values and reject even a valid single-element array.
--
-- NO BACKFILL, on purpose. Both columns landed hours ago behind
-- `not null default '{}'` and no writer sets them yet, so every existing row is
-- the empty array and `'{}' <@ anything` is true. `add constraint` validates
-- the existing rows as it runs, so a surprise non-empty row fails this
-- migration loudly instead of being silently coerced.
--
-- Re-runnable: each constraint is dropped by name before it is added, so a
-- repeated apply replaces an identical predicate rather than erroring on a
-- duplicate name.

begin;

alter table public.brands
  drop constraint if exists brands_material_check;
alter table public.brands
  add constraint brands_material_check check (
    material <@ array[
      'ceramic', 'wood', 'textile', 'glass', 'metal', 'bamboo',
      'wool', 'leather', 'paper', 'stone', 'rattan', 'lacquer'
    ]::text[]
  );

alter table public.curated_products
  drop constraint if exists curated_products_material_check;
alter table public.curated_products
  add constraint curated_products_material_check check (
    material <@ array[
      'ceramic', 'wood', 'textile', 'glass', 'metal', 'bamboo',
      'wool', 'leather', 'paper', 'stone', 'rattan', 'lacquer'
    ]::text[]
  );

-- The DEV-1502 comments promised this constraint ("Free vocabulary until
-- DEV-1506 fixes the term list"). Rewritten here so `\d+` does not keep
-- advertising a freedom the table no longer has.
comment on column public.brands.material is
  'Materials the brand works in, e.g. {ceramic,wood}. Closed 12-term vocabulary, CHECK-constrained by brands_material_check; mirrored by MATERIALS in src/lib/taxonomy/ontology.ts.';
comment on column public.curated_products.material is
  'Materials this product is made of. Closed 12-term vocabulary, CHECK-constrained by curated_products_material_check; mirrored by MATERIALS in src/lib/taxonomy/ontology.ts.';

commit;
