import { createServiceClient } from '@/lib/supabase/server'

type AdminAction =
  | 'impersonate_start'
  | 'impersonate_end'
  | 'brand_edit'
  | 'draft_save'
  | 'draft_publish'
  | 'draft_discard'
  | 'curation_job_cancelled'
  | 'refresh_requested'
  | 'newsletter_confirmation_resent'
  | 'newsletter_unsubscribed'

type LogAdminActionParams = {
  adminUserId: string
  adminEmail: string
  action: AdminAction
  targetBrandSlug?: string
  targetBrandId?: string
  metadata?: Record<string, unknown>
}

export async function logAdminAction({
  adminUserId,
  adminEmail,
  action,
  targetBrandSlug,
  targetBrandId,
  metadata,
}: LogAdminActionParams): Promise<void> {
  try {
    const supabase = createServiceClient()
    await supabase.from('admin_audit_log').insert({
      admin_user_id: adminUserId,
      admin_email: adminEmail,
      action,
      target_brand_slug: targetBrandSlug ?? null,
      target_brand_id: targetBrandId ?? null,
      metadata: metadata ?? {},
    })
  } catch {
    // Fire-and-forget — don't block the action on logging failure
  }
}

export async function logAdminActionIfAdmin(
  isAdmin: boolean,
  user: { id: string; email: string | null },
  action: AdminAction,
  brandSlug: string,
  brandId: string,
): Promise<void> {
  if (!isAdmin || !user.email) return
  void logAdminAction({
    adminUserId: user.id,
    adminEmail: user.email,
    action,
    targetBrandSlug: brandSlug,
    targetBrandId: brandId,
  })
}
