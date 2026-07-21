CREATE TABLE link_check_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  field text NOT NULL
    CHECK (field IN ('purchase_website', 'purchase_pinkoi', 'purchase_shopee', 'hero_image_url')),
  url text NOT NULL,
  last_status_code int,
  last_ok_at timestamptz,
  last_checked_at timestamptz,
  consecutive_failures int NOT NULL DEFAULT 0,
  auto_nulled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, field)
);

ALTER TABLE link_check_results ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON link_check_results TO service_role;

CREATE TRIGGER link_check_results_updated_at
  BEFORE UPDATE ON link_check_results
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
