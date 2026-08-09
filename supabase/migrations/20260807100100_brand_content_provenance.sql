-- Stable editorial fingerprint plus first-published / last-material-update
-- timestamps for brand content, readable by neither `anon` nor `authenticated`.
--
-- This lives in its OWN table rather than as columns on public.brands because
-- `brands` has no anon/authenticated table grants today; adding columns there
-- would re-open the ACL question 20260806020000_contract_public_application_acl.sql
-- just closed.
--
-- Two deliberate details below:
--   * `after insert or update of description, description_en, blurb, blurb_en`
--     scopes the trigger to the editorial columns, so it stays off every
--     unrelated write to `brands` (status flips, enrichment timestamps, search
--     vector refreshes, ...).
--   * the `where p.description_content_hash is distinct from excluded...` clause
--     on the upsert is what makes `last_material_update_at` bump only when the
--     content hash actually changes -- a no-op rewrite of identical copy leaves
--     the timestamp alone.
--
-- pgcrypto is installed in the `extensions` schema, hence `extensions.digest(...)`.

create table if not exists public.brand_content_provenance (
  brand_id                 uuid primary key references public.brands(id) on delete cascade,
  description_content_hash text        not null,
  first_published_at       timestamptz not null,
  last_material_update_at  timestamptz not null default now()
);

alter table public.brand_content_provenance enable row level security;
-- No policies: anon/authenticated get nothing. service_role bypasses RLS.
revoke all on table public.brand_content_provenance from anon, authenticated;

create or replace function public.brands_track_content_provenance()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  new_hash text;
begin
  new_hash := encode(extensions.digest(
    coalesce(new.description, '')    || chr(31) || coalesce(new.description_en, '') || chr(31) ||
    coalesce(new.blurb, '')          || chr(31) || coalesce(new.blurb_en, ''),
    'sha256'), 'hex');

  insert into public.brand_content_provenance as p
        (brand_id, description_content_hash, first_published_at, last_material_update_at)
  values (new.id, new_hash, coalesce(new.approved_at, new.created_at, now()), now())
  on conflict (brand_id) do update
     set description_content_hash = excluded.description_content_hash,
         last_material_update_at  = now()
   where p.description_content_hash is distinct from excluded.description_content_hash;

  return new;
end $$;

-- Supabase re-applies its schema-public DEFAULT PRIVILEGES on function create,
-- granting EXECUTE to anon/authenticated. `from public` alone does NOT undo
-- those explicit per-role grants, so revoke by role name as well.
revoke all on function public.brands_track_content_provenance() from public;
revoke all on function public.brands_track_content_provenance() from anon, authenticated;

create trigger brands_content_provenance
after insert or update of description, description_en, blurb, blurb_en
on public.brands
for each row execute function public.brands_track_content_provenance();

-- Backfill
insert into public.brand_content_provenance
      (brand_id, description_content_hash, first_published_at, last_material_update_at)
select b.id,
       encode(extensions.digest(
         coalesce(b.description, '') || chr(31) || coalesce(b.description_en, '') || chr(31) ||
         coalesce(b.blurb, '')       || chr(31) || coalesce(b.blurb_en, ''), 'sha256'), 'hex'),
       coalesce(b.approved_at, b.created_at, now()),
       coalesce(b.updated_at, b.created_at, now())
  from public.brands b
on conflict (brand_id) do nothing;
