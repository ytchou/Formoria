-- Count a brand as having a hero when either hero column is set.
--
-- `hero_image_storage_path` is the hero the site renders (brands.ts
-- heroImageUrl); `hero_image_url` is a legacy fallback that only the
-- hand-patched approval SQL still writes. Counting the legacy column alone
-- undercounted 48 approved brands that all render a hero (DEV-1852).
--
-- Body is the production definition as of 2026-09-24 with only the two hero
-- predicates changed. Same signature, so CREATE OR REPLACE keeps the grants.

CREATE OR REPLACE FUNCTION public.get_brand_quality_metrics()
 RETURNS TABLE(total_brands bigint, hero_image_count bigint, social_instagram_count bigint, social_threads_count bigint, social_facebook_count bigint, purchase_website_count bigint, purchase_pinkoi_count bigint, purchase_shopee_count bigint, purchase_myship_count bigint, description_count bigint, avg_description_length numeric, completeness_excellent bigint, completeness_good bigint, completeness_fair bigint, completeness_poor bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH brand_scores AS (
    SELECT
      (trim(coalesce(hero_image_storage_path, '')) != ''
         OR trim(coalesce(hero_image_url, '')) != '') AS has_hero,
      (trim(coalesce(hero_image_storage_path, '')) != ''
         OR trim(coalesce(hero_image_url, '')) != '')::int
      + (length(trim(coalesce(description, ''))) >= 20)::int
      + (trim(coalesce(purchase_website, '')) != ''
         OR trim(coalesce(purchase_pinkoi, '')) != ''
         OR trim(coalesce(purchase_shopee, '')) != ''
         OR trim(coalesce(purchase_myship, '')) != ''
         OR (jsonb_typeof(other_urls) = 'array'
             AND other_urls != '[]'::jsonb))::int
      + (trim(coalesce(social_instagram, '')) != ''
         OR trim(coalesce(social_threads, '')) != ''
         OR trim(coalesce(social_facebook, '')) != '')::int
      + (founding_year IS NOT NULL)::int
        AS completed,
      social_instagram,
      social_threads,
      social_facebook,
      purchase_website,
      purchase_pinkoi,
      purchase_shopee,
      purchase_myship,
      description
    FROM brands
  )
  SELECT
    count(*)                                                                  AS total_brands,
    count(*) FILTER (WHERE has_hero)                                          AS hero_image_count,
    count(*) FILTER (WHERE trim(coalesce(social_instagram, '')) != '')        AS social_instagram_count,
    count(*) FILTER (WHERE trim(coalesce(social_threads, '')) != '')          AS social_threads_count,
    count(*) FILTER (WHERE trim(coalesce(social_facebook, '')) != '')         AS social_facebook_count,
    count(*) FILTER (WHERE trim(coalesce(purchase_website, '')) != '')        AS purchase_website_count,
    count(*) FILTER (WHERE trim(coalesce(purchase_pinkoi, '')) != '')         AS purchase_pinkoi_count,
    count(*) FILTER (WHERE trim(coalesce(purchase_shopee, '')) != '')         AS purchase_shopee_count,
    count(*) FILTER (WHERE trim(coalesce(purchase_myship, '')) != '')         AS purchase_myship_count,
    count(*) FILTER (WHERE length(trim(coalesce(description, ''))) >= 20)    AS description_count,
    avg(length(trim(description)))
      FILTER (WHERE length(trim(coalesce(description, ''))) >= 20)           AS avg_description_length,
    count(*) FILTER (WHERE completed >= 5)                                    AS completeness_excellent,
    count(*) FILTER (WHERE completed = 4)                                     AS completeness_good,
    count(*) FILTER (WHERE completed = 3)                                     AS completeness_fair,
    count(*) FILTER (WHERE completed <= 2)                                    AS completeness_poor
  FROM brand_scores;
$function$;
