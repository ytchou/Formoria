CREATE TABLE brand_slug_redirects (
  old_slug TEXT PRIMARY KEY,
  new_slug TEXT NOT NULL REFERENCES brands(slug) ON UPDATE CASCADE ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_brand_slug_redirects_new_slug ON brand_slug_redirects(new_slug);
