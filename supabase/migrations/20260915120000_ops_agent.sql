-- DEV-1685 ops agent. Reader allowlist is a maintenance surface: every new table the
-- operator wants to query needs a GRANT + POLICY here. Never add a table carrying
-- end-user email (newsletter_subscribers, brand_reports, claims) or admin_audit_log.

create table public.ops_agent_requests (
  id uuid primary key default gen_random_uuid(),
  slack_event_id text unique,
  slack_user_id text not null,
  operator_email text,
  channel_id text not null,
  thread_ts text not null,
  card_ts text,
  text text not null,
  status text not null check (status in ('received','running','answered','awaiting_confirm','executed','cancelled','expired','refused','failed')),
  proposal jsonb,
  result jsonb,
  tool_calls jsonb not null default '[]'::jsonb,
  model_calls integer not null default 0,
  cost_usd numeric(10,6) not null default 0,
  correlation_id uuid,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ops_agent_requests enable row level security;
create index ops_agent_requests_created_at_idx on public.ops_agent_requests (created_at desc);
create index ops_agent_requests_status_expires_idx on public.ops_agent_requests (status, expires_at);

-- Reader role
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'ops_agent_reader') then
    create role ops_agent_reader nologin nocreatedb nocreaterole noreplication;
  end if;
end $$;
grant ops_agent_reader to postgres;
grant ops_agent_reader to service_role;

revoke all on all tables in schema public from ops_agent_reader;
revoke all on all sequences in schema public from ops_agent_reader;
revoke execute on all functions in schema public from ops_agent_reader;
grant usage on schema public to ops_agent_reader;

-- Allowlist (Tweakable Decision 1)
grant select on public.brands, public.brand_channels, public.curation_jobs,
  public.curation_job_targets, public.brand_ai_results, public.external_call_audit,
  public.health_agent_run_ledger, public.health_fix_queue, public.health_snapshots,
  public.link_check_results to ops_agent_reader;

-- brand_submissions: column-level grant excluding submitter_email and submitter_name
grant select (
  id, brand_id, brand_name, status, submitted_at, intent, is_brand_owner,
  description, category_note, romanized_name,
  website_url, social_facebook, social_instagram, social_threads,
  purchase_website, purchase_shopee, purchase_pinkoi, purchase_myship,
  other_urls, hero_image_url, hero_image_storage_path,
  base_brand_data, base_brand_updated_at, enriched_data,
  suggested_tags, validation_status, validation_errors,
  review_overrides, reviewed_at, reviewed_by, reviewer_notes,
  denial_reason, notified_at, refresh_requested_by,
  source_attribution, idempotency_key, owner_data, pdpa_consent_at
) on public.brand_submissions to ops_agent_reader;

-- RLS policies: one SELECT policy per allowlisted table
drop policy if exists ops_agent_reader_select on public.brands;
create policy ops_agent_reader_select on public.brands for select to ops_agent_reader using (true);

drop policy if exists ops_agent_reader_select on public.brand_channels;
create policy ops_agent_reader_select on public.brand_channels for select to ops_agent_reader using (true);

drop policy if exists ops_agent_reader_select on public.brand_submissions;
create policy ops_agent_reader_select on public.brand_submissions for select to ops_agent_reader using (true);

drop policy if exists ops_agent_reader_select on public.curation_jobs;
create policy ops_agent_reader_select on public.curation_jobs for select to ops_agent_reader using (true);

drop policy if exists ops_agent_reader_select on public.curation_job_targets;
create policy ops_agent_reader_select on public.curation_job_targets for select to ops_agent_reader using (true);

drop policy if exists ops_agent_reader_select on public.brand_ai_results;
create policy ops_agent_reader_select on public.brand_ai_results for select to ops_agent_reader using (true);

drop policy if exists ops_agent_reader_select on public.external_call_audit;
create policy ops_agent_reader_select on public.external_call_audit for select to ops_agent_reader using (true);

drop policy if exists ops_agent_reader_select on public.health_agent_run_ledger;
create policy ops_agent_reader_select on public.health_agent_run_ledger for select to ops_agent_reader using (true);

drop policy if exists ops_agent_reader_select on public.health_fix_queue;
create policy ops_agent_reader_select on public.health_fix_queue for select to ops_agent_reader using (true);

drop policy if exists ops_agent_reader_select on public.health_snapshots;
create policy ops_agent_reader_select on public.health_snapshots for select to ops_agent_reader using (true);

drop policy if exists ops_agent_reader_select on public.link_check_results;
create policy ops_agent_reader_select on public.link_check_results for select to ops_agent_reader using (true);

-- Read-only query RPC
create or replace function public.ops_agent_readonly_query(p_sql text)
returns jsonb
language plpgsql
volatile
set search_path = public
set statement_timeout = '5s'
as $$
declare result jsonb;
begin
  if p_sql is null or length(p_sql) > 4000 then raise exception 'ops_agent: sql missing or too long'; end if;
  if p_sql !~* '^\s*select\M' then raise exception 'ops_agent: only a single SELECT is allowed'; end if;
  if position(';' in p_sql) > 0 then raise exception 'ops_agent: single statement only'; end if;
  set local role ops_agent_reader;
  execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select * from (%s) q limit 200) t', p_sql) into result;
  return result;
end $$;

revoke execute on function public.ops_agent_readonly_query(text) from public, anon, authenticated;
grant execute on function public.ops_agent_readonly_query(text) to service_role;
