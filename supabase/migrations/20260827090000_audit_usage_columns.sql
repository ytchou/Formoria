ALTER TABLE public.external_call_audit
  ADD COLUMN prompt_tokens integer,
  ADD COLUMN completion_tokens integer,
  ADD COLUMN cost_usd numeric;
