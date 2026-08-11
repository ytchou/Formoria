-- Preserve brands.retail_locations: it contains admin- and submitter-sourced data
-- used by the refresh, approval, and quality-metrics paths.
delete from public.brand_location_candidates;
delete from public.brand_channels;
