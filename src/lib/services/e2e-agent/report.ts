import { withNodeSpan } from '@/lib/tracing/span'
import type { PublishInput, PublishResult } from '@/lib/adapters/github/app-publish'
import type { TicketSpec, TicketResult } from '@/lib/adapters/linear/create-ticket'
// Re-export awareness: callers wire postMessage from @/lib/adapters/slack/web-api
import type { FrozenFailure, RepairResult, RunOutcome } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SlackParams = { channel: string; text: string }
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
const ALLOWED_PATHS = ['e2e/']

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

  await deps.postSlackMessage({
    channel: SLACK_CHANNEL,
    text: `E2E self-heal [patched]: PR ${prUrl} for run \`${deps.runId}\``,
  })
}

async function handleNeedsHuman(deps: ReportDeps): Promise<void> {
  // Draft PR if there are changed files
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

  // Linear ticket
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
    label: 'e2e_nightly',
  })

  await deps.postSlackMessage({
    channel: SLACK_CHANNEL,
    text: `E2E self-heal [needs_human]: ${ticket.identifier} — PR ${prUrl} for run \`${deps.runId}\``,
  })
}

async function handleNoise(deps: ReportDeps): Promise<void> {
  await deps.postSlackMessage({
    channel: SLACK_CHANNEL,
    text: `E2E self-heal [noise]: run \`${deps.runId}\` — failures classified as transient, no action taken`,
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
    label: 'e2e_nightly',
  })

  await deps.postSlackMessage({
    channel: SLACK_CHANNEL,
    text: `E2E self-heal [fallback]: ${ticket.identifier} for run \`${deps.runId}\``,
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
  await withNodeSpan(`report:${deps.outcome}`, async () => {
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
  })
}
