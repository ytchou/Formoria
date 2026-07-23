begin;

create or replace function public.reparent_brand_location_candidates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved' and new.brand_id is not null then
    update public.brand_location_candidates
    set brand_id = new.brand_id,
        submission_id = null,
        updated_at = now()
    where submission_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists brand_location_candidates_reparent
  on public.brand_submissions;

create trigger brand_location_candidates_reparent
after update of status, brand_id on public.brand_submissions
for each row
when (new.status = 'approved' and new.brand_id is not null)
execute function public.reparent_brand_location_candidates();

revoke all on function public.reparent_brand_location_candidates() from public, anon, authenticated;

commit;
