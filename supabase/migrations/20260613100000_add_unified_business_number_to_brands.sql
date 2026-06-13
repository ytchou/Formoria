ALTER TABLE brands ADD COLUMN unified_business_number TEXT;
-- Partial unique index: NULL values are not considered equal in SQL, so multiple NULL rows are allowed
CREATE UNIQUE INDEX idx_brands_ubn
  ON brands (unified_business_number)
  WHERE unified_business_number IS NOT NULL;
