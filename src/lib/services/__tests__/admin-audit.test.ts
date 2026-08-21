import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestClient, describeWithDb } from '@/test/setup'
import {
  logAdminAction,
  type AdminAction,
  type LogAdminActionDeps,
} from '../admin-audit'
import { runWithAuditContext } from '@/lib/audit'

const ALL_ACTIONS = [
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
  'curated_product_promoted',
  'curated_product_retired',
  'curated_product_source_retired',
  'curated_product_selection_placed',
  'curated_product_selection_retired',
  'stockist_approved',
  'stockist_rejected',
] as const satisfies readonly AdminAction[]

type MissingAdminAction = Exclude<AdminAction, (typeof ALL_ACTIONS)[number]>
const allAdminActionsAreListed: MissingAdminAction extends never ? true : never = true
void allAdminActionsAreListed

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

/**
 * The union is a TypeScript claim; the CHECK constraint is the database's. A
 * new member with no migration behind it raises 23514 at runtime — and
 * `logAdminAction` is fire-and-forget, so the insert is refused into a `catch
 * {}` and the action simply goes unrecorded. Neither tsc nor ESLint sees it:
 * the service client is created without the <Database> generic.
 *
 * `admin audit log` above asserts the same thing against a real database, but
 * only when credentials are present. This half needs none, so it runs on every
 * machine and in CI.
 */
describe('admin_audit_log action CHECK constraint', () => {
  const migrationsDirectory = resolve(process.cwd(), 'supabase/migrations')
  const constraintPattern =
    /admin_audit_log_action_check check \(action in \(([\s\S]*?)\)\)/

  /** The last migration that redefines the constraint wins; it drops the prior one. */
  const latestConstraint = readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => ({
      file,
      match: readFileSync(join(migrationsDirectory, file), 'utf8').match(
        constraintPattern,
      ),
    }))
    .filter((entry) => entry.match !== null)
    .at(-1)

  const acceptedActions = new Set(
    [...(latestConstraint?.match?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map(
      (match) => match[1],
    ),
  )

  it.each([...ALL_ACTIONS])('%s is accepted by the constraint', (action) => {
    expect(acceptedActions.has(action)).toBe(true)
  })

  // Its writer (`adminRemoveChannel`) was deleted by DEV-1513, but historical
  // rows carry the value: dropping it would make the table fail its own check.
  it('keeps a retired action whose rows still exist', () => {
    expect(acceptedActions.has('channel_removed')).toBe(true)
  })
})

describe('dashboard brand overview', () => {
  it('owner analytics failure is reported, not silently swallowed', () => {
    const pageSource = readFileSync(dashboardPagePath, 'utf8')

    expect(pageSource).toContain("captureReadFailure('dashboard-brand-overview-analytics')")
    expect(pageSource).not.toContain('catch(() => null)')
  })
})

describe('admin audit correlation', () => {
  it('admin actions record a correlation id when one is in scope', async () => {
    const correlationId = '22222222-2222-4222-8222-222222222222'
    const inserts: Array<Record<string, unknown>> = []
    const deps: LogAdminActionDeps = {
      client: {
        from: () => ({
          insert: async (values: Record<string, unknown>) => {
            inserts.push(values)
            return { error: null }
          },
        }),
      },
    }

    await runWithAuditContext({ correlationId }, () =>
      logAdminAction(
        {
          adminUserId: '33333333-3333-4333-8333-333333333333',
          adminEmail: 'admin-audit@example.com',
          action: 'brand_edit',
          targetBrandSlug: 'example-brand',
          targetBrandId: '44444444-4444-4444-8444-444444444444',
        },
        deps,
      ),
    )

    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({ correlation_id: correlationId })
  })

  it('admin actions still succeed with no correlation in scope', async () => {
    const inserts: Array<Record<string, unknown>> = []
    const deps: LogAdminActionDeps = {
      client: {
        from: () => ({
          insert: async (values: Record<string, unknown>) => {
            inserts.push(values)
            return { error: null }
          },
        }),
      },
    }

    await logAdminAction(
      {
        adminUserId: '55555555-5555-4555-8555-555555555555',
        adminEmail: 'admin-audit@example.com',
        action: 'draft_save',
        targetBrandSlug: 'example-brand',
        targetBrandId: '66666666-6666-4666-8666-666666666666',
      },
      deps,
    )

    expect(inserts).toHaveLength(1)
    expect(inserts[0]).not.toHaveProperty('correlation_id')
  })

  it('does not retry an unrelated undefined-column error', async () => {
    const inserts: Array<Record<string, unknown>> = []
    const deps: LogAdminActionDeps = {
      client: {
        from: () => ({
          insert: async (values: Record<string, unknown>) => {
            inserts.push(values)
            return {
              error: {
                code: '42703',
                message: 'column admin_audit_log.unrelated_field does not exist',
              },
            }
          },
        }),
      },
    }

    await runWithAuditContext({ correlationId: '77777777-7777-4777-8777-777777777777' }, () =>
      logAdminAction(
        {
          adminUserId: '88888888-8888-4888-8888-888888888888',
          adminEmail: 'admin-correlation@example.com',
          action: 'brand_edit',
        },
        deps,
      ),
    )

    expect(inserts).toHaveLength(1)
  })
})
