-- Fix search_brands() to use product_type instead of dropped category column
DROP FUNCTION IF EXISTS public.search_brands(text, integer);

CREATE OR REPLACE FUNCTION public.search_brands(search_query text, result_limit integer DEFAULT 5)
 RETURNS TABLE(id uuid, name text, slug text, hero_image_url text, primary_category_name text, similarity_score real)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT
    b.id,
    b.name,
    b.slug,
    b.hero_image_url,
    b.product_type AS primary_category_name,
    GREATEST(
      word_similarity(search_query, b.name),
      0.5 * word_similarity(search_query, COALESCE(b.description, ''))
    )::real AS similarity_score
  FROM brands b
  WHERE
    b.status = 'approved'
    AND (
      b.name ILIKE search_query || '%'
      OR word_similarity(search_query, b.name) >= 0.25
      OR word_similarity(search_query, COALESCE(b.description, '')) >= 0.25
    )
  ORDER BY
    CASE
      WHEN b.name ILIKE search_query || '%' THEN 0
      WHEN word_similarity(search_query, b.name) >= 0.25 THEN 1
      ELSE 2
    END,
    GREATEST(
      word_similarity(search_query, b.name),
      0.5 * word_similarity(search_query, COALESCE(b.description, ''))
    ) DESC,
    b.name ASC
  LIMIT result_limit;
$function$;

-- Drop stale index that referenced dropped category column
DROP INDEX IF EXISTS idx_brands_category_status;
