/**
 * Reporting — one Linear digest ticket per run and the Slack digest.
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

export type BuildTicketsOptions = {
  /** Set of fingerprints that have never been ticketed. */
  unticketed: Set<string>
  /** Langfuse trace URL for the run. */
  traceUrl: string
  /** Run date (YYYY-MM-DD, Asia/Taipei). */
  date: string
  /** Per-fingerprint investigator diagnosis, if available. */
  investigations?: Map<string, string>
}

function findingSection(
  finding: HealthFinding,
  options: BuildTicketsOptions,
  index: number,
): string {
  const lines: string[] = []
  lines.push(`### ${index + 1}. ${finding.title}`)
  lines.push(`- **Source:** ${finding.source}`)
  lines.push(`- **Severity:** ${finding.severity}`)
  lines.push(`- **Fingerprint:** \`${finding.fingerprint}\``)

  if (Object.keys(finding.evidence).length > 0) {
    lines.push('')
    lines.push('**Evidence:**')
    lines.push('```json')
    lines.push(JSON.stringify(finding.evidence, null, 2))
    lines.push('```')
  }

  const investigation = options.investigations?.get(finding.fingerprint)
  if (investigation) {
    lines.push('')
    lines.push('**Investigator diagnosis:**')
    lines.push(investigation)
  }

  return lines.join('\n')
}

function digestTicketBody(
  findings: HealthFinding[],
  options: BuildTicketsOptions,
): string {
  return [
    '# Health Agent review summary',
    '',
    `**Findings:** ${findings.length} new`,
    `**Run date:** ${options.date}`,
    '',
    '## Findings',
    '',
    ...findings.flatMap((finding, index) => [
      findingSection(finding, options, index),
      '',
    ]),
    `[Langfuse trace](${options.traceUrl})`,
  ].join('\n')
}

/**
 * Build ticket specifications for unticketed findings.
 *
 * Every ticket-eligible finding from the run is included in one digest.
 */
export function buildTickets(
  findings: HealthFinding[],
  options: BuildTicketsOptions,
): TicketSpec[] {
  // Runtime Sentry issues are signal-only. Credential findings, including
  // sentry-capture failures, remain eligible for operational tickets.
  const eligible = findings.filter(
    (finding) =>
      finding.source !== 'sentry' &&
      options.unticketed.has(finding.fingerprint),
  )
  if (eligible.length === 0) return []

  const labels = (['Data Quality', 'Ops'] as const).filter((label) =>
    eligible.some((finding) => linearLabelForSource(finding.source) === label),
  )

  return [
    {
      title: `Health Agent — ${eligible.length} new finding${eligible.length === 1 ? '' : 's'} (${options.date})`,
      body: digestTicketBody(eligible, options),
      labels,
      fingerprints: eligible.map((finding) => finding.fingerprint),
    },
  ]
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
      const suffix = rootCause ? ` — ${escapeSlackMrkdwn(rootCause)}` : ''
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
 * Build the Slack message that triggers the ops-agent to repair findings.
 *
 * Format: a `<@botId>` mention (Slack will deliver this as an app_mention
 * event), a human-readable summary of the findings, and a JSON code block
 * containing the full RepairRequest for machine parsing.
 */
export function buildRepairTriggerMessage(
  botId: string,
  request: RepairRequest,
): string {
  const lines: string[] = []

  lines.push(`<@${botId}> Health agent repair request`)
  lines.push('')
  lines.push(`Run: ${request.runId}`)
  if (request.traceUrl) {
    lines.push(`Trace: ${request.traceUrl}`)
  }
  lines.push('')
  lines.push(`Findings (${request.findings.length}):`)
  for (const finding of request.findings) {
    lines.push(`- ${escapeSlackMrkdwn(finding.title)} [${finding.severity}]`)
  }

  lines.push('')
  lines.push('```json')
  lines.push(JSON.stringify(request, null, 2))
  lines.push('```')

  return lines.join('\n')
}
