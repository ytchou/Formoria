-- Per-call LLM cost tracking.
--
-- The token counts have always been captured — they just lived inside
-- brand_ai_results.raw_response as JSONB, which makes them unqueryable at any
-- useful scale. This promotes them to columns and adds the price table needed
-- to turn them into dollars, because no LLM provider returns a cost figure.
--
-- Prices are versioned by effective_from rather than stored as a single current
-- rate: a historical row must keep the cost it actually incurred, so re-pricing
-- the table must never silently rewrite last month's spend.

create table if not exists llm_model_prices (
  id                 uuid primary key default gen_random_uuid(),
  model              text        not null,
  -- USD per 1,000,000 tokens, matching how providers publish their rates.
  input_per_m        numeric(10, 4) not null,
  -- Cached input is billed separately and can be an order of magnitude cheaper;
  -- folding it into input_per_m overstates spend badly on cache-heavy phases.
  cached_input_per_m numeric(10, 4) not null,
  output_per_m       numeric(10, 4) not null,
  effective_from     timestamptz not null default now(),
  source             text,
  created_at         timestamptz not null default now(),
  constraint llm_model_prices_model_effective_key unique (model, effective_from)
);

comment on table llm_model_prices is
  'USD per 1M tokens by model, versioned by effective_from so historical costs stay stable when rates change.';

create index if not exists llm_model_prices_lookup_idx
  on llm_model_prices (model, effective_from desc);

-- Published rates as of 2026-08-03.
insert into llm_model_prices (model, input_per_m, cached_input_per_m, output_per_m, effective_from, source)
values
  ('gpt-5.6-luna', 0.20, 0.02,  1.20, '2026-01-01T00:00:00Z', 'openai public pricing, captured 2026-08-03'),
  ('gpt-4o-mini',  0.15, 0.075, 0.60, '2026-01-01T00:00:00Z', 'openai public pricing, captured 2026-08-03')
on conflict (model, effective_from) do nothing;

alter table brand_ai_results
  add column if not exists prompt_tokens        integer,
  add column if not exists cached_prompt_tokens integer,
  add column if not exists completion_tokens    integer,
  add column if not exists cost_usd             numeric(12, 6);

-- prompt_tokens is the provider's total and INCLUDES cached_prompt_tokens.
-- Billable uncached input is (prompt_tokens - cached_prompt_tokens); storing the
-- provider's own field verbatim keeps the row reconcilable against an invoice.
comment on column brand_ai_results.prompt_tokens is
  'Provider prompt_tokens, inclusive of cached_prompt_tokens.';
comment on column brand_ai_results.cached_prompt_tokens is
  'Subset of prompt_tokens served from cache and billed at the cached rate.';
comment on column brand_ai_results.cost_usd is
  'Computed at insert from llm_model_prices. Null when the call returned no usage (e.g. a failed request).';

-- Cost rollups are always "spend over a window", so time leads the index.
create index if not exists brand_ai_results_cost_idx
  on brand_ai_results (created_at desc, model)
  where cost_usd is not null;

-- Backfill the rows that already carry usage. Failed calls have no usage object
-- and are deliberately left null rather than zero: zero would read as "this call
-- was free", which is a different and wrong claim.
update brand_ai_results r
set
  prompt_tokens        = (r.raw_response -> 'usage' ->> 'prompt_tokens')::int,
  cached_prompt_tokens = coalesce((r.raw_response -> 'usage' -> 'prompt_tokens_details' ->> 'cached_tokens')::int, 0),
  completion_tokens    = (r.raw_response -> 'usage' ->> 'completion_tokens')::int,
  cost_usd             = round(
      (((r.raw_response -> 'usage' ->> 'prompt_tokens')::numeric
        - coalesce((r.raw_response -> 'usage' -> 'prompt_tokens_details' ->> 'cached_tokens')::numeric, 0))
       / 1000000 * p.input_per_m)
    + (coalesce((r.raw_response -> 'usage' -> 'prompt_tokens_details' ->> 'cached_tokens')::numeric, 0)
       / 1000000 * p.cached_input_per_m)
    + ((r.raw_response -> 'usage' ->> 'completion_tokens')::numeric
       / 1000000 * p.output_per_m)
  , 6)
from llm_model_prices p
where p.model = r.model
  and p.effective_from <= r.created_at
  and r.raw_response ? 'usage'
  and r.prompt_tokens is null
  and not exists (
    select 1 from llm_model_prices later
    where later.model = p.model
      and later.effective_from <= r.created_at
      and later.effective_from > p.effective_from
  );
