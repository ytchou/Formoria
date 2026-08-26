begin;

-- Keep the public search RPC signatures stable. Legacy MIT filter values now
-- match nothing; ownership verification remains unchanged.
do $migration$
declare
  v_definition text;
begin
  foreach v_definition in array array[
    pg_get_functiondef('public.search_brand_page(text,text[],text[],text,integer[],integer,text)'::regprocedure),
    pg_get_functiondef('public.search_brands(text,integer,boolean,text[],text[],text,text,boolean)'::regprocedure)
  ] loop
    v_definition := regexp_replace(
      v_definition,
      E'\\s+OR \\(filter_verification = ''mit-verified'' AND b\\.mit_status = ''verified''\\)\\s+OR \\(filter_verification = ''mit-declared'' AND b\\.mit_status = ''declared''\\)',
      '',
      'g'
    );
    if v_definition ~ 'mit_status' then
      raise exception 'search function still references brand MIT';
    end if;
    execute v_definition;
  end loop;

  select pg_get_functiondef(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
  ) into v_definition;
  if (
    length(v_definition) - length(replace(v_definition, ', ''mit_evidence''', ''))
  ) / length(', ''mit_evidence''') <> 5 then
    raise exception 'apply_brand_refresh: expected five MIT evidence allow-list entries';
  end if;
  execute replace(v_definition, ', ''mit_evidence''', '');

  select pg_get_functiondef(
    'public.approve_submission(uuid,uuid,jsonb)'::regprocedure
  ) into v_definition;
  v_definition := regexp_replace(
    v_definition,
    E'category_attributes, reputation_summary, mit_evidence, mit_story, hero_image_url',
    'category_attributes, reputation_summary, hero_image_url',
    'g'
  );
  v_definition := regexp_replace(
    v_definition,
    E'brand\\.reputation_summary, brand\\.mit_evidence,\\s+nullif\\(btrim\\(v_submission\\.owner_data ->> ''mitStory''\\), ''''\\),\\s+brand\\.hero_image_url',
    'brand.reputation_summary, brand.hero_image_url',
    'g'
  );
  v_definition := replace(
    v_definition,
    'reputation_summary jsonb, mit_evidence jsonb, hero_image_url text',
    'reputation_summary jsonb, hero_image_url text'
  );
  if v_definition ~ 'mit_evidence|mit_story|mitStory' then
    raise exception 'approve_submission still references brand MIT';
  end if;
  execute v_definition;
end
$migration$;

create or replace function public.revoke_brand_ownership(
  p_brand_id uuid,
  p_revoked_by text,
  p_reason text
)
returns table (revoked_user_id uuid, revoked_user_email text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_owner public.brand_owners%rowtype;
  v_revoked_user_email text;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Revocation reason is required';
  end if;
  select owner_row.* into v_owner
  from public.brand_owners as owner_row
  where owner_row.brand_id = p_brand_id
  for update;
  if not found then raise exception 'Brand owner not found'; end if;

  select auth_user.email into v_revoked_user_email
  from auth.users as auth_user where auth_user.id = v_owner.user_id;
  if v_revoked_user_email is null then
    raise exception 'Brand owner email not found';
  end if;

  delete from public.brand_owners where id = v_owner.id;
  insert into public.ownership_revocations (
    brand_id, revoked_user_id, revoked_user_email, revoked_by, reason
  ) values (
    p_brand_id, v_owner.user_id, v_revoked_user_email, p_revoked_by, p_reason
  );
  update public.brands set contact_email = null where id = p_brand_id;

  return query select v_owner.user_id, v_revoked_user_email;
end;
$function$;

do $$
begin
  if exists (
    select 1 from storage.objects where bucket_id = 'origin-evidence'
  ) then
    raise exception 'origin-evidence bucket is not empty';
  end if;
end
$$;
delete from storage.buckets where id = 'origin-evidence';
drop table if exists public.origin_evidence;

drop index if exists public.idx_brands_mit_status;
alter table public.brands
  drop column if exists mit_status,
  drop column if exists mit_story,
  drop column if exists mit_evidence,
  drop column if exists mit_declared_at,
  drop column if exists mit_declared_by,
  drop column if exists mit_declared_scope,
  drop column if exists mit_verified_at;

commit;
