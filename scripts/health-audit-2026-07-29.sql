-- DEV-1231: Health Agent findings audit 2026-07-29
--
-- Clears the 23 data-backed findings from the nightly Health Agent run.
-- The other 14 findings are detector false positives fixed in code
-- (brand-review CJK ratio, link-health sticky flag, knip config) and the
-- 11 Sentry findings were triaged directly in Sentry.
--
-- Every statement is scoped by explicit brand id so a re-run is a no-op.

BEGIN;

-- 1. directory:approved-brand-invariant:approved-at
-- 64 brands seeded on 2026-06-06 (plus 3 from 2026-06-17) were inserted with
-- status='approved' but no approved_at. They predate the approval flow that
-- sets the timestamp, so created_at is the honest value: it is when the row
-- entered the directory as approved. Scoped to NULL rows only, never overwrites
-- a real approval timestamp.
UPDATE public.brands
SET approved_at = created_at
WHERE status = 'approved'
  AND approved_at IS NULL;

-- 2. directory:brand-review-purchase-website-social (3 findings)
-- purchase_website must be a storefront. These hold social URLs; the first two
-- are the bare Threads domain, which lands on the Threads homepage and is worth
-- nothing to a visitor. All three keep a usable visit CTA via social_instagram,
-- so nulling does not trip brand-review-visit-cta-disabled.
UPDATE public.brands
SET purchase_website = NULL
WHERE id = '374bf5a6-2306-4ecc-b85a-21b563d774d4'   -- golday-jewelry
  AND purchase_website = 'https://www.threads.com';

UPDATE public.brands
SET purchase_website = NULL
WHERE id = '4b5d70e9-a7d7-4abb-b5b4-a58906ac0ea0'   -- terrific
  AND purchase_website = 'https://www.threads.com';

-- bamboola-1980 holds a real Threads *profile*. Relocate it to social_threads
-- (currently NULL) rather than discarding it.
UPDATE public.brands
SET purchase_website = NULL,
    social_threads = COALESCE(
      social_threads,
      'https://www.threads.com/@bamboola1980.tw'
    )
WHERE id = '89cec845-7922-4bd1-9300-344fea1351f8'
  AND purchase_website = 'https://www.threads.com/@bamboola1980.tw';

-- 3. directory:brand-review-purchase-website-non-root (1 finding)
-- jt-home pointed at a deep page; the root serves the same storefront (200).
UPDATE public.brands
SET purchase_website = 'https://www.jt-home.com.tw/'
WHERE id = 'ad9046a4-006f-4fa7-8b1a-44efc6292595'
  AND purchase_website = 'https://www.jt-home.com.tw/jt-home.html';

-- 4. link:link-cleanup (9 findings)
-- None of the nine URLs are actually dead. Verified 2026-07-29 with
-- `curl -sIL --max-time 20`:
--   www-only (apex fails TLS or DNS, www returns 200) -> correct the URL
--   already 200 at the recorded URL                   -> stale sticky flag
--   both hosts fail                                    -> null it
--
-- 4a. Apex host is broken, www serves the storefront.
UPDATE public.brands
SET purchase_website = 'https://www.patopato.co'
WHERE id = '6e10b594-4723-46f2-9044-3f27ff0b8824'
  AND purchase_website = 'https://patopato.co';

UPDATE public.brands
SET purchase_website = 'https://www.newbuffalo.com.tw'
WHERE id = 'c95ac927-d0f2-48db-b146-29c0f5e5c7f0'
  AND purchase_website = 'https://newbuffalo.com.tw';

UPDATE public.brands
SET purchase_website = 'https://www.grandmatherapy.com'
WHERE id = 'da53ad84-ca44-4d8e-a74a-1b3af8b05313'
  AND purchase_website = 'https://grandmatherapy.com';

