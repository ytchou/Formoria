-- Reverts 20261013150000_add_gsc_brand_slug_redirects.sql (DEV-2018).
-- The old URLs return 404 again.
DELETE FROM brand_slug_redirects
WHERE (old_slug, new_slug) IN (
  ('facesun-玻璃工藝管', 'facesun'),
  ('hh', 'hh-healthy-happy')
);
