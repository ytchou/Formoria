ALTER TABLE public.newsletter_subscribers
  ADD COLUMN IF NOT EXISTS consent_source text,
  ADD COLUMN IF NOT EXISTS consent_version text,
  ADD COLUMN IF NOT EXISTS consent_recorded_at timestamptz;

ALTER TABLE public.newsletter_subscribers
  DROP CONSTRAINT IF EXISTS newsletter_subscribers_consent_source_check;

ALTER TABLE public.newsletter_subscribers
  ADD CONSTRAINT newsletter_subscribers_consent_source_check
  CHECK (
    consent_source IS NULL OR consent_source IN (
      'homepage_newsletter',
      'guest_recommendation',
      'account_signup',
      'google_signup',
      'owner_quick_submission',
      'owner_detailed_submission',
      'brand_claim',
      'settings'
    )
  );

ALTER TABLE public.owner_email_preferences
  ADD COLUMN IF NOT EXISTS lifecycle_opted_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS consent_source text,
  ADD COLUMN IF NOT EXISTS consent_version text;

ALTER TABLE public.owner_email_preferences
  DROP CONSTRAINT IF EXISTS owner_email_preferences_consent_source_check;

ALTER TABLE public.owner_email_preferences
  ADD CONSTRAINT owner_email_preferences_consent_source_check
  CHECK (
    consent_source IS NULL OR consent_source IN (
      'account_signup',
      'google_signup',
      'owner_quick_submission',
      'owner_detailed_submission',
      'brand_claim',
      'settings'
    )
  );

CREATE INDEX IF NOT EXISTS idx_owner_email_preferences_active
  ON public.owner_email_preferences (user_id)
  WHERE lifecycle_opted_in_at IS NOT NULL AND unsubscribed_at IS NULL;

-- The profile flag was never consulted by lifecycle delivery and defaulted to
-- true. The category-specific preference rows are now the only source of truth.
ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS email_notifications;