UPDATE public.brands
SET purchase_website = 'https://www.dkgpshop.com'
WHERE id = 'fa6707e2-7bc6-4cd4-967f-eb2925799e34'
  AND purchase_website = 'https://dkgpshop.com';

-- 4b. rafac: expired TLS certificate on the apex, www does not resolve.
-- Genuinely unreachable. The brand keeps a visit CTA via social_threads and
-- social_instagram.
UPDATE public.brands
SET purchase_website = NULL
WHERE id = 'e2134cb6-74e3-4931-a067-fb9add978092'
  AND purchase_website = 'https://rafac.com.tw';

-- 4c. Clear the sticky cleanup flag for every one of the nine rows.
-- link-health only reset cleanup_required_at when the URL string changed, so a
-- recovered link stayed flagged forever and regenerated the finding nightly.
-- The code fix lands in src/lib/services/link-health.ts; this clears the rows
-- already poisoned so the count drops on the next run regardless of deploy
-- timing. failure_dates and distinct_failure_days must move together: there is
-- a CHECK (distinct_failure_days = cardinality(failure_dates)).
UPDATE public.link_check_results
SET cleanup_required = false,
    cleanup_required_at = NULL,
    consecutive_failures = 0,
    failure_dates = '{}',
    distinct_failure_days = 0
WHERE field = 'purchase_website'
  AND brand_id IN (
    '4348f379-f6e0-4fdf-9fd7-662b7ecb2624',  -- yvonne-collection, 200 today
    '4ce279a6-b1dc-4836-ae92-aad0acfc5431',  -- apz, 200 today
    '6e10b594-4723-46f2-9044-3f27ff0b8824',  -- patopato, url corrected above
    '9d55ea5d-4211-4f88-b106-8d3208f502db',  -- babybabycool, 200 today
    'a532f3e2-0c54-40c8-a1ee-f64b87cbf31f',  -- chuan-yuan, 200 today
    'c95ac927-d0f2-48db-b146-29c0f5e5c7f0',  -- newbuffalo, url corrected above
    'da53ad84-ca44-4d8e-a74a-1b3af8b05313',  -- grandmatherapy, url corrected
    'e2134cb6-74e3-4931-a067-fb9add978092',  -- rafac, nulled above
    'fa6707e2-7bc6-4cd4-967f-eb2925799e34'   -- dkgpshop, url corrected above
  );

-- 5. Three further rows carried the same stale cleanup flag without yet being
-- reported as findings. Clearing them now stops them surfacing as new findings
-- on the next run. i-spray and jswood serve 200 at the recorded URL; amara only
-- resolves on www.
UPDATE public.brands
SET purchase_website = 'https://www.amara.com.tw'
WHERE id = 'f0b766c9-9f3c-45c9-b33d-a05a84179264'
  AND purchase_website = 'https://amara.com.tw';

UPDATE public.link_check_results
SET cleanup_required = false,
    cleanup_required_at = NULL,
    consecutive_failures = 0,
    failure_dates = '{}',
    distinct_failure_days = 0
WHERE field = 'purchase_website'
  AND brand_id IN (
    '3c06a8b5-eb56-4de0-831e-0a5a14080de7',  -- i-spray, 200 today
    'ab8aae80-aace-4429-936b-4de958374e9f',  -- jswood, 200 today
    'f0b766c9-9f3c-45c9-b33d-a05a84179264'   -- amara, url corrected above
  );

-- 6. Health queue bookkeeping (applied via the REST API, recorded here).
-- The 11 sentry:issue:<numeric-id> rows were triaged directly in Sentry
-- (9 resolved as stale, 2 archived until 10 events/hour) and marked fixed.
-- The 10 legacy sentry:issue:<hash> rows predate the numeric-id fingerprint
-- format and can never be matched by a detector again, so they were skipped.
-- Every other open row closes on its own once tomorrow's run observes the
-- fingerprint is gone (source='sentry' is the only source excluded from
-- detector-absence closure).

COMMIT;
