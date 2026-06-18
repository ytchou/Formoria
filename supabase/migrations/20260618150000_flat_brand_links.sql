BEGIN;

-- 1. Add new columns to brands
ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS social_instagram text,
  ADD COLUMN IF NOT EXISTS social_threads text,
  ADD COLUMN IF NOT EXISTS social_facebook text,
  ADD COLUMN IF NOT EXISTS purchase_website text,
  ADD COLUMN IF NOT EXISTS purchase_pinkoi text,
  ADD COLUMN IF NOT EXISTS purchase_shopee text,
  ADD COLUMN IF NOT EXISTS other_urls jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 2. Add new columns to brand_submissions
ALTER TABLE brand_submissions
  ADD COLUMN IF NOT EXISTS social_instagram text,
  ADD COLUMN IF NOT EXISTS social_threads text,
  ADD COLUMN IF NOT EXISTS social_facebook text,
  ADD COLUMN IF NOT EXISTS purchase_website text,
  ADD COLUMN IF NOT EXISTS purchase_pinkoi text,
  ADD COLUMN IF NOT EXISTS purchase_shopee text,
  ADD COLUMN IF NOT EXISTS other_urls jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 3. Backfill brands from social_links JSONB
UPDATE brands SET
  social_instagram = social_links->>'instagram',
  social_threads   = social_links->>'threads',
  social_facebook  = social_links->>'facebook',
  purchase_website = COALESCE(
    social_links->>'official_website',
    social_links->>'officialWebsite'
  )
WHERE social_links IS NOT NULL AND social_links != '{}'::jsonb;

-- 4. Backfill brands from purchase_links JSONB
-- Extract Pinkoi URLs
UPDATE brands SET purchase_pinkoi = sub.url
FROM (
  SELECT DISTINCT ON (b.id) b.id, (elem->>'url') AS url
  FROM brands b, jsonb_array_elements(b.purchase_links) AS elem
  WHERE lower(elem->>'url') LIKE '%pinkoi.com%'
  ORDER BY b.id
) sub
WHERE brands.id = sub.id AND brands.purchase_pinkoi IS NULL;

-- Extract Shopee URLs
UPDATE brands SET purchase_shopee = sub.url
FROM (
  SELECT DISTINCT ON (b.id) b.id, (elem->>'url') AS url
  FROM brands b, jsonb_array_elements(b.purchase_links) AS elem
  WHERE lower(elem->>'url') LIKE '%shopee.tw%'
  ORDER BY b.id
) sub
WHERE brands.id = sub.id AND brands.purchase_shopee IS NULL;

-- Extract brand websites (non-pinkoi, non-shopee) into purchase_website if still null
UPDATE brands SET purchase_website = sub.url
FROM (
  SELECT DISTINCT ON (b.id) b.id, (elem->>'url') AS url
  FROM brands b, jsonb_array_elements(b.purchase_links) AS elem
  WHERE lower(elem->>'url') NOT LIKE '%pinkoi.com%'
    AND lower(elem->>'url') NOT LIKE '%shopee.tw%'
  ORDER BY b.id
) sub
WHERE brands.id = sub.id AND brands.purchase_website IS NULL;

-- Collect remaining purchase_links into other_urls (cap at 3)
UPDATE brands SET other_urls = sub.remaining
FROM (
  SELECT b.id, (
    SELECT jsonb_agg(item)
    FROM (
      SELECT jsonb_build_object(
        'label', COALESCE(elem->>'label', elem->>'platform', 'Link'),
        'url', elem->>'url'
      ) AS item
      FROM jsonb_array_elements(b.purchase_links) AS elem
      WHERE (elem->>'url') IS DISTINCT FROM b.purchase_pinkoi
        AND (elem->>'url') IS DISTINCT FROM b.purchase_shopee
        AND (elem->>'url') IS DISTINCT FROM b.purchase_website
      LIMIT 3
    ) t
  ) AS remaining
  FROM brands b
  WHERE b.purchase_links IS NOT NULL
    AND jsonb_array_length(b.purchase_links) > 0
) sub
WHERE brands.id = sub.id AND sub.remaining IS NOT NULL;

