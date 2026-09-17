-- DEV-1746: submission images move to a permanently private bucket before
-- brand-images returns to public delivery. The application keeps bucket-relative
-- storage_path values. Approved submission rows remain as private history even
-- though the legacy approval RPC attempts to delete them after copying them to
-- brand_images.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'brand-submissions', 'brand-submissions', false, 10485760,
  array['image/webp','image/jpeg','image/png','image/avif']
)
on conflict (id) do update
   set public             = false,
       file_size_limit    = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.preserve_published_submission_image_history()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status = 'active' and exists (
    select 1
      from public.brand_images as published
     where published.storage_path is not distinct from old.storage_path
       and published.url is not distinct from old.url
       and published.source is not distinct from old.source
       and published.created_at is not distinct from old.created_at
  ) then
    return null;
  end if;

  return old;
end
$$;

drop trigger if exists preserve_published_submission_image_history
  on public.submission_images;

create trigger preserve_published_submission_image_history
before delete on public.submission_images
for each row execute function public.preserve_published_submission_image_history();

do $$
declare
  v_public_objects bigint;
  v_brand_rows bigint;
  v_private_bucket_ok boolean;
begin
  select count(*)
    into v_public_objects
    from storage.objects
   where bucket_id = 'brand-images'
     and name like 'submissions/%';

  select count(*)
    into v_brand_rows
    from public.brand_images
   where storage_path like 'submissions/%';

  select exists (
    select 1
      from storage.buckets
     where id = 'brand-submissions'
       and public = false
  ) into v_private_bucket_ok;

  if v_public_objects <> 0 then
    raise exception 'DEV-1746 blocked: brand-images still contains % submissions objects', v_public_objects;
  end if;
  if v_brand_rows <> 0 then
    raise exception 'DEV-1746 blocked: brand_images still contains % submissions references', v_brand_rows;
  end if;
  if not v_private_bucket_ok then
    raise exception 'DEV-1746 blocked: brand-submissions is missing or public';
  end if;
end
$$;

update storage.buckets
   set public = true,
       file_size_limit = 10485760,
       allowed_mime_types = array['image/webp','image/jpeg','image/png','image/avif']
 where id = 'brand-images';

do $$
begin
  if not exists (
    select 1 from storage.buckets where id = 'brand-images' and public = true
  ) then
    raise exception 'DEV-1746 blocked: brand-images bucket is missing';
  end if;
end
$$;
