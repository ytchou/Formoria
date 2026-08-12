begin;

update public.brands
set retail_locations = '[]'::jsonb
where jsonb_array_length(coalesce(retail_locations, '[]'::jsonb)) > 0;

delete from public.brand_field_events
where field = 'retail_locations';

delete from public.brand_field_state
where field = 'retail_locations';

drop table if exists public.brand_location_candidates;

commit;
