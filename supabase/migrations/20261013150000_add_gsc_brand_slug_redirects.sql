-- DEV-2018: two renamed brands whose old URLs Google still crawls returned 404
-- because no brand_slug_redirects row existed (GSC export 2026-10-13).
--   facesun-玻璃工藝管 is the slug the generator derives from "FaceSun 玻璃工藝管".
--   hh: /en/brands/hh was crawled 2026-09-10; HH 健康於筷 is the only HH brand,
--   and its other old slugs already redirect to hh-healthy-happy.
-- Same shape as 20260728110000: a row lands only where the target brand is
-- approved, so the migration is a no-op on a database without these brands.
INSERT INTO brand_slug_redirects (old_slug, new_slug)
SELECT mappings.old_slug, mappings.new_slug
FROM (VALUES
  ('facesun-玻璃工藝管', 'facesun'),
  ('hh', 'hh-healthy-happy')
) AS mappings(old_slug, new_slug)
JOIN brands ON brands.slug = mappings.new_slug
  AND brands.status = 'approved'
ON CONFLICT (old_slug) DO NOTHING;
