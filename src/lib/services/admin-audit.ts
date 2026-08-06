import { getAuditContext } from '@/lib/audit'
import { createServiceClient } from '@/lib/supabase/service'

export type AdminAction =
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
  | 'channel_removed'

export type LogAdminActionParams = {
  adminUserId: string
  adminEmail: string
  action: AdminAction
  targetBrandSlug?: string
  targetBrandId?: string
  metadata?: Record<string, unknown>
}

type AdminAuditClient = {
  from: (table: string) => {
    insert: (values: Record<string, unknown>) =>
      PromiseLike<{ error: unknown }>
  }
}

export type LogAdminActionDeps = {
  client?: AdminAuditClient
}

function isMissingCorrelationIdColumn(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const source = error as { code?: unknown; message?: unknown }
  const message = typeof source.message === 'string' ? source.message : ''
  return (
    source.code === '42703' &&
    message.includes('correlation_id') &&
    /(missing|does not exist|doesn't exist)/i.test(message)
  )
}

export async function logAdminAction({
  adminUserId,
  adminEmail,
  action,
  targetBrandSlug,
  targetBrandId,
  metadata,
}: LogAdminActionParams, deps: LogAdminActionDeps = {}): Promise<void> {
  try {
    const client =
      deps.client ?? (createServiceClient() as unknown as AdminAuditClient)
    const correlationId = getAuditContext().correlationId
    const baseValues = {
      admin_user_id: adminUserId,
      admin_email: adminEmail,
      action,
      target_brand_slug: targetBrandSlug ?? null,
      target_brand_id: targetBrandId ?? null,
      metadata: metadata ?? {},
    }
    const values = {
      ...baseValues,
      ...(correlationId ? { correlation_id: correlationId } : {}),
    }
    const { error } = await client.from('admin_audit_log').insert(values)
    if (correlationId && isMissingCorrelationIdColumn(error)) {
      // Fallback exists because Railway deployment is not atomic with the migration; delete it once the migration is applied everywhere.
      await client.from('admin_audit_log').insert(baseValues)
    }
  } catch {
    // Fire-and-forget - do not block the action on logging failure.
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
