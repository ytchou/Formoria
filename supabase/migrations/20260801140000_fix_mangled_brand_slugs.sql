begin;

-- DEV-1301: these rows were approved through the mixed-script slug path added
-- by DEV-1014. Keep this mapping explicit so the backfill is auditable and
-- does not reinterpret owner-curated legacy slugs at migration time.
create temporary table dev_1301_slug_backfill (
  old_slug text primary key,
  new_slug text not null
) on commit drop;

insert into dev_1301_slug_backfill (old_slug, new_slug)
values
  ('viza-v', 'viza-viz'),
  ('aenti', 'aenti-o'),
  ('s-cat', 'chou-s-cat'),
  ('610-asteroid-b', 'b-610-asteroid-b-610'),
  ('ng', 'pang'),
  ('hsieh', 'dr-hsieh'),
  ('nichi', 'tan-nichi'),
  ('s-studio', 'bulan-s-studio'),
  ('eggplants', 'mr-eggplants'),
  ('j-studio', 'v-j-studio'),
  ('s-diary', 'vichy-s-diary'),
  ('sci-science-factory', 'mr-sci-science-factory'),
  ('tj', 'tj-co'),
  ('chi', 'chi-bee'),
  ('y', 'yuyu'),
  ('essence-design', 'essence-design-craft');

-- Avoid a unique-slug violation if a future data set has claimed a target
-- already. The current audit found one such case: Murou stays at murou-2
-- because another approved brand already owns murou.
update public.brands as brand
set slug = backfill.new_slug
from dev_1301_slug_backfill as backfill
where brand.slug = backfill.old_slug
  and brand.status = 'approved'
  and not exists (
    select 1
    from public.brands as occupied
    where occupied.slug = backfill.new_slug
      and occupied.id <> brand.id
  );

-- The proxy resolves these rows to permanent localized redirects. Insert only
-- after the target slug exists because new_slug has a foreign-key constraint.
insert into public.brand_slug_redirects (old_slug, new_slug)
select backfill.old_slug, backfill.new_slug
from dev_1301_slug_backfill as backfill
join public.brands as target
  on target.slug = backfill.new_slug
 and target.status = 'approved'
where not exists (
  select 1
  from public.brands as old_brand
  where old_brand.slug = backfill.old_slug
)
on conflict (old_slug) do update
set new_slug = excluded.new_slug;

commit;
