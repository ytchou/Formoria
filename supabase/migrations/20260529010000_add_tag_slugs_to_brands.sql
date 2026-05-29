-- Denormalized tag slugs on brands for taxonomy filtering (fixes category+tags annihilation)
alter table brands add column tag_slugs text[] not null default '{}';
create index idx_brands_tag_slugs on brands using gin (tag_slugs);

create or replace function refresh_brand_tag_slugs(p_brand_id uuid)
returns void language plpgsql security definer as $$
begin
  update brands b set tag_slugs = coalesce((
    select array_agg(t.slug)
    from brand_taxonomy bt
    join taxonomy_tags t on t.id = bt.tag_id
    where bt.brand_id = p_brand_id
  ), '{}')
  where b.id = p_brand_id;
end; $$;

create or replace function brand_taxonomy_sync_tag_slugs()
returns trigger language plpgsql security definer as $$
begin
  if tg_op = 'DELETE' then
    perform refresh_brand_tag_slugs(old.brand_id);
    return old;
  end if;
  perform refresh_brand_tag_slugs(new.brand_id);
  if tg_op = 'UPDATE' and new.brand_id <> old.brand_id then
    perform refresh_brand_tag_slugs(old.brand_id);
  end if;
  return new;
end; $$;

create trigger brand_taxonomy_tag_slugs
after insert or update or delete on brand_taxonomy
for each row execute function brand_taxonomy_sync_tag_slugs();

create or replace function taxonomy_tags_sync_tag_slugs()
returns trigger language plpgsql security definer as $$
begin
  update brands b set tag_slugs = coalesce((
    select array_agg(t.slug) from brand_taxonomy bt
    join taxonomy_tags t on t.id = bt.tag_id
    where bt.brand_id = b.id), '{}')
  where b.id in (select brand_id from brand_taxonomy where tag_id = new.id);
  return new;
end; $$;

create trigger taxonomy_tags_slug_sync
after update of slug on taxonomy_tags
for each row when (old.slug is distinct from new.slug)
execute function taxonomy_tags_sync_tag_slugs();

-- Backfill existing rows
update brands b set tag_slugs = coalesce((
  select array_agg(t.slug) from brand_taxonomy bt
  join taxonomy_tags t on t.id = bt.tag_id
  where bt.brand_id = b.id), '{}');

grant execute on function refresh_brand_tag_slugs(uuid) to service_role;
