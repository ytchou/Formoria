-- Bilingual enrichment fields: blurb, product_tags_en, product_tag_translations
ALTER TABLE brands ADD COLUMN IF NOT EXISTS blurb TEXT;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS blurb_en TEXT;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS product_tags_en TEXT[];

CREATE TABLE IF NOT EXISTS product_tag_translations (
  tag_zh TEXT PRIMARY KEY,
  tag_en TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
