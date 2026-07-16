ALTER TABLE public.brand_submissions ADD COLUMN IF NOT EXISTS owner_data jsonb;
COMMENT ON COLUMN public.brand_submissions.owner_data IS 'Owner-provided wizard data (productType, foundingYear, productTags, city, priceRange, productPhotos, retailLocations, mitStory). Provenance record — enrichment seeds enriched_data from this.';