-- 5. Backfill brand_submissions from social_links
UPDATE brand_submissions SET
  social_instagram = social_links->>'instagram',
  social_threads   = social_links->>'threads',
  social_facebook  = social_links->>'facebook',
  purchase_website = COALESCE(
    social_links->>'official_website',
    social_links->>'officialWebsite'
  )
WHERE social_links IS NOT NULL AND social_links != '{}'::jsonb;

-- 6. Backfill draft_data in brands (convert old link keys)
UPDATE brands SET draft_data = draft_data
  - 'socialLinks'
  - 'purchaseLinks'
  || jsonb_build_object(
    'socialInstagram', draft_data->'socialLinks'->>'instagram',
    'socialThreads',   draft_data->'socialLinks'->>'threads',
    'socialFacebook',  draft_data->'socialLinks'->>'facebook',
    'purchaseWebsite', COALESCE(
      sub.purchase_website,
      draft_data->'socialLinks'->>'officialWebsite',
      draft_data->'socialLinks'->>'official_website'
    ),
    'purchasePinkoi', sub.purchase_pinkoi,
    'purchaseShopee', sub.purchase_shopee,
    'otherUrls', COALESCE(sub.other_urls, '[]'::jsonb)
  )
FROM (
  SELECT b.id, links.purchase_pinkoi, links.purchase_shopee, links.purchase_website, links.other_urls
  FROM brands b
  LEFT JOIN LATERAL (
    SELECT
      (
        SELECT elem->>'url'
        FROM jsonb_array_elements(COALESCE(b.draft_data->'purchaseLinks', '[]'::jsonb)) AS elem
        WHERE lower(elem->>'url') LIKE '%pinkoi.com%'
        LIMIT 1
      ) AS purchase_pinkoi,
      (
        SELECT elem->>'url'
        FROM jsonb_array_elements(COALESCE(b.draft_data->'purchaseLinks', '[]'::jsonb)) AS elem
        WHERE lower(elem->>'url') LIKE '%shopee.tw%'
        LIMIT 1
      ) AS purchase_shopee,
      (
        SELECT elem->>'url'
        FROM jsonb_array_elements(COALESCE(b.draft_data->'purchaseLinks', '[]'::jsonb)) AS elem
        WHERE lower(elem->>'url') NOT LIKE '%pinkoi.com%'
          AND lower(elem->>'url') NOT LIKE '%shopee.tw%'
        LIMIT 1
      ) AS purchase_website,
      (
        SELECT jsonb_agg(item)
        FROM (
          SELECT jsonb_build_object(
            'label', COALESCE(elem->>'label', elem->>'platform', 'Link'),
            'url', elem->>'url'
          ) AS item
          FROM jsonb_array_elements(COALESCE(b.draft_data->'purchaseLinks', '[]'::jsonb)) AS elem
          WHERE (elem->>'url') IS DISTINCT FROM (
              SELECT elem->>'url'
              FROM jsonb_array_elements(COALESCE(b.draft_data->'purchaseLinks', '[]'::jsonb)) AS elem
              WHERE lower(elem->>'url') LIKE '%pinkoi.com%'
              LIMIT 1
            )
            AND (elem->>'url') IS DISTINCT FROM (
              SELECT elem->>'url'
              FROM jsonb_array_elements(COALESCE(b.draft_data->'purchaseLinks', '[]'::jsonb)) AS elem
              WHERE lower(elem->>'url') LIKE '%shopee.tw%'
              LIMIT 1
            )
            AND (elem->>'url') IS DISTINCT FROM (
              SELECT elem->>'url'
              FROM jsonb_array_elements(COALESCE(b.draft_data->'purchaseLinks', '[]'::jsonb)) AS elem
              WHERE lower(elem->>'url') NOT LIKE '%pinkoi.com%'
                AND lower(elem->>'url') NOT LIKE '%shopee.tw%'
              LIMIT 1
            )
          LIMIT 3
        ) t
      ) AS other_urls
  ) links ON true
) sub
WHERE brands.id = sub.id
  AND (draft_data ? 'socialLinks' OR draft_data ? 'purchaseLinks');

-- 7. Drop old columns
ALTER TABLE brands DROP COLUMN IF EXISTS social_links;
ALTER TABLE brands DROP COLUMN IF EXISTS purchase_links;
ALTER TABLE brand_submissions DROP COLUMN IF EXISTS social_links;

COMMIT;
