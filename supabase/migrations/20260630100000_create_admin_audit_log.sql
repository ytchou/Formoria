CREATE TABLE IF NOT EXISTS admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES auth.users(id),
  admin_email TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('impersonate_start', 'impersonate_end', 'brand_edit', 'draft_save', 'draft_publish', 'draft_discard')),
  target_brand_slug TEXT,
  target_brand_id UUID REFERENCES brands(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_admin_audit_admin ON admin_audit_log(admin_user_id, created_at DESC);
CREATE INDEX idx_admin_audit_brand ON admin_audit_log(target_brand_id, created_at DESC);

-- TODO: Add pg_cron job or application-level cleanup to purge entries older than 90 days
