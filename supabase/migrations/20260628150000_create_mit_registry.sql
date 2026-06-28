CREATE TABLE IF NOT EXISTS mit_registry (
  id            serial PRIMARY KEY,
  cert_number   text NOT NULL UNIQUE,
  company_name  text,
  brand_name    text,
  product_name  text,
  product_model text,
  industry_type text,
  valid_until   text,
  synced_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mit_registry_cert_number ON mit_registry (cert_number);

COMMENT ON TABLE mit_registry IS 'Weekly sync of MIT 微笑標章 certified products from data.gov.tw #6027';
