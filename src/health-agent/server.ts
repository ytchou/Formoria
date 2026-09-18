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
import type { RepairRequest } from '@/lib/services/health-agent/repair-request'

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

let createTicket: Awaited<
  typeof import('@/lib/adapters/linear/create-ticket')
>['createTicket']

let createRepoWorkerClient: Awaited<
  typeof import('@/lib/services/health-agent/repo-worker-client')
>['createRepoWorkerClient']

let buildRepairTriggerMessage: Awaited<
  typeof import('@/lib/services/health-agent/report')
>['buildRepairTriggerMessage']

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
    ;({ createTicket } = await import('@/lib/adapters/linear/create-ticket'))
    ;({ createRepoWorkerClient } = await import(
      '@/lib/services/health-agent/repo-worker-client'
    ))
    ;({ buildRepairTriggerMessage } = await import(
      '@/lib/services/health-agent/report'
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

  // ---- Conditionally create worker client ----
  const workerUrl = process.env.REPO_WORKER_URL
  const workerToken = process.env.REPO_WORKER_TOKEN
  const workerClient = workerUrl
    ? createRepoWorkerClient({
        baseUrl: workerUrl,
        token: workerToken,
        getCloneToken: async () => {
          // Ceiling: replace with GitHub App installation token when
          // the GitHub App adapter is wired (githubApp dep).
          const token = process.env.GITHUB_TOKEN
          if (!token) throw new Error('GITHUB_TOKEN is required for clone')
          return token
        },
      })
    : undefined

  // ---- Conditionally create Linear ticket adapter ----
  const linearCreateTicket = process.env.LINEAR_API_KEY
    ? async (spec: { title: string; body: string; label: string }) => {
        const result = await createTicket(spec)
        return result
      }
    : undefined

  // ---- Conditionally create repair trigger ----
  const opsAgentBotId = process.env.OPS_AGENT_SLACK_BOT_ID
  const repairChannel = process.env.HEALTH_AGENT_SLACK_CHANNEL
  const triggerRepair =
    opsAgentBotId && repairChannel
      ? async (request: RepairRequest) => {
          const message = buildRepairTriggerMessage(opsAgentBotId, request)
          await postSlackMessage({ channel: repairChannel, text: message })
        }
      : undefined

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
      workerClient,
      linearCreateTicket,
      triggerRepair,
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
