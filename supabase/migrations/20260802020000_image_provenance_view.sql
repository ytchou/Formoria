BEGIN;

-- `brand_images.source` collapses Instagram, Pinkoi, Shopee, single-page and
-- crawl into one value ('scrape'), so provider_metadata->>'method' is the only
-- place the acquisition method survives. This view joins the two so image
-- acquisition can be audited by brand, method and time without hand-writing the
-- jsonb accessors each run.
CREATE OR REPLACE VIEW public.brand_image_provenance
WITH (security_invoker = true) AS
SELECT
  b.slug            AS brand_slug,
  b.name            AS brand_name,
  bi.id             AS image_id,
  bi.source,
  COALESCE(bi.provider_metadata->>'method', bi.source) AS method,
  bi.provider_metadata->>'pageUrl'  AS source_page,
  bi.provider_metadata->>'query'    AS search_query,
  bi.source_url,
  bi.status,
  bi.score,
  bi.tags,
  bi.rejection_reasons,
  bi.width,
  bi.height,
  bi.created_at
FROM public.brand_images bi
JOIN public.brands b ON b.id = bi.brand_id;

COMMENT ON VIEW public.brand_image_provenance IS
  'Audit view for image acquisition: one row per brand image with the acquisition method resolved from provider_metadata, so acquisition can be reviewed by brand, method and time.';

-- Supabase's default privileges on `public` grant ALL to anon and authenticated
-- on every new relation, views included, so this view is published at
-- /rest/v1/brand_image_provenance the moment it exists. Today it would return
-- nothing — security_invoker applies the caller's RLS and brand_images has RLS
-- enabled with zero policies — but that is the only thing stopping it, and a
-- single permissive SELECT policy added to brand_images later would turn this
-- into a public feed of storage paths, search queries and rejection reasons.
-- An internal audit view should not depend on another table's policy count.
REVOKE ALL ON TABLE public.brand_image_provenance FROM anon, authenticated;
GRANT SELECT ON TABLE public.brand_image_provenance TO service_role;

COMMIT;
