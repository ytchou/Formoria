drop policy if exists health_agent_reader_approved_brands on public.brands;
create policy health_agent_reader_approved_brands
  on public.brands for select to health_agent_reader
  using (status = 'approved');

drop policy if exists health_agent_reader_fix_queue on public.health_fix_queue;
create policy health_agent_reader_fix_queue
  on public.health_fix_queue for select to health_agent_reader
  using (true);

drop policy if exists health_agent_reader_snapshots on public.health_snapshots;
create policy health_agent_reader_snapshots
  on public.health_snapshots for select to health_agent_reader
  using (true);

drop policy if exists health_agent_reader_link_results on public.link_check_results;
create policy health_agent_reader_link_results
  on public.link_check_results for select to health_agent_reader
  using (true);

drop policy if exists health_agent_reader_run_ledger on public.health_agent_run_ledger;
create policy health_agent_reader_run_ledger
  on public.health_agent_run_ledger for select to health_agent_reader
  using (true);
