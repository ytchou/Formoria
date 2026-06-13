-- No uniqueness constraint — multiple submissions can reference the same UBN if earlier ones were rejected
ALTER TABLE brand_submissions ADD COLUMN unified_business_number TEXT;
