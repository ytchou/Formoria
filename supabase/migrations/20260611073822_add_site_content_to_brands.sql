ALTER TABLE brands ADD COLUMN IF NOT EXISTS site_content jsonb;
COMMENT ON COLUMN brands.site_content IS
  'Authored microsite content overlay (DEV-767). Non-null + approved => brand.formoria.com/<slug> microsite renders. Shape: {template, tokens, tagline, story, products[], ctaType, ctaValue}.';
