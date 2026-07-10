-- Enrichment audit trail: input, attempt, config, latency for LLM and SERP calls

-- brand_ai_results: full LLM audit trail
ALTER TABLE brand_ai_results ADD COLUMN IF NOT EXISTS input jsonb;
ALTER TABLE brand_ai_results ADD COLUMN IF NOT EXISTS attempt smallint DEFAULT 1;
ALTER TABLE brand_ai_results ADD COLUMN IF NOT EXISTS config jsonb;
ALTER TABLE brand_ai_results ADD COLUMN IF NOT EXISTS latency_ms integer;

-- brand_search_results: SERP audit trail
ALTER TABLE brand_search_results ADD COLUMN IF NOT EXISTS config jsonb;
ALTER TABLE brand_search_results ADD COLUMN IF NOT EXISTS latency_ms integer;
