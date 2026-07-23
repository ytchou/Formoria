DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'brands'
      AND column_name = 'tags_enriched_at'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'brands'
      AND column_name = 'brand_enriched_at'
  ) THEN
    ALTER TABLE public.brands
      RENAME COLUMN tags_enriched_at TO brand_enriched_at;
  ELSIF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'brands'
      AND column_name = 'brand_enriched_at'
  ) THEN
    ALTER TABLE public.brands
      ADD COLUMN brand_enriched_at timestamptz;
  END IF;
END;
$$;
