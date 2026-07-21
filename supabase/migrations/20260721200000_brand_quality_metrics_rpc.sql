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
AS $$
  WITH brand_scores AS (
    SELECT
      (hero_image_url IS NOT NULL)::int
      + (length(trim(coalesce(description, ''))) >= 20)::int
      + (purchase_website IS NOT NULL
         OR purchase_pinkoi IS NOT NULL
         OR purchase_shopee IS NOT NULL
         OR (other_urls IS NOT NULL
             AND other_urls != '[]'::jsonb
             AND jsonb_array_length(other_urls) > 0))::int
      + (social_instagram IS NOT NULL
         OR social_threads IS NOT NULL
         OR social_facebook IS NOT NULL)::int
      + (founding_year IS NOT NULL)::int
      + (retail_locations IS NOT NULL
         AND retail_locations != '[]'::jsonb
         AND jsonb_array_length(retail_locations) > 0)::int
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
    count(*)                                                        AS total_brands,
    count(*) FILTER (WHERE hero_image_url IS NOT NULL)              AS hero_image_count,
    count(*) FILTER (WHERE social_instagram IS NOT NULL)            AS social_instagram_count,
    count(*) FILTER (WHERE social_threads IS NOT NULL)              AS social_threads_count,
    count(*) FILTER (WHERE social_facebook IS NOT NULL)             AS social_facebook_count,
    count(*) FILTER (WHERE purchase_website IS NOT NULL)            AS purchase_website_count,
    count(*) FILTER (WHERE purchase_pinkoi IS NOT NULL)             AS purchase_pinkoi_count,
    count(*) FILTER (WHERE purchase_shopee IS NOT NULL)             AS purchase_shopee_count,
    count(*) FILTER (WHERE length(trim(coalesce(description, ''))) >= 20) AS description_count,
    avg(length(trim(description))) FILTER (WHERE description IS NOT NULL) AS avg_description_length,
    count(*) FILTER (WHERE completed >= 5)                          AS completeness_excellent,
    count(*) FILTER (WHERE completed = 4)                           AS completeness_good,
    count(*) FILTER (WHERE completed = 3)                           AS completeness_fair,
    count(*) FILTER (WHERE completed <= 2)                          AS completeness_poor
  FROM brand_scores;
$$;

REVOKE ALL ON FUNCTION get_brand_quality_metrics() FROM public;
GRANT EXECUTE ON FUNCTION get_brand_quality_metrics() TO service_role;
