-- MIT Map: Service layer tables
-- brands, taxonomy_tags, brand_taxonomy, brand_submissions

-- =============================================================================
-- updated_at trigger function
-- =============================================================================
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- =============================================================================
-- brands
-- =============================================================================
create table brands (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    slug text unique not null,
    description text,
    logo_url text,
    hero_image_url text,
    status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'hidden')),
    category text,
    founding_year int,
    purchase_links jsonb default '[]',
    social_links jsonb default '{}',
    retail_locations jsonb default '[]',
    product_photos jsonb default '[]',
    contact_email text,
    submitted_at timestamptz default now(),
    approved_at timestamptz,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create trigger brands_updated_at
before update on brands
for each row execute function set_updated_at();

create index idx_brands_slug on brands (slug);
create index idx_brands_status on brands (status);

-- =============================================================================
-- taxonomy_tags
-- =============================================================================
create table taxonomy_tags (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    name_zh text,
    slug text unique not null,
    category text not null
    check (category in ('product_type', 'material', 'price_range', 'region')),
    is_active boolean default true,
    suggested_by uuid,
    created_at timestamptz default now()
);

create index idx_taxonomy_tags_category on taxonomy_tags (category);
create index idx_taxonomy_tags_slug on taxonomy_tags (slug);

-- =============================================================================
-- brand_taxonomy (junction table)
-- =============================================================================
create table brand_taxonomy (
    brand_id uuid not null references brands (id) on delete cascade,
    tag_id uuid not null references taxonomy_tags (id) on delete cascade,
    primary key (brand_id, tag_id)
);

-- =============================================================================
-- brand_submissions
-- =============================================================================
create table brand_submissions (
    id uuid primary key default gen_random_uuid(),
    brand_id uuid references brands (id),
    brand_name text not null,
    submitter_email text not null,
    submitter_name text,
    description text,
    website_url text,
    social_links jsonb default '{}',
    suggested_tags jsonb default '[]',
    status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
    reviewer_notes text,
    submitted_at timestamptz default now(),
    reviewed_at timestamptz,
    reviewed_by uuid
);

create index idx_brand_submissions_status on brand_submissions (status);

-- Add FK from taxonomy_tags.suggested_by -> brand_submissions after table exists
alter table taxonomy_tags
add constraint fk_taxonomy_tags_suggested_by
foreign key (suggested_by) references brand_submissions (id);

-- =============================================================================
-- Row Level Security
-- =============================================================================

-- brands: public can read approved brands; everything else via service role
alter table brands enable row level security;

create policy "Public can read approved brands"
on brands for select
using (status = 'approved');

-- taxonomy_tags: public can read active tags
alter table taxonomy_tags enable row level security;

create policy "Public can read active tags"
on taxonomy_tags for select
using (is_active = true);

-- brand_taxonomy: public can read (inherits brand/tag visibility via joins)
alter table brand_taxonomy enable row level security;

create policy "Public can read brand taxonomy"
on brand_taxonomy for select
using (true);

-- brand_submissions: public can insert (anonymous submissions); reads via service role
alter table brand_submissions enable row level security;

create policy "Public can submit brands"
on brand_submissions for insert
with check (true);
