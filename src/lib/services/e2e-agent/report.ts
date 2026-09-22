import type { PublishInput, PublishResult } from '@/lib/adapters/github/app-publish'
import type { TicketSpec, TicketResult } from '@/lib/adapters/linear/create-ticket'
// Re-export awareness: callers wire postMessage from @/lib/adapters/slack/web-api
import type { FrozenFailure, RepairResult, RunOutcome } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SlackBlock = Record<string, unknown>
type SlackParams = { channel: string; text: string; blocks?: SlackBlock[] }
type SlackResult = { ok: boolean; ts?: string; error?: string }

export type ReportDeps = {
  publish: (input: PublishInput) => Promise<PublishResult>
  createTicket: (spec: TicketSpec) => Promise<TicketResult>
  postSlackMessage: (params: SlackParams) => Promise<SlackResult>
  outcome: RunOutcome
  repair?: RepairResult
  frozenFailures: FrozenFailure[]
  runId: string
  stagingSha: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SLACK_CHANNEL = process.env.SLACK_E2E_CHANNEL ?? 'e2e-alerts'
const ALLOWED_PATHS = ['e2e/', 'src/']

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function failureSummary(failures: FrozenFailure[]): string {
  return failures
    .map((f) => `- ${f.file}: ${f.title}`)
    .join('\n')
}

function buildPrTitle(runId: string): string {
  return `fix(e2e): self-heal ${runId}`
}

function buildPrBody(deps: ReportDeps): string {
  return [
    `## E2E Self-Heal (${deps.outcome})`,
    '',
    `**Run:** \`${deps.runId}\``,
    `**Staging SHA:** \`${deps.stagingSha}\``,
    '',
    '### Failures addressed',
    '',
    failureSummary(deps.frozenFailures),
  ].join('\n')
}

function contextBlock(deps: ReportDeps): SlackBlock {
  return {
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Run: \`${deps.runId.slice(0, 8)}\` · SHA: \`${deps.stagingSha.slice(0, 7)}\``,
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Outcome handlers
// ---------------------------------------------------------------------------

async function handlePatched(deps: ReportDeps): Promise<void> {
  const repair = deps.repair!
  const input: PublishInput = {
    baseSha: repair.baseSha,
    files: repair.changedFiles,
    branch: repair.branch,
    title: buildPrTitle(deps.runId),
    body: buildPrBody(deps),
    labels: ['e2e-selfheal'],
    allowedPaths: ALLOWED_PATHS,
  }

  const result = await deps.publish(input)
  const prUrl = result.ok && 'prUrl' in result ? result.prUrl : '(unknown)'
  const fallback = `E2E self-heal [patched]: PR ${prUrl} for run \`${deps.runId}\``

  await deps.postSlackMessage({
    channel: SLACK_CHANNEL,
    text: fallback,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: 'E2E Self-Heal: Patched', emoji: true },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✅ *${deps.frozenFailures.length} failure${deps.frozenFailures.length === 1 ? '' : 's'} fixed* · <${prUrl}|PR>`,
        },
      },
      contextBlock(deps),
    ],
  })
}

async function handleNeedsHuman(deps: ReportDeps): Promise<void> {
  let prUrl = '(no PR)'
  if (deps.repair?.changedFiles.length) {
    const input: PublishInput = {
      baseSha: deps.repair.baseSha,
      files: deps.repair.changedFiles,
      branch: deps.repair.branch,
      title: `draft: ${buildPrTitle(deps.runId)}`,
      body: buildPrBody(deps),
      labels: ['e2e-selfheal', 'needs-human'],
      allowedPaths: ALLOWED_PATHS,
    }
    const result = await deps.publish(input)
    prUrl = result.ok && 'prUrl' in result ? result.prUrl : '(failed)'
  }

  const ticket = await deps.createTicket({
    title: `E2E nightly needs human: ${deps.runId}`,
    body: [
      `Run \`${deps.runId}\` could not be fully auto-healed.`,
      '',
      '### Failures',
      failureSummary(deps.frozenFailures),
      '',
      `PR: ${prUrl}`,
    ].join('\n'),
    label: '5bb8cb23-6463-436b-befc-0463806d13b6',
  })

  const fallback = `E2E self-heal [needs_human]: ${ticket.identifier} — PR ${prUrl} for run \`${deps.runId}\``

  await deps.postSlackMessage({
    channel: SLACK_CHANNEL,
    text: fallback,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: 'E2E Self-Heal: Needs Human', emoji: true },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🔧 *${ticket.identifier}* · <${prUrl}|Draft PR>`,
        },
      },
      contextBlock(deps),
    ],
  })
}

async function handleNoise(deps: ReportDeps): Promise<void> {
  const fallback = `E2E self-heal [noise]: run \`${deps.runId}\` — failures classified as transient, no action taken`

  await deps.postSlackMessage({
    channel: SLACK_CHANNEL,
    text: fallback,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: 'E2E Self-Heal: Noise', emoji: true },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '🔇 Failures classified as transient — no action taken',
        },
      },
      contextBlock(deps),
    ],
  })
}

async function handleFallback(deps: ReportDeps): Promise<void> {
  const ticket = await deps.createTicket({
    title: `E2E nightly fallback: ${deps.runId}`,
    body: [
      `Run \`${deps.runId}\` ended in fallback — self-heal could not proceed.`,
      '',
      '### Failures',
      failureSummary(deps.frozenFailures),
    ].join('\n'),
    label: '5bb8cb23-6463-436b-befc-0463806d13b6',
  })

  const fallback = `E2E self-heal [fallback]: ${ticket.identifier} for run \`${deps.runId}\``

  await deps.postSlackMessage({
    channel: SLACK_CHANNEL,
    text: fallback,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: 'E2E Self-Heal: Fallback', emoji: true },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `📋 *${ticket.identifier}* — self-heal could not proceed`,
        },
      },
      contextBlock(deps),
    ],
  })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Report the run outcome by creating PRs, tickets, and Slack notifications
 * as appropriate for the outcome type.
 */
export async function reportOutcome(deps: ReportDeps): Promise<void> {
  switch (deps.outcome) {
    case 'patched':
      return handlePatched(deps)
    case 'needs_human':
      return handleNeedsHuman(deps)
    case 'noise':
      return handleNoise(deps)
    case 'fallback':
      return handleFallback(deps)
    case 'green':
      // No reporting needed for green runs
      return
  }
}
