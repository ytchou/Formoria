-- Add tsvector column
ALTER TABLE brands ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Create trigger function
CREATE OR REPLACE FUNCTION brands_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.name, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.product_type, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(NEW.tag_slugs, ' '), '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- Attach trigger
DROP TRIGGER IF EXISTS brands_search_vector_trigger ON brands;
CREATE TRIGGER brands_search_vector_trigger
  BEFORE INSERT OR UPDATE OF name, product_type, tag_slugs, description
  ON brands
  FOR EACH ROW
  EXECUTE FUNCTION brands_search_vector_update();

-- GIN index
CREATE INDEX IF NOT EXISTS idx_brands_search_vector ON brands USING GIN (search_vector);

-- Backfill existing rows
UPDATE brands SET
  search_vector =
    setweight(to_tsvector('english', COALESCE(name, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(product_type, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(tag_slugs, ' '), '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(description, '')), 'D')
WHERE search_vector IS NULL;
