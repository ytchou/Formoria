/**
 * E2E nightly agent entry point — Railway service entry.
 *
 * `bootWorker` is awaited BEFORE any `await import('@/lib/services/…')`.
 * `process.exit` in `finally` — 0 on green, 1 on red or crash.
 *
 * On a red run the agent posts a repair request (JSON block + ops-bot
 * mention) into the run's Slack thread; the ops agent fires the Claude
 * routine, which fixes the failures and opens a PR. Mirrors the health
 * agent's repair trigger (src/health-agent/server.ts).
 *
 * Cron schedule is a Railway dashboard setting,
 * documented in railway/e2e-nightly-agent.json.
 */

import { randomUUID } from 'node:crypto'
import { bootWorker, logWorkerBuildInfo } from '@/worker-boot'
import { validateE2eAgentConfig } from '@/e2e-agent/config'

const SLACK_CHANNEL = process.env.SLACK_E2E_CHANNEL ?? 'e2e-alerts'

// ---------------------------------------------------------------------------
// Dynamic imports — populated after bootWorker
// ---------------------------------------------------------------------------

let runE2eSuite: Awaited<
  typeof import('@/e2e-agent/runner')
>['runE2eSuite'] | undefined

let buildRunnerDeps: Awaited<
  typeof import('@/e2e-agent/deps')
>['buildRunnerDeps'] | undefined

let buildE2eRepairRequest: Awaited<
  typeof import('@/lib/services/e2e-agent/repair-request')
>['buildE2eRepairRequest'] | undefined

let buildRepairTriggerMessage: Awaited<
  typeof import('@/lib/services/health-agent/report')
>['buildRepairTriggerMessage'] | undefined

let buildRepairTriggerBlocks: Awaited<
  typeof import('@/lib/services/health-agent/report')
>['buildRepairTriggerBlocks'] | undefined

let postMessage: Awaited<
  typeof import('@/lib/adapters/slack/web-api')
