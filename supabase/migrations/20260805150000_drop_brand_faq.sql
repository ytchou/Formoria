-- brand_faq_entries (20260805140000) superseded the legacy wide brand_faq table.
-- The legacy table was retained through W1-W2 as the rollback path.
drop table if exists public.brand_faq;
