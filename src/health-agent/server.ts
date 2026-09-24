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

let postMessage: Awaited<
  typeof import('@/lib/adapters/slack/web-api')
>['postMessage']

let updateMessage: Awaited<
  typeof import('@/lib/adapters/slack/web-api')
>['updateMessage']

let createTicket: Awaited<
  typeof import('@/lib/adapters/linear/create-ticket')
>['createTicket']

let createRepoWorkerClient: Awaited<
  typeof import('@/lib/services/health-agent/repo-worker-client')
>['createRepoWorkerClient']

let getInstallationToken: Awaited<
  typeof import('@/lib/adapters/github/app-auth')
>['getInstallationToken']

let buildRepairTriggerMessage: Awaited<
  typeof import('@/lib/services/health-agent/report')
>['buildRepairTriggerMessage']

let buildRepairTriggerBlocks: Awaited<
  typeof import('@/lib/services/health-agent/report')
>['buildRepairTriggerBlocks']

let buildRunStartBlocks: Awaited<
  typeof import('@/lib/services/health-agent/report')
>['buildRunStartBlocks']

let buildRunStatusLine: Awaited<
  typeof import('@/lib/services/health-agent/report')
>['buildRunStatusLine']

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
    ;({ postMessage, updateMessage } = await import(
      '@/lib/adapters/slack/web-api'
    ))
    ;({ createTicket } = await import('@/lib/adapters/linear/create-ticket'))
    ;({ createRepoWorkerClient } = await import(
      '@/lib/services/health-agent/repo-worker-client'
    ))
    ;({ getInstallationToken } = await import(
      '@/lib/adapters/github/app-auth'
    ))
    ;({
      buildRepairTriggerMessage,
      buildRepairTriggerBlocks,
      buildRunStartBlocks,
      buildRunStatusLine,
    } = await import(
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
    ? createRepoWorkerClient(
        {
          baseUrl: workerUrl,
          token: workerToken,
          getCloneToken: () => getInstallationToken('clone'),
        },
        {
          deadlineMs: 600_000,
          pollIntervalMs: 5_000,
        },
      )
    : undefined

  // ---- Conditionally create Linear ticket adapter ----
  const linearCreateTicket = process.env.LINEAR_API_KEY
    ? createTicket
    : undefined

  // ---- Conditionally create repair trigger ----
  const opsAgentBotId = process.env.OPS_AGENT_SLACK_BOT_ID
  const repairChannel = process.env.HEALTH_AGENT_SLACK_CHANNEL
  const triggerRepair =
    opsAgentBotId && repairChannel
      ? async (request: RepairRequest, threadTs?: string) => {
          const blocks = buildRepairTriggerBlocks(request, 'Health Agent')
          const fallback = buildRepairTriggerMessage(opsAgentBotId, request, 'Health agent')
          await postMessage({
            channel: repairChannel,
            text: fallback,
            blocks,
            threadTs,
          })
        }
      : undefined

  // ---- Warn once if Slack is unconfigured ----
  if (!process.env.HEALTH_AGENT_SLACK_CHANNEL) {
    console.warn('[health-agent] HEALTH_AGENT_SLACK_CHANNEL not set — Slack messages disabled')
  }

  let exitCode = 0
  let runResult: Awaited<ReturnType<typeof runHealthAgent>> | undefined
  let startRef: { channel: string; ts: string } | undefined

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
      slackPostRunStart: async (date, startRunId) => {
        const channel = process.env.HEALTH_AGENT_SLACK_CHANNEL
        if (!channel) return undefined
        const result = await postMessage({
          channel,
          text: `Health Agent — ${date}`,
          blocks: buildRunStartBlocks(
            date,
            `🔄 *Running...* · \`${startRunId.slice(0, 8)}\``,
          ),
        })
        if (!result.ok) return undefined
        startRef = { channel, ts: result.ts }
        return result.ts
      },
      slackPostDigest: async ({ text, blocks }, digestThreadTs) => {
        const channel = process.env.HEALTH_AGENT_SLACK_CHANNEL
        if (!channel) return
        await postMessage({ channel, text, blocks, threadTs: digestThreadTs })
      },
      reportWorkerFailure: async (context, error) => {
        if (reportWorkerFailure) {
          await reportWorkerFailure(context, error, { agent: 'health-agent' })
        }
      },
    })

    runResult = result
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
    if (startRef) {
      try {
        const res = await updateMessage({
          channel: startRef.channel,
          ts: startRef.ts,
          text: `Health Agent — ${logicalDate}`,
          blocks: buildRunStartBlocks(logicalDate, buildRunStatusLine(runResult, runId)),
        })
        if (!res.ok) console.warn('[health-agent] start message update failed:', res.error)
      } catch (err) {
        console.warn('[health-agent] start message update failed:', err)
      }
    }
    try { await flushLangfuse() } catch { /* flush failure must not mask exit */ }
    process.exit(exitCode)
  }
}

void main()