>['postMessage'] | undefined

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main(): Promise<never> {
  logWorkerBuildInfo('e2e-nightly')

  const runId = randomUUID()
  console.log(`[e2e-nightly] run=${runId}`)

  const channel = SLACK_CHANNEL
  const logicalDate = new Date()
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })

  let exitCode = 0
  let startTs: string | undefined

  try {
    if (!runE2eSuite) {
      throw new Error('runE2eSuite not loaded — loadServices incomplete')
    }

    if (!buildRunnerDeps) {
      throw new Error('buildRunnerDeps not loaded — loadServices incomplete')
    }

    if (!postMessage) {
      throw new Error('postMessage not loaded — loadServices incomplete')
    }

    // ---- Start message ----
    try {
      const startResult = await postMessage({
        channel,
        text: `E2E Nightly — ${logicalDate}`,
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: `E2E Nightly — ${logicalDate}`, emoji: true },
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `🔄 *Running...* · \`${runId.slice(0, 8)}\`` },
          },
        ],
      })
      if (startResult.ok) startTs = startResult.ts
      else console.warn('[e2e-nightly] start message failed:', startResult.error)
    } catch (err) {
      console.warn('[e2e-nightly] start message failed:', err)
    }

    const result = await runE2eSuite({
      runId,
      deps: buildRunnerDeps(),
    })

    // ---- Test summary (always, green or red) ----
    try {
      const { stats } = result
      const statusEmoji = result.passed ? '✅' : '❌'
      const parts = [`*${stats.expected} passed*`]
      if (stats.unexpected > 0) parts.push(`*${stats.unexpected} failed*`)
      if (result.unexpectedSkips.length > 0) parts.push(`*${result.unexpectedSkips.length} unexpected skips*`)
      if (stats.flaky > 0) parts.push(`*${stats.flaky} flaky*`)
      if (stats.skipped > 0) parts.push(`${stats.skipped} skipped`)
      const durationSec = Math.round(stats.duration / 1000)
      const durationStr = durationSec >= 60
        ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
        : `${durationSec}s`

      const summaryBlocks: Record<string, unknown>[] = [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${statusEmoji} ${parts.join(' · ')}`,
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Duration: ${durationStr} · SHA: \`${result.stagingSha.slice(0, 7)}\``,
            },
          ],
        },
      ]

      const summaryFailures = [
        ...result.failures,
        ...result.unexpectedSkips.map((s) => ({
          file: s.file,
          title: `${s.title} (unexpected skip)`,
        })),
      ]
      if (summaryFailures.length > 0) {
        const failLines = summaryFailures.slice(0, 5).map(
          (f) => `• \`${f.file}\`: ${f.title}`,
        )
        if (summaryFailures.length > 5) {
          failLines.push(`• _${summaryFailures.length - 5} more_`)
        }
        summaryBlocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: failLines.join('\n') },
        })
      }

      await postMessage({
        channel,
        text: `${statusEmoji} ${parts.join(' · ')} — ${durationStr}`,
        blocks: summaryBlocks,
        threadTs: startTs,
      })
    } catch (err) {
      console.warn('[e2e-nightly] test summary failed:', err)
    }

    if (result.passed) {
      console.log(`[e2e-nightly] run=${runId} outcome=green exit=0`)
    } else {
      exitCode = 1

      if (
        !buildE2eRepairRequest ||
        !buildRepairTriggerMessage ||
        !buildRepairTriggerBlocks
      ) {
        throw new Error('repair builders not loaded — loadServices incomplete')
      }

      const built = buildE2eRepairRequest({
        failures: result.failures,
        unexpectedSkips: result.unexpectedSkips,
        runId,
        stagingSha: result.stagingSha,
      })
      const request = built?.request
      // Required by validateE2eAgentConfig at boot.
      const opsAgentBotId = process.env.OPS_AGENT_SLACK_BOT_ID ?? ''

      if (!built || !request) {
        console.warn(
          `[e2e-nightly] run=${runId} red with no reportable failures — repair request skipped`,
        )
      } else {
        if (built.dropped > 0) {
          console.warn(
            `[e2e-nightly] run=${runId} repair request dropped ${built.dropped} of ${request.findings.length + built.dropped} findings to fit Slack's message limit`,
          )
        }
        try {
          const repairResult = await postMessage({
            channel,
            text: buildRepairTriggerMessage(opsAgentBotId, request, 'E2E Agent'),
            blocks: buildRepairTriggerBlocks(request, 'E2E Agent'),
            threadTs: startTs,
          })
          if (!repairResult.ok) {
            console.warn('[e2e-nightly] repair request failed:', repairResult.error)
          }
        } catch (err) {
          console.warn('[e2e-nightly] repair request failed:', err)
        }
      }

      console.log(
        `[e2e-nightly] run=${runId} outcome=red findings=${request?.findings.length ?? 0} exit=1`,
      )
    }
  } catch (err) {
    console.error('[e2e-nightly] top-level crash:', err)
    exitCode = 1
  } finally {
    process.exit(exitCode)
  }
}

// ---------------------------------------------------------------------------
// Boot — wraps the entire sequence so an unrecoverable boot failure exits 1
// ---------------------------------------------------------------------------

try {
  await bootWorker({
    agent: 'e2e-nightly',
    assertTarget: () => {
      validateE2eAgentConfig()
    },
    async loadServices() {
      ;({ runE2eSuite } = await import('@/e2e-agent/runner'))
      ;({ buildRunnerDeps } = await import('@/e2e-agent/deps'))
      ;({ buildE2eRepairRequest } = await import(
        '@/lib/services/e2e-agent/repair-request'
      ))
      ;({ buildRepairTriggerMessage, buildRepairTriggerBlocks } = await import(
        '@/lib/services/health-agent/report'
      ))
      ;({ postMessage } = await import(
        '@/lib/adapters/slack/web-api'
      ))
    },
  })

  void main()
} catch (err) {
  console.error('[e2e-nightly] unrecoverable boot failure:', err)
  process.exit(1)
}
