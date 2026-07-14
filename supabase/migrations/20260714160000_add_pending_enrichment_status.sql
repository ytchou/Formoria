-- Allow 'pending_enrichment' status for provisional brand rows created during
-- submission enrichment (before admin approval).
ALTER TABLE public.brands
  DROP CONSTRAINT IF EXISTS brands_status_check,
  ADD CONSTRAINT brands_status_check
    CHECK (status = ANY (ARRAY['approved'::text, 'hidden'::text, 'pending_enrichment'::text]));
