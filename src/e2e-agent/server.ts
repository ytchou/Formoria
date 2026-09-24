/**
 * E2E nightly agent entry point — Railway service entry.
 *
 * `bootWorker` is awaited BEFORE any `await import('@/lib/services/…')`.
 * `process.exit` in `finally` — 0 on green, 1 on red, errored, or crash.
 *
 * On a red run the agent posts a repair request (JSON block + ops-bot
 * mention) into the run's Slack thread; the ops agent fires the Claude
 * routine, which fixes the failures and opens a PR. Mirrors the health
 * agent's repair trigger (src/health-agent/server.ts).
 *
 * An errored run (Playwright timed out, its JSON report is missing or
 * unparseable, it reported no tests, or it exited nonzero with no test
 * failures) posts one warning with the output tail and sends no repair
 * request — there are no known failures for a routine to fix.
 *
 * Dispatch routing (DEV-1854): at boot the agent claims the oldest pending
 * ops-bot dispatch from production (src/lib/adapters/ops-dispatch/client.ts).
 * Claimed → every message is a reply in the requester's Slack thread, plus one
 * audit pointer line in SLACK_E2E_CHANNEL. No dispatch (cron run, endpoint
 * unreachable, unconfigured) → everything posts to SLACK_E2E_CHANNEL threaded
 * under the start message, as before. A post that fails in the requester
 * thread falls back to SLACK_E2E_CHANNEL for that message. At the end the
 * start message (and pointer) are updated to ✅/❌/⚠️, and a claimed dispatch
 * is reported complete before process.exit.
 *
 * Cron schedule is a Railway dashboard setting,
 * documented in railway/e2e-nightly-agent.json.
 * Manual runs: ops-bot dispatch_workflow → deploymentInstanceExecutionCreate (src/lib/adapters/railway/api.ts).
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

let updateMessage: Awaited<
  typeof import('@/lib/adapters/slack/web-api')
>['updateMessage'] | undefined

let opsDispatch: typeof import('@/lib/adapters/ops-dispatch/client') | undefined

type ClaimedDispatch = import('@/lib/adapters/ops-dispatch/client').ClaimedDispatch
type RunOutcome = import('@/lib/adapters/ops-dispatch/client').DispatchOutcome
type SlackMessage = { text: string; blocks?: Record<string, unknown>[] }
type PostedRef = { channel: string; ts: string }
type PostOutcome = ({ ok: true } & PostedRef) | { ok: false; error: string }

const FINAL_LINE: Record<RunOutcome, string> = {
  green: '✅ *Passed*',
  red: '❌ *Failed*',
  errored: '⚠️ *Errored*',
  crashed: '⚠️ *Crashed*',
}

function threadLink(dispatch: ClaimedDispatch): string {
  // Workspace-agnostic Slack deep link; Slack redirects it to the thread.
  return `https://slack.com/archives/${dispatch.channelId}/p${dispatch.threadTs.replace('.', '')}`
}

function pointerText(runId: string, dispatch: ClaimedDispatch, final?: string): string {
  const requester = dispatch.requesterId ? ` by <@${dispatch.requesterId}>` : ''
  const line = `E2E run \`${runId.slice(0, 8)}\` requested${requester} → <${threadLink(dispatch)}|thread>`
  return final ? `${final} · ${line}` : line
}

function startBlocks(title: string, statusLine: string): Record<string, unknown>[] {
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: title, emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: statusLine },
    },
  ]
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main(): Promise<void> {
  logWorkerBuildInfo('e2e-nightly')

  const runId = randomUUID()
  console.log(`[e2e-nightly] run=${runId}`)

  const logicalDate = new Date()
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
  const title = `E2E Nightly — ${logicalDate}`

  let exitCode = 0
  let outcome: RunOutcome = 'crashed'
  let claimed: ClaimedDispatch | null = null
  let pointerTs: string | undefined
  let startRef: PostedRef | undefined
  // Where run messages go: the requester thread when claimed, else the
  // alerts channel threaded under the start message.
  let target: { channel: string; threadTs: string | undefined } = {
    channel: SLACK_CHANNEL,
    threadTs: undefined,
  }

  // Posts one run message to `target`. In claimed mode, an ok:false (or a
  // throw) falls back to SLACK_CHANNEL under the pointer for that message only.
  // Never throws.
  const postToRun = async (message: SlackMessage): Promise<PostOutcome> => {
    const send = async (channel: string, threadTs: string | undefined): Promise<PostOutcome> => {
      if (!postMessage) return { ok: false, error: 'postMessage not loaded' }
      try {
        const res = await postMessage({ channel, threadTs, ...message })
        return res.ok ? { ok: true, channel, ts: res.ts } : { ok: false, error: res.error }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
    const primary = await send(target.channel, target.threadTs)
    if (primary.ok || !claimed) return primary
    console.warn(
      `[e2e-nightly] post to requester thread failed (${primary.error}) — falling back to ${SLACK_CHANNEL}`,
    )
    return send(SLACK_CHANNEL, pointerTs)
  }

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

    // ---- Claim a pending dispatch (before the start message) ----
    if (opsDispatch) {
      const claim = await opsDispatch.claimDispatch(runId)
      claimed = claim.dispatch
      console.log(
        claimed
          ? `[e2e-nightly] run=${runId} claimed dispatch=${claimed.id}`
          : `[e2e-nightly] run=${runId} no dispatch (${claim.reason ?? 'none pending'}) — cron mode`,
      )
    }

    if (claimed) {
      target = { channel: claimed.channelId, threadTs: claimed.threadTs }

      // ---- Audit pointer in the alerts channel ----
      try {
        const pointerResult = await postMessage({
          channel: SLACK_CHANNEL,
          text: pointerText(runId, claimed),
        })
        if (pointerResult.ok) pointerTs = pointerResult.ts
        else console.warn('[e2e-nightly] audit pointer failed:', pointerResult.error)
      } catch (err) {
        console.warn('[e2e-nightly] audit pointer failed:', err)
      }
    }

    // ---- Start message ----
    const startResult = await postToRun({
      text: title,
      blocks: startBlocks(title, `🔄 *Running...* · \`${runId.slice(0, 8)}\``),
    })
    if (startResult.ok) startRef = { channel: startResult.channel, ts: startResult.ts }
    else console.warn('[e2e-nightly] start message failed:', startResult.error)

    // Claimed: reply in the requester thread. Cron: thread under the start message.
    target = { channel: target.channel, threadTs: target.threadTs ?? startRef?.ts }

    const result = await runE2eSuite({
      runId,
      deps: buildRunnerDeps(),
    })
    outcome = result.outcome

    // ---- Errored run: one warning, no summary, no repair request ----
    if (result.outcome === 'errored') {
      exitCode = 1
      const erroredText = `⚠️ E2E run errored: ${result.erroredReason}`
      try {
        const erroredBlocks: Record<string, unknown>[] = [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: erroredText },
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `SHA: \`${result.stagingSha.slice(0, 7)}\` · No repair request sent — no test results to repair.`,
              },
            ],
          },
        ]
        if (result.outputTail) {
          // Neutralize ``` so the tail cannot close the code fence early.
          const safeTail = result.outputTail.replace(/```/g, "'''")
          erroredBlocks.push({
            type: 'section',
            text: { type: 'mrkdwn', text: '```\n' + safeTail + '\n```' },
          })
        }
        const erroredResult = await postToRun({ text: erroredText, blocks: erroredBlocks })
        if (!erroredResult.ok) {
          console.warn('[e2e-nightly] errored message failed:', erroredResult.error)
        }
      } catch (err) {
        console.warn('[e2e-nightly] errored message failed:', err)
      }
      console.log(`[e2e-nightly] run=${runId} outcome=errored exit=1`)
      // `finally` still runs and exits with exitCode.
      return
    }

    // ---- Test summary (always, green or red) ----
    try {
      const { stats } = result
      const statusEmoji = result.outcome === 'green' ? '✅' : '❌'
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

      const summaryResult = await postToRun({
        text: `${statusEmoji} ${parts.join(' · ')} — ${durationStr}`,
        blocks: summaryBlocks,
      })
      if (!summaryResult.ok) {
        console.warn('[e2e-nightly] test summary failed:', summaryResult.error)
      }
    } catch (err) {
      console.warn('[e2e-nightly] test summary failed:', err)
    }

    if (result.outcome === 'green') {
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
          const repairResult = await postToRun({
            text: buildRepairTriggerMessage(opsAgentBotId, request, 'E2E Agent'),
            blocks: buildRepairTriggerBlocks(request, 'E2E Agent'),
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
    outcome = 'crashed'
  } finally {
    await finalizeRun({ runId, title, outcome, claimed, startRef, pointerTs })
    process.exit(exitCode)
  }
}

/**
 * Final-state updates and dispatch completion. Every step is independent and
 * swallows its own failure, so `process.exit` always runs afterwards.
 */
