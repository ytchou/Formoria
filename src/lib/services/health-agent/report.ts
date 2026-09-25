/**
 * Reporting — one Linear ticket per finding and the Slack digest.
 *
 * Linear GraphQL shape follows `scripts/health-agent/adapters.ts` lines 883-1100.
 * Slack rendering reuses `src/lib/adapters/slack/notification`.
 *
 * Both Linear and Slack calls must be wrapped in `auditedCall` when called
 * from the actual run (the report builder functions here are pure; the
 * caller in `run.ts` wraps the outbound calls).
 */

import type { HealthFinding } from './contracts'
import type { DetectorResult } from './types'
import type { RepairRequest } from './repair-request'
import type { RunHealthAgentResult } from './run'
import type { RunEvent } from '@/lib/services/run-timeline/types'

// ---------------------------------------------------------------------------
// Label resolution
// ---------------------------------------------------------------------------

/**
 * Determine the Linear label for a finding's source.
 * - `sentry` and `credential` → Ops (operational issues)
 * - Everything else → Data Quality
 *
 * Matches `scripts/health-agent/adapters.ts` linearLabelName, extended for
 * the new sources.
 */
export function linearLabelForSource(
  source: string,
): 'Data Quality' | 'Ops' {
  if (source === 'sentry' || source === 'credential') return 'Ops'
  return 'Data Quality'
}

// ---------------------------------------------------------------------------
// Ticket builder
// ---------------------------------------------------------------------------

export type TicketSpec = {
  title: string
  body: string
  labels: Array<'Data Quality' | 'Ops'>
  fingerprints: string[]
}

export type FindingTicketOptions = {
  /** Langfuse trace URL for the run. */
  traceUrl: string
  /** Run date (YYYY-MM-DD, Asia/Taipei). */
  date: string
  /** Investigator diagnosis for this finding, if available. */
  investigation?: string
}

/**
 * Whether the health agent may file a ticket for this finding.
 *
 * Runtime Sentry issues are signal-only. Credential findings, including
 * sentry-capture failures, remain eligible for operational tickets.
 */
export function isTicketEligible(
  finding: HealthFinding,
  alreadyTicketed: ReadonlySet<string>,
): boolean {
  return (
    finding.source !== 'sentry' && !alreadyTicketed.has(finding.fingerprint)
  )
}

function findingTicketBody(
  finding: HealthFinding,
  options: FindingTicketOptions,
): string {
  const lines: string[] = []
  lines.push(`# ${finding.title}`)
  lines.push('')
  lines.push(`- **Source:** ${finding.source}`)
  lines.push(`- **Severity:** ${finding.severity}`)
  lines.push(`- **Fingerprint:** \`${finding.fingerprint}\``)
  lines.push(`- **Run date:** ${options.date}`)

  if (Object.keys(finding.evidence).length > 0) {
    lines.push('')
    lines.push('**Evidence:**')
    lines.push('```json')
    lines.push(JSON.stringify(finding.evidence, null, 2))
    lines.push('```')
  }

  if (options.investigation) {
    lines.push('')
    lines.push('**Investigator diagnosis:**')
    lines.push(options.investigation)
  }

  lines.push('')
  lines.push(`[Langfuse trace](${options.traceUrl})`)
  return lines.join('\n')
}

/** Build the Linear ticket for one finding. */
export function buildFindingTicket(
  finding: HealthFinding,
  options: FindingTicketOptions,
): TicketSpec {
  return {
    title: `Health Agent — ${finding.title}`,
    body: findingTicketBody(finding, options),
    labels: [linearLabelForSource(finding.source)],
    fingerprints: [finding.fingerprint],
  }
}

// ---------------------------------------------------------------------------
// Digest builder
// ---------------------------------------------------------------------------

export type BuildDigestOptions = {
  /** Run date (YYYY-MM-DD, Asia/Taipei). */
  date: string
  /** Langfuse trace URL. */
  traceUrl: string
  /** Sentry fingerprints that were not active before this run. */
  highlightedFingerprints?: ReadonlySet<string>
  /** Run id, shown in the context line. */
  runId?: string
}

const SENTRY_DIGEST_LIMIT = 10
const SEVERITY_PRIORITY = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
} as const

function numericEvidence(
  finding: HealthFinding,
  key: string,
): number {
  const value = finding.evidence[key]
  return typeof value === 'number' ? value : 0
}

function stringEvidence(
  finding: HealthFinding,
  key: string,
): string {
  const value = finding.evidence[key]
  return typeof value === 'string' ? value : ''
}

function prioritizeSentryFindings(
  findings: HealthFinding[],
): HealthFinding[] {
  return [...findings].sort((left, right) => {
    const severity =
      SEVERITY_PRIORITY[right.severity] - SEVERITY_PRIORITY[left.severity]
    if (severity !== 0) return severity

    const users =
      numericEvidence(right, 'userCount') -
      numericEvidence(left, 'userCount')
    if (users !== 0) return users

    const lastSeen = stringEvidence(right, 'lastSeen').localeCompare(
      stringEvidence(left, 'lastSeen'),
    )
    if (lastSeen !== 0) return lastSeen
    return left.fingerprint.localeCompare(right.fingerprint)
  })
}

