create table brand_images (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  storage_path text,
  url text not null,
  source text not null check (source in ('scrape','google_image','owner','admin','legacy')),
  status text not null default 'active' check (status in ('active','rejected')),
  tags text[],
  score numeric,
  alt_zh text,
  alt_en text,
  width int,
  height int,
  dominant_color text,
  sort_order int not null default 0,
  source_url text,
  created_at timestamptz not null default now(),
  unique (brand_id, source_url)
);

create index brand_images_active_idx on brand_images (brand_id, status, sort_order);
alter table brand_images enable row level security;

-- legacy backfill: hero first (sort 0), then product_photos in array order
insert into brand_images (brand_id, url, source_url, source, sort_order)
select id, hero_image_url, hero_image_url, 'legacy', 0 from brands where hero_image_url is not null
on conflict do nothing;

insert into brand_images (brand_id, url, source_url, source, sort_order)
select b.id, p.value, p.value, 'legacy', p.ordinality
from brands b, jsonb_array_elements_text(b.product_photos) with ordinality p
on conflict do nothing;