async function finalizeRun(params: {
  runId: string
  title: string
  outcome: RunOutcome
  claimed: ClaimedDispatch | null
  startRef: PostedRef | undefined
  pointerTs: string | undefined
}): Promise<void> {
  const { runId, title, outcome, claimed, startRef, pointerTs } = params
  const finalLine = FINAL_LINE[outcome]

  if (updateMessage && startRef) {
    try {
      const res = await updateMessage({
        channel: startRef.channel,
        ts: startRef.ts,
        text: `${finalLine} · ${title}`,
        blocks: startBlocks(title, `${finalLine} · \`${runId.slice(0, 8)}\``),
      })
      if (!res.ok) console.warn('[e2e-nightly] start message update failed:', res.error)
    } catch (err) {
      console.warn('[e2e-nightly] start message update failed:', err)
    }
  }

  if (claimed && updateMessage && pointerTs) {
    try {
      const res = await updateMessage({
        channel: SLACK_CHANNEL,
        ts: pointerTs,
        text: pointerText(runId, claimed, finalLine),
      })
      if (!res.ok) console.warn('[e2e-nightly] audit pointer update failed:', res.error)
    } catch (err) {
      console.warn('[e2e-nightly] audit pointer update failed:', err)
    }
  }

  if (claimed && opsDispatch) {
    // completeDispatch never throws; the production lease expires if it fails.
    await opsDispatch.completeDispatch({ dispatchId: claimed.id, runId, outcome })
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
      ;({ postMessage, updateMessage } = await import(
        '@/lib/adapters/slack/web-api'
      ))
      opsDispatch = await import('@/lib/adapters/ops-dispatch/client')
    },
  })

  void main()
} catch (err) {
  console.error('[e2e-nightly] unrecoverable boot failure:', err)
  process.exit(1)
}