/**
 * Build the Slack digest message.
 *
 * Lists per-source finding counts and names every detector that could not run.
 * Posted even when there are zero findings.
 */
export function buildDigest(
  results: DetectorResult[],
  options: BuildDigestOptions,
): string {
  // Per-source finding counts
  const sourceCounts = new Map<string, number>()
  const failedDetectors: Array<{ name: string; error: string }> = []

  for (const result of results) {
    const current = sourceCounts.get(result.source) ?? 0
    sourceCounts.set(result.source, current + result.findings.length)

    if (result.status === 'failed') {
      failedDetectors.push({
        name: result.name,
        error: result.error ?? 'unknown error',
      })
    }
  }

  const totalFindings = [...sourceCounts.values()].reduce((a, b) => a + b, 0)
  const sentryFindings = results.flatMap((result) =>
    result.source === 'sentry'
      ? result.findings.filter(
          (finding) => finding.sentryIssueId !== undefined,
        )
      : [],
  )
  const highlighted = prioritizeSentryFindings(
    sentryFindings.filter((finding) =>
      options.highlightedFingerprints?.has(finding.fingerprint),
    ),
  )

  const lines: string[] = []
  lines.push(`Health Agent — ${options.date}`)
  lines.push(`Total findings: ${totalFindings}`)
  lines.push('')

  // Per-source breakdown
  if (sourceCounts.size > 0) {
    lines.push('Per source:')
    for (const [source, count] of sourceCounts) {
      lines.push(`  ${source}: ${count}`)
    }
  }

  lines.push('')
  lines.push(`Sentry active: ${sentryFindings.length}`)
  if (highlighted.length > 0) {
    lines.push('New or returned Sentry issues:')
    for (const finding of highlighted.slice(0, SENTRY_DIGEST_LIMIT)) {
      const rootCause = stringEvidence(finding, 'rootCause')
      const truncatedCause = rootCause.length > 120 ? `${rootCause.slice(0, 120)}…` : rootCause
      const suffix = truncatedCause ? ` — ${escapeSlackMrkdwn(truncatedCause)}` : ''
      lines.push(
        `  [${finding.severity}] ${escapeSlackMrkdwn(finding.title)}${suffix}`,
      )
    }
    const remainder = highlighted.length - SENTRY_DIGEST_LIMIT
    if (remainder > 0) {
      lines.push(`  ${remainder} more new or returned Sentry issues`)
    }
  }

  // Failed detectors
  if (failedDetectors.length > 0) {
    lines.push('')
    lines.push('Detectors that could not run:')
    for (const d of failedDetectors) {
      lines.push(`  ${d.name}: ${d.error}`)
    }
  }

  lines.push('')
  lines.push(`Trace: ${options.traceUrl}`)

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Block Kit digest builder
// ---------------------------------------------------------------------------

type SlackBlock = Record<string, unknown>

/**
 * Build the Slack digest as Block Kit blocks for richer formatting.
 *
 * The plain-text `buildDigest` is still used as the `text` fallback
 * (shown in push notifications and accessibility readers).
 */
export function buildDigestBlocks(
  results: DetectorResult[],
  options: BuildDigestOptions,
): SlackBlock[] {
  const sourceCounts = new Map<string, number>()
  const failedDetectors: Array<{ name: string; error: string }> = []

  for (const result of results) {
    const current = sourceCounts.get(result.source) ?? 0
    sourceCounts.set(result.source, current + result.findings.length)
    if (result.status === 'failed') {
      failedDetectors.push({
        name: result.name,
        error: result.error ?? 'unknown error',
      })
    }
  }

  const totalFindings = [...sourceCounts.values()].reduce((a, b) => a + b, 0)
  const statusEmoji = failedDetectors.length > 0 ? '⚠️' : '✅'
  const detectorStatus =
    failedDetectors.length > 0
      ? `${failedDetectors.length} detector${failedDetectors.length === 1 ? '' : 's'} failed`
      : 'all detectors ran'

  const blocks: SlackBlock[] = []

  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: `Health Agent — ${options.date}`,
      emoji: true,
    },
  })

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `${statusEmoji} *${totalFindings} finding${totalFindings === 1 ? '' : 's'}* · ${detectorStatus}`,
    },
  })

  const nonZeroSources = [...sourceCounts.entries()].filter(
    ([, count]) => count > 0,
  )
  if (nonZeroSources.length > 0) {
    blocks.push({ type: 'divider' })
    const sourceLines = nonZeroSources.map(
      ([source, count]) => `• ${source}: *${count}*`,
    )
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Per source*\n${sourceLines.join('\n')}`,
      },
    })
  }

  const sentryFindings = results.flatMap((result) =>
    result.source === 'sentry'
      ? result.findings.filter(
          (finding) => finding.sentryIssueId !== undefined,
        )
      : [],
  )

  if (sentryFindings.length > 0) {
    const highlighted = prioritizeSentryFindings(
      sentryFindings.filter((finding) =>
        options.highlightedFingerprints?.has(finding.fingerprint),
      ),
    )

    const sentryLines = [`*Sentry active: ${sentryFindings.length}*`]
    if (highlighted.length > 0) {
      sentryLines.push('_New or returned:_')
      for (const finding of highlighted.slice(0, SENTRY_DIGEST_LIMIT)) {
        const rootCause = stringEvidence(finding, 'rootCause')
        const truncatedCause =
          rootCause.length > 120 ? `${rootCause.slice(0, 120)}…` : rootCause
        const suffix = truncatedCause
          ? ` — ${escapeSlackMrkdwn(truncatedCause)}`
          : ''
        sentryLines.push(
          `• [${finding.severity}] ${escapeSlackMrkdwn(finding.title)}${suffix}`,
        )
      }
      const remainder = highlighted.length - SENTRY_DIGEST_LIMIT
      if (remainder > 0) {
        sentryLines.push(`• _${remainder} more_`)
      }
    }

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: sentryLines.join('\n') },
    })
  }

  if (failedDetectors.length > 0) {
    blocks.push({ type: 'divider' })
    const failLines = failedDetectors.map(
      (d) => `• \`${d.name}\`: ${escapeSlackMrkdwn(d.error)}`,
    )
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `⚠️ *Detectors that could not run*\n${failLines.join('\n')}`,
      },
    })
  }

  blocks.push(contextBlock(options.runId, options.traceUrl))

  return blocks
}

