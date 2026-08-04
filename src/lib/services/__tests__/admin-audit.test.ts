import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestClient, describeWithDb } from '@/test/setup'
import type { AdminAction } from '../admin-audit'

const ALL_ACTIONS: AdminAction[] = [
  'impersonate_start',
  'impersonate_end',
  'brand_edit',
  'draft_save',
  'draft_publish',
  'draft_discard',
  'curation_job_cancelled',
  'refresh_requested',
  'newsletter_confirmation_resent',
  'newsletter_unsubscribed',
  'channel_removed',
]

const dashboardPagePath = resolve(
  process.cwd(),
  'src/app/[locale]/(site)/(protected)/dashboard/brands/[slug]/(dashboard)/page.tsx',
)

describeWithDb('admin audit log', () => {
  let supabase: ReturnType<typeof createTestClient>
  let adminUserId = ''

  beforeAll(async () => {
    supabase = createTestClient()
    const { data, error } = await supabase.auth.admin.createUser({
      email: `admin-audit-${randomUUID()}@example.com`,
      password: `Admin-audit-${randomUUID()}-password`,
      email_confirm: true,
    })
    if (error || !data.user) throw error ?? new Error('Admin audit user creation failed')
    adminUserId = data.user.id
  })

  afterAll(async () => {
    if (!adminUserId) return
    const { error: deleteLogError } = await supabase
      .from('admin_audit_log')
      .delete()
      .eq('admin_user_id', adminUserId)
    if (deleteLogError) throw deleteLogError

    const { error } = await supabase.auth.admin.deleteUser(adminUserId)
    if (error) throw error
  })

  it('every AdminAction union value is accepted by the database', async () => {
    const { error } = await supabase.from('admin_audit_log').insert(
      ALL_ACTIONS.map((action) => ({
        admin_user_id: adminUserId,
        admin_email: `admin-audit-${adminUserId}@example.com`,
        action,
        metadata: { testRun: adminUserId },
      })),
    )

    expect(error).toBeNull()
  })

})

describe('dashboard brand overview', () => {
  it('owner analytics failure is reported, not silently swallowed', () => {
    const pageSource = readFileSync(dashboardPagePath, 'utf8')

    expect(pageSource).toContain("captureReadFailure('dashboard-brand-overview-analytics')")
    expect(pageSource).not.toContain('catch(() => null)')
  })
})
