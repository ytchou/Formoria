-- DEV-1753: repair 4 brands with duplicate active-image sort_order.
--
-- Renumber active images for brands that have duplicates.
-- Uses row_number() - 1 so sort_order stays 0-based, preserving the
-- existing relative order (sort_order ASC, created_at ASC as tiebreaker).
--
-- A partial unique index is NOT added here: finalizeHeroOrder updates
-- sort_order one row at a time, so intermediate states during a re-sort
-- would violate the constraint. insertBrandImage also defaults sort_order
-- to 0, which would collide on brands that already have an active image
-- at position 0 (the 23505 swallow hides the failure).

WITH dupes AS (
  SELECT DISTINCT brand_id
  FROM public.brand_images
  WHERE status = 'active'
  GROUP BY brand_id, sort_order
  HAVING count(*) > 1
),
renumbered AS (
  SELECT
    bi.id,
    row_number() OVER (
      PARTITION BY bi.brand_id
      ORDER BY bi.sort_order, bi.created_at
    ) - 1 AS new_sort_order
  FROM public.brand_images bi
  JOIN dupes d ON d.brand_id = bi.brand_id
  WHERE bi.status = 'active'
)
UPDATE public.brand_images bi
SET sort_order = r.new_sort_order
FROM renumbered r
WHERE bi.id = r.id
  AND bi.sort_order IS DISTINCT FROM r.new_sort_order;
