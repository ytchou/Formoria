-- 1. Add dismissal column
ALTER TABLE public.brands
  ADD COLUMN onboarding_dismissed_at timestamptz;

-- 2. Backfill: brands with all 5 steps complete get the latest completed_at
UPDATE public.brands b
SET onboarding_dismissed_at = sub.max_completed
FROM (
  SELECT brand_id, MAX(completed_at) AS max_completed
  FROM public.brand_onboarding_steps
  WHERE status = 'complete'
  GROUP BY brand_id
  HAVING COUNT(*) FILTER (WHERE status = 'complete') = 5
) sub
WHERE b.id = sub.brand_id;

-- 3. Drop the old table
DROP TABLE IF EXISTS public.brand_onboarding_steps CASCADE;
