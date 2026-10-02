-- DEV-1902: the replayable LLM call log. Every audited chat call stores the
-- caller's logical request (messages, schema, tools, params; image data URIs
-- replaced by canonical URLs) next to raw_response, so llm-eval replay can
-- re-send it on another model. No backfill: historical rows only kept a
-- 2,000-char system/user copy in `input`.
alter table public.brand_ai_results add column if not exists request jsonb;

comment on column public.brand_ai_results.request is
  'Logical chat input as passed to client.chat (v1): messages or system/user, schema, tools, json, maxTokens, temperature, reasoningEffort, imageDetail, meta; image data URIs replaced by URLs. Unredacted (holds no auth). No retention by design (DEV-1902); if total request bytes pass ~5 GB, add a per-phase prune modelled on purge-external-call-audit. Null on rows before 2026-10-01 and when the builder failed.';
