-- Widen brand_ai_results.phase CHECK to accept 'acquire' (the full enrichment
-- phase that replaces the retired 'links' phase in DEV-1644 PR 3).
--
-- 'acquisition' (sub-phase, added in PR 1) stays — historical rows carry it.
-- 'acquire' is the new ENRICH_PHASES member that the orchestrator writes.

do $$
begin
  perform 1
    from information_schema.table_constraints
   where table_schema = 'public'
     and table_name = 'brand_ai_results'
     and constraint_name = 'brand_ai_results_phase_check';
  if not found then
    raise exception 'brand_ai_results_phase_check is missing; reconcile before adding acquire phase';
  end if;
end $$;

alter table public.brand_ai_results drop constraint brand_ai_results_phase_check;
alter table public.brand_ai_results add constraint brand_ai_results_phase_check
  check (phase in (
    'triage','detect','classification','classify_images','facts','founding_facts','founding_facts_verify',
    'descriptions','reputation','names','faq','site_identity','products','description','expansion',
    'acquisition','acquire'
  ));
