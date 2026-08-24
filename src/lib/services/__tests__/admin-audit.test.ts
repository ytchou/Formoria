import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  logAdminAction,
  type AdminAction,
  type LogAdminActionDeps,
} from '../admin-audit'
import { runWithAuditContext } from '@/lib/audit'

const ALL_ACTIONS = [
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

/**
 * The union is a TypeScript claim; the CHECK constraint is the database's. A
 * new member with no migration behind it raises 23514 at runtime — and
 * `logAdminAction` is fire-and-forget, so the insert is refused into a `catch
 * {}` and the action simply goes unrecorded. Neither tsc nor ESLint sees it:
 * the service client is created without the <Database> generic.
 *
 * Parsing the committed migration is the WHOLE guard: nothing else compares
 * the union to the constraint. It needs no credentials, so it runs on every
 * machine and in CI — but it constrains the migration text, not the deployed
 * database. A constraint hand-patched in the cloud and never written down here
 * is out of its reach.
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

  // Writers deleted, values retained: `adminRemoveChannel` went with DEV-1513
  // and the impersonation actions with DEV-1570, but historical rows carry
  // every value — dropping one would make the table fail its own check.
  it.each(['channel_removed', 'impersonate_start', 'impersonate_end'])(
    'keeps retired action %s whose rows still exist',
    (action) => {
      expect(acceptedActions.has(action)).toBe(true)
    },
  )
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