/** Shared thread-detail context line: run id · trace link. */
function contextBlock(runId: string | undefined, traceUrl: string | undefined): SlackBlock {
  const parts: string[] = []
  if (runId) parts.push(`Run \`${runId.slice(0, 8)}\``)
  if (traceUrl) parts.push(`<${traceUrl}|Langfuse trace>`)
  return {
    type: 'context',
    elements: [{ type: 'mrkdwn', text: parts.join(' · ') }],
  }
}

// ---------------------------------------------------------------------------
// Slack helpers
// ---------------------------------------------------------------------------

/**
 * Escape text for Slack mrkdwn: neutralise `&`, `<`, and `>` so that
 * interpolated content (e.g. finding titles containing `<Component>` or
 * `<@U12345>`) is rendered literally instead of being interpreted as
 * Slack formatting or mention syntax.
 */
export function escapeSlackMrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ---------------------------------------------------------------------------
// Repair trigger message builder
// ---------------------------------------------------------------------------

/**
 * Build Block Kit blocks for the repair trigger message (human display).
 */
export function buildRepairTriggerBlocks(
  request: RepairRequest,
  label: string,
): SlackBlock[] {
  const blocks: SlackBlock[] = []

  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: `${label} Repair Request`,
      emoji: true,
    },
  })

  const sourceCounts = new Map<string, number>()
  for (const f of request.findings) {
    sourceCounts.set(f.source, (sourceCounts.get(f.source) ?? 0) + 1)
  }

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `🔧 *${request.findings.length} finding${request.findings.length === 1 ? '' : 's'}* · Run: \`${request.runId.slice(0, 8)}\``,
    },
  })

  const nonZeroSources = [...sourceCounts.entries()].filter(
    ([, count]) => count > 0,
  )
  if (nonZeroSources.length > 0) {
    blocks.push({ type: 'divider' })
    const sourceLines = nonZeroSources.map(
      ([source, count]) => `• ${source}: *${count}*`,
    )
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Per source*\n${sourceLines.join('\n')}`,
      },
    })
  }

  blocks.push(contextBlock(request.runId, request.traceUrl))

  return blocks
}

/**
 * Build the fallback text for the repair trigger message (machine parsing).
 *
 * Contains the `<@botId>` mention (triggers app_mention event) and a compact
 * JSON code block for `extractRepairRequest` to parse from `event.text`.
 */
export function buildRepairTriggerMessage(
  botId: string,
  request: RepairRequest,
  label: string,
): string {
  const lines: string[] = []

  lines.push(`<@${botId}> ${label} repair request`)
  lines.push('')
  lines.push(`Findings (${request.findings.length}):`)
  for (const finding of request.findings) {
    lines.push(`- ${escapeSlackMrkdwn(finding.title)} [${finding.severity}]`)
  }

  lines.push('')
  lines.push('```json')
  lines.push(JSON.stringify(request))
  lines.push('```')

  return lines.join('\n')
}

/**
 * The timeline event the server appends when the process exits. A clean or
 * replayed run returns null: success is written by run.ts (`completed` or
 * `repair_requested`), never at exit. `undefined` result = crashed.
 */
export function buildRunFailureEvent(
  result: RunHealthAgentResult | undefined,
  at: number,
): Extract<RunEvent, { kind: 'failed' }> | null {
  if (!result) return { kind: 'failed', at, outcome: 'crashed' }
  if (result.status === 'failed') {
    return {
      kind: 'failed',
      at,
      outcome: 'failed',
      ...(result.error ? { reason: result.error } : {}),
    }
  }
  if (result.status === 'completed' && result.exitCode !== 0) {
    return { kind: 'failed', at, outcome: 'digest-failed' }
  }
  return null
}
