-- RLS Audit Hardening
-- Enables RLS and adds explicit, idempotent policies for audit-flagged tables.

-- =============================================================================
-- newsletter_subscribers
-- =============================================================================
ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'newsletter_subscribers'
      AND policyname = 'service_role_all_newsletter_subscribers'
  ) THEN
    CREATE POLICY service_role_all_newsletter_subscribers
      ON public.newsletter_subscribers
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- =============================================================================
-- email_sends
-- =============================================================================
ALTER TABLE public.email_sends ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'email_sends'
      AND policyname = 'service_role_all_email_sends'
  ) THEN
    CREATE POLICY service_role_all_email_sends
      ON public.email_sends
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- =============================================================================
-- owner_email_preferences
-- =============================================================================
ALTER TABLE public.owner_email_preferences ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'owner_email_preferences'
      AND policyname = 'service_role_all_owner_email_preferences'
  ) THEN
    CREATE POLICY service_role_all_owner_email_preferences
      ON public.owner_email_preferences
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- =============================================================================
-- moderation_flags
-- =============================================================================
ALTER TABLE public.moderation_flags ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'moderation_flags'
      AND policyname = 'service_role_all_moderation_flags'
  ) THEN
    CREATE POLICY service_role_all_moderation_flags
      ON public.moderation_flags
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- =============================================================================
-- claim_requests
-- =============================================================================
ALTER TABLE public.claim_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'claim_requests'
      AND policyname = 'service_role_all_claim_requests'
  ) THEN
    CREATE POLICY service_role_all_claim_requests
      ON public.claim_requests
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- =============================================================================
-- brand_analytics
-- =============================================================================
ALTER TABLE public.brand_analytics ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'brand_analytics'
      AND policyname = 'service_role_all_brand_analytics'
  ) THEN
    CREATE POLICY service_role_all_brand_analytics
      ON public.brand_analytics
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'brand_analytics'
      AND policyname = 'owner_select_brand_analytics'
  ) THEN
    CREATE POLICY owner_select_brand_analytics
      ON public.brand_analytics
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.brand_owners bo
          WHERE bo.brand_id = brand_analytics.brand_id
            AND bo.user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- =============================================================================
-- brand_reports
-- =============================================================================
ALTER TABLE public.brand_reports ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'brand_reports'
      AND policyname = 'service_role_all_brand_reports'
  ) THEN
    CREATE POLICY service_role_all_brand_reports
      ON public.brand_reports
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'brand_reports'
      AND policyname = 'owner_select_brand_reports'
  ) THEN
    CREATE POLICY owner_select_brand_reports
      ON public.brand_reports
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.brand_owners bo
          WHERE bo.brand_id = brand_reports.brand_id
            AND bo.user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- =============================================================================
-- brand_saves
-- =============================================================================
ALTER TABLE public.brand_saves ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'brand_saves'
      AND policyname = 'service_role_all_brand_saves'
  ) THEN
    CREATE POLICY service_role_all_brand_saves
      ON public.brand_saves
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'brand_saves'
      AND policyname = 'owner_select_brand_saves'
  ) THEN
    CREATE POLICY owner_select_brand_saves
      ON public.brand_saves
      FOR SELECT
      USING (user_id = auth.uid());
  END IF;
END $$;

-- =============================================================================
-- feedback
-- =============================================================================
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'feedback'
      AND policyname = 'service_role_all_feedback'
  ) THEN
    CREATE POLICY service_role_all_feedback
      ON public.feedback
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'feedback'
      AND policyname = 'authenticated_insert_feedback'
  ) THEN
    CREATE POLICY authenticated_insert_feedback
      ON public.feedback
      FOR INSERT
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;
