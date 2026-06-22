CREATE TABLE brand_search_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  search_type text NOT NULL CHECK (search_type IN ('serp', 'image')),
  query text NOT NULL,
  urls text[] NOT NULL DEFAULT '{}',
  snippets text[] NOT NULL DEFAULT '{}',
  raw_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX brand_search_results_brand_type_idx ON brand_search_results (brand_id, search_type, created_at DESC);
