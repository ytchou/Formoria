-- RLS Security Hardening
-- Removes overly permissive policies that allow anonymous or unintended access.

-- =============================================================================
-- moderation_flags
-- =============================================================================
-- Drop the "Service role full access" policy (USING(true) FOR ALL grants access
-- to all roles, not just service_role). Service_role bypasses RLS by default,
-- so no replacement policy is needed — only service_role should access this table.
DROP POLICY IF EXISTS "Service role full access" ON moderation_flags;

-- =============================================================================
-- brand_submissions
-- =============================================================================
-- Drop the "Public can submit brands" policy that allows anonymous INSERT.
-- Replace with authenticated-only policies.
DROP POLICY IF EXISTS "Public can submit brands" ON brand_submissions;

-- Only authenticated users can submit brands
CREATE POLICY "Authenticated users can submit brands"
ON brand_submissions FOR INSERT TO authenticated
WITH CHECK (true);

-- Authenticated users can read only their own submissions
CREATE POLICY "Users can read own submissions"
ON brand_submissions FOR SELECT TO authenticated
USING (submitter_email = auth.jwt() ->> 'email');

-- =============================================================================
-- brand_owners
-- =============================================================================
-- Drop the "Service role can insert ownership" policy (WITH CHECK (true) allows
-- any authenticated or anonymous user to INSERT). Service_role bypasses RLS,
-- so no replacement is needed.
DROP POLICY IF EXISTS "Service role can insert ownership" ON brand_owners;
