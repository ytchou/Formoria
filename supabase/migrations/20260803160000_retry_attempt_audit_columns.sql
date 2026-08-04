alter table public.brand_ai_results
  add column if not exists retry_attempt smallint not null default 0;

alter table public.brand_search_results
  add column if not exists retry_attempt smallint not null default 0;

alter table public.brand_ai_results
  add constraint brand_ai_results_retry_attempt_check check (retry_attempt >= 0);

alter table public.brand_search_results
  add constraint brand_search_results_retry_attempt_check check (retry_attempt >= 0);
