/**
 * Health agent entry point — Railway service entry.
 *
 * `bootWorker` is awaited BEFORE any `await import('@/lib/services/…')`.
 * `createServiceClient()` appears ONCE here.
 * `flushLangfuse()` in `finally`, then `process.exit`.
 *
 * Cron schedule (50 20 * * * UTC) is a Railway dashboard setting,
 * documented in railway/health-agent.json.
 */

import { randomUUID } from 'node:crypto'
import { bootWorker, logWorkerBuildInfo } from '@/worker-boot'
import { assertDatabaseTarget } from '@/lib/supabase/project-target'
import { isStagingEnvironment } from '@/lib/deployment-environment'

// ---------------------------------------------------------------------------
// Dynamic imports — populated after bootWorker
// ---------------------------------------------------------------------------

let createServiceClient: Awaited<
  typeof import('@/lib/supabase/service')
>['createServiceClient']

let runHealthAgent: Awaited<
  typeof import('@/lib/services/health-agent/run')
>['runHealthAgent']

let flushLangfuse: Awaited<
  typeof import('@/lib/langfuse/client')
>['flushLangfuse']

let getLangfuse: Awaited<
  typeof import('@/lib/langfuse/client')
>['getLangfuse']

let runWithAuditContext: Awaited<
  typeof import('@/lib/audit/context')
>['runWithAuditContext']

let reportWorkerFailure: Awaited<
  typeof import('@/lib/services/job-alerts')
>['reportWorkerFailure']

let postSlackMessage: Awaited<
  typeof import('@/lib/adapters/slack/web-api')
>['postMessage']

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

await bootWorker({
  agent: 'health-agent',
  assertTarget: () => {
    assertDatabaseTarget(
      isStagingEnvironment() ? 'staging' : 'production',
    )
  },
  async loadServices() {
    ;({ createServiceClient } = await import('@/lib/supabase/service'))
    ;({ runHealthAgent } = await import('@/lib/services/health-agent/run'))
    ;({ flushLangfuse, getLangfuse } = await import('@/lib/langfuse/client'))
    ;({ runWithAuditContext } = await import('@/lib/audit/context'))
    ;({ reportWorkerFailure } = await import('@/lib/services/job-alerts'))
    ;({ postMessage: postSlackMessage } = await import(
      '@/lib/adapters/slack/web-api'
    ))
  },
  async reportFailure(context, error) {
    if (reportWorkerFailure) {
      await reportWorkerFailure(context, error, { agent: 'health-agent' })
    }
  },
})

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<never> {
  logWorkerBuildInfo('health-agent')

  const runId = randomUUID()
  const dryRun = process.argv.includes('--dry-run')

  // Compute the logical date in Asia/Taipei
  const logicalDate = new Date()
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })

  console.log(
    `[health-agent] run=${runId} date=${logicalDate} dryRun=${dryRun}`,
  )

  const client = createServiceClient()
  const langfuse = getLangfuse()
  const langfuseTrace = langfuse?.trace({
    name: 'health-agent',
    id: runId,
    metadata: { logicalDate, dryRun },
  })

  let exitCode = 0

  try {
    const result = await runHealthAgent({
      client: client as unknown as Parameters<typeof runHealthAgent>[0]['client'],
      runId,
      logicalDate,
      workflowAttempt: 1,
      dryRun,
      runWithAuditContext,
      flushLangfuse,
      langfuseTrace,
      slackPostDigest: async (text) => {
        const channel = process.env.HEALTH_AGENT_SLACK_CHANNEL
        if (!channel) return
        await postSlackMessage({ channel, text })
      },
      reportWorkerFailure: async (context, error) => {
        if (reportWorkerFailure) {
          await reportWorkerFailure(context, error, { agent: 'health-agent' })
        }
      },
    })

    exitCode = result.exitCode
    console.log(
      `[health-agent] status=${result.status} findings=${result.totalFindings} exit=${exitCode}`,
    )
  } catch (err) {
    console.error('[health-agent] top-level crash:', err)
    exitCode = 1

    if (reportWorkerFailure) {
      await reportWorkerFailure('health-agent-crash', err, {
        agent: 'health-agent',
      }).catch(() => {})
    }
  } finally {
    try { await flushLangfuse() } catch { /* flush failure must not mask exit */ }
    process.exit(exitCode)
  }
}

void main()
