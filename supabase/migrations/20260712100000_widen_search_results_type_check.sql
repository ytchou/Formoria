-- Widen search_type CHECK to include 'scrape' (links phase stores page scrape results)
ALTER TABLE brand_search_results
DROP CONSTRAINT brand_search_results_search_type_check;

ALTER TABLE brand_search_results
ADD CONSTRAINT brand_search_results_search_type_check
CHECK (search_type IN ('serp', 'image', 'scrape'));
