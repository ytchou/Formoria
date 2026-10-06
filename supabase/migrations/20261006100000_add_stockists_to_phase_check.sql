-- Widen brand_ai_results.phase CHECK to accept 'stockists' (DEV-1940).
--
-- DEV-1928 added the stockists enrichment phase, whose audit insert writes
-- phase = 'stockists'. The constraint never listed it, so every stockists AI
-- result, audit and cost row was rejected with a CHECK violation.
--
-- The value list is 20260903100400_add_acquire_to_phase_check.sql verbatim plus
-- 'stockists'. Production applies migrations by hand: push this before the
-- DEV-1928 code reaches main.

do $$
begin
  perform 1
    from information_schema.table_constraints
   where table_schema = 'public'
     and table_name = 'brand_ai_results'
     and constraint_name = 'brand_ai_results_phase_check';
  if not found then
    raise exception 'brand_ai_results_phase_check is missing; reconcile before adding stockists phase';
  end if;
end $$;

alter table public.brand_ai_results drop constraint brand_ai_results_phase_check;
alter table public.brand_ai_results add constraint brand_ai_results_phase_check
  check (phase in (
    'triage','detect','classification','classify_images','facts','founding_facts','founding_facts_verify',
    'descriptions','reputation','names','faq','site_identity','products','description','expansion',
    'acquisition','acquire','stockists'
  ));
