WITH first_active_images AS (
  SELECT DISTINCT ON (brand_id)
    brand_id,
    url
  FROM public.brand_images
  WHERE status = 'active'
  ORDER BY brand_id, sort_order ASC, created_at ASC, id ASC
)
UPDATE public.brands AS brand
SET hero_image_url = first_active.url
FROM first_active_images AS first_active
WHERE brand.id = first_active.brand_id
  AND brand.hero_image_url IS DISTINCT FROM first_active.url;
