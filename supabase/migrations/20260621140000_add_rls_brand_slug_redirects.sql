-- Enable RLS on brand_slug_redirects
ALTER TABLE brand_slug_redirects ENABLE ROW LEVEL SECURITY;

-- Anyone can look up redirects (needed for brand detail page SSR)
CREATE POLICY "Public read access"
  ON brand_slug_redirects
  FOR SELECT
  USING (true);

-- Only service_role can write (admin curation operations use service client)
CREATE POLICY "Service role write access"
  ON brand_slug_redirects
  FOR ALL
  USING (auth.role() = 'service_role');
