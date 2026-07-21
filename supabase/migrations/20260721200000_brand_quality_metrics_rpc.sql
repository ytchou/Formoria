CREATE OR REPLACE FUNCTION get_brand_quality_metrics()
RETURNS TABLE(
  total_brands           bigint,
  hero_image_count       bigint,
  social_instagram_count bigint,
  social_threads_count   bigint,
  social_facebook_count  bigint,
  purchase_website_count bigint,
  purchase_pinkoi_count  bigint,
  purchase_shopee_count  bigint,
  description_count      bigint,
  avg_description_length numeric,
  completeness_excellent bigint,
  completeness_good      bigint,
  completeness_fair      bigint,
  completeness_poor      bigint
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH brand_scores AS (
    SELECT
      (trim(coalesce(hero_image_url, '')) != '')::int
      + (length(trim(coalesce(description, ''))) >= 20)::int
      + (trim(coalesce(purchase_website, '')) != ''
         OR trim(coalesce(purchase_pinkoi, '')) != ''
         OR trim(coalesce(purchase_shopee, '')) != ''
         OR (jsonb_typeof(other_urls) = 'array'
             AND other_urls != '[]'::jsonb))::int
      + (trim(coalesce(social_instagram, '')) != ''
         OR trim(coalesce(social_threads, '')) != ''
         OR trim(coalesce(social_facebook, '')) != '')::int
      + (founding_year IS NOT NULL)::int
      + (retail_locations IS NOT NULL
         AND jsonb_typeof(retail_locations) = 'array'
         AND retail_locations != '[]'::jsonb)::int
        AS completed,
      hero_image_url,
      social_instagram,
      social_threads,
      social_facebook,
      purchase_website,
      purchase_pinkoi,
      purchase_shopee,
      description
    FROM brands
  )
  SELECT
    count(*)                                                                  AS total_brands,
    count(*) FILTER (WHERE trim(coalesce(hero_image_url, '')) != '')          AS hero_image_count,
    count(*) FILTER (WHERE trim(coalesce(social_instagram, '')) != '')        AS social_instagram_count,
    count(*) FILTER (WHERE trim(coalesce(social_threads, '')) != '')          AS social_threads_count,
    count(*) FILTER (WHERE trim(coalesce(social_facebook, '')) != '')         AS social_facebook_count,
    count(*) FILTER (WHERE trim(coalesce(purchase_website, '')) != '')        AS purchase_website_count,
    count(*) FILTER (WHERE trim(coalesce(purchase_pinkoi, '')) != '')         AS purchase_pinkoi_count,
    count(*) FILTER (WHERE trim(coalesce(purchase_shopee, '')) != '')         AS purchase_shopee_count,
    count(*) FILTER (WHERE length(trim(coalesce(description, ''))) >= 20)    AS description_count,
    avg(length(trim(description)))
      FILTER (WHERE length(trim(coalesce(description, ''))) >= 20)           AS avg_description_length,
    count(*) FILTER (WHERE completed >= 5)                                    AS completeness_excellent,
    count(*) FILTER (WHERE completed = 4)                                     AS completeness_good,
    count(*) FILTER (WHERE completed = 3)                                     AS completeness_fair,
    count(*) FILTER (WHERE completed <= 2)                                    AS completeness_poor
  FROM brand_scores;
$$;

REVOKE ALL ON FUNCTION get_brand_quality_metrics() FROM public;
GRANT EXECUTE ON FUNCTION get_brand_quality_metrics() TO service_role;
