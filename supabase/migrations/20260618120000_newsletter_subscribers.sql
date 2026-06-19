-- Newsletter subscriber management for email capture (DEV-794)
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  name text,
  interests text[] DEFAULT '{}',
  subscribed_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  confirm_token uuid NOT NULL DEFAULT gen_random_uuid(),
  unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid(),
  unsubscribed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT newsletter_subscribers_email_key UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_confirm_token
  ON newsletter_subscribers (confirm_token);

CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_unsubscribe_token
  ON newsletter_subscribers (unsubscribe_token);

CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_active
  ON newsletter_subscribers (subscribed_at)
  WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL;

ALTER TABLE newsletter_subscribers ENABLE ROW LEVEL SECURITY;

-- No anon/authenticated access — all operations via service role in Server Actions
CREATE POLICY "Service role full access on newsletter_subscribers"
  ON newsletter_subscribers
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
