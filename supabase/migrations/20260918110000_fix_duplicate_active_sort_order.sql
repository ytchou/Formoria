-- DEV-1753 -- repair brands with duplicate active image sort_order.
--
-- 4 brands affected: sanly-joy, wuowuo, bon-bon-stickers, todayforhan.
-- Strategy: for each set of duplicates, the oldest row (by created_at)
-- keeps its sort_order; newer rows are shifted to max(sort_order)+1, +2, …
--
-- A partial unique index is NOT added here because `finalizeHeroOrder`
-- updates sort_order one row at a time, and temporary collisions during
-- reordering would violate the constraint.

WITH duplicates AS (
  SELECT bi.id, bi.brand_id, bi.sort_order, bi.created_at,
    ROW_NUMBER() OVER (
      PARTITION BY bi.brand_id, bi.sort_order
      ORDER BY bi.created_at ASC
    ) AS rn
  FROM brand_images bi
  WHERE bi.status = 'active'
),
brands_max AS (
  SELECT brand_id, MAX(sort_order) AS max_sort
  FROM brand_images
  WHERE status = 'active'
  GROUP BY brand_id
),
to_fix AS (
  SELECT d.id, d.brand_id, d.sort_order AS old_sort,
    bm.max_sort + ROW_NUMBER() OVER (
      PARTITION BY d.brand_id ORDER BY d.created_at ASC
    ) AS new_sort
  FROM duplicates d
  JOIN brands_max bm ON bm.brand_id = d.brand_id
  WHERE d.rn > 1
)
UPDATE brand_images bi
SET sort_order = tf.new_sort
FROM to_fix tf
WHERE bi.id = tf.id;
