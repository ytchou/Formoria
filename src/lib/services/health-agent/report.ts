/**
 * Reporting — per-problem Linear tickets and the Slack digest.
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum new Linear tickets created per run. Oldest-first ordering
 * ensures the most stale findings are ticketed first.
 *
 * Ceiling: raise to 20 if the backlog grows and the team can triage faster.
 * Upgrade path: per-source caps if one source dominates.
 */
export const MAX_NEW_TICKETS_PER_RUN = 10

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
  label: 'Data Quality' | 'Ops'
  fingerprints: string[]
}

export type BuildTicketsOptions = {
  /** Set of fingerprints that have never been ticketed. */
  unticketed: Set<string>
  /** Langfuse trace URL for the run. */
  traceUrl: string
  /** Per-fingerprint investigator diagnosis, if available. */
  investigations?: Map<string, string>
  /**
   * When true, links-weekly findings are grouped by detector class
   * (social, brand-channels, etc.) into one ticket per class.
   */
  groupLinksWeekly?: boolean
}

function ticketBody(
  finding: HealthFinding,
  options: BuildTicketsOptions,
): string {
  const lines: string[] = []
  lines.push(`**Finding:** ${finding.title}`)
  lines.push(`**Source:** ${finding.source}`)
  lines.push(`**Severity:** ${finding.severity}`)
  lines.push(`**Fingerprint:** \`${finding.fingerprint}\``)

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

  lines.push('')
  lines.push(`[Langfuse trace](${options.traceUrl})`)

  return lines.join('\n')
}

function groupedTicketBody(
  className: string,
  findings: HealthFinding[],
  options: BuildTicketsOptions,
): string {
  const lines: string[] = []
  lines.push(`**${className}** — ${findings.length} dead link${findings.length === 1 ? '' : 's'}`)
  lines.push('')

  for (const finding of findings) {
    lines.push(`- ${finding.title} (\`${finding.fingerprint}\`)`)
    const investigation = options.investigations?.get(finding.fingerprint)
    if (investigation) {
      lines.push(`  - **Diagnosis:** ${investigation}`)
    }
  }

  lines.push('')
  lines.push(`[Langfuse trace](${options.traceUrl})`)

  return lines.join('\n')
}

/**
 * Extract the "class" from a links-weekly fingerprint.
 * Format: `links-weekly:<class>:<identity>` → returns `<class>`.
 */
function linksWeeklyClass(fingerprint: string): string {
  const parts = fingerprint.split(':')
  return parts[1] ?? 'unknown'
}

/**
 * Build ticket specifications for unticketed findings.
 *
 * One ticket per fingerprint for most sources. links-weekly findings are
 * optionally grouped by detector class into one ticket per class.
 *
 * Results are capped at MAX_NEW_TICKETS_PER_RUN, oldest first.
 */
export function buildTickets(
  findings: HealthFinding[],
  options: BuildTicketsOptions,
): TicketSpec[] {
  // Filter to only unticketed findings
  const eligible = findings.filter((f) => options.unticketed.has(f.fingerprint))
  if (eligible.length === 0) return []

  const tickets: TicketSpec[] = []

  if (options.groupLinksWeekly) {
    // Separate links-weekly from the rest
    const linksWeekly = eligible.filter((f) => f.source === 'links-weekly')
    const others = eligible.filter((f) => f.source !== 'links-weekly')

    // Group links-weekly by class
    const byClass = new Map<string, HealthFinding[]>()
    for (const finding of linksWeekly) {
      const cls = linksWeeklyClass(finding.fingerprint)
      const group = byClass.get(cls) ?? []
      group.push(finding)
      byClass.set(cls, group)
    }

    for (const [cls, classFindings] of byClass) {
      tickets.push({
        title: `Health: ${classFindings.length} dead ${cls} link${classFindings.length === 1 ? '' : 's'}`,
        body: groupedTicketBody(cls, classFindings, options),
        label: linearLabelForSource('links-weekly'),
        fingerprints: classFindings.map((f) => f.fingerprint),
      })
    }

    // Individual tickets for non-links-weekly
    for (const finding of others) {
      tickets.push({
        title: `Health: ${finding.title}`,
        body: ticketBody(finding, options),
        label: linearLabelForSource(finding.source),
        fingerprints: [finding.fingerprint],
      })
    }
  } else {
    // One ticket per finding
    for (const finding of eligible) {
      tickets.push({
        title: `Health: ${finding.title}`,
        body: ticketBody(finding, options),
        label: linearLabelForSource(finding.source),
        fingerprints: [finding.fingerprint],
      })
    }
  }

  // Cap at MAX_NEW_TICKETS_PER_RUN (oldest first — findings are already ordered)
  return tickets.slice(0, MAX_NEW_TICKETS_PER_RUN)
}

// ---------------------------------------------------------------------------
// Digest builder
// ---------------------------------------------------------------------------

export type BuildDigestOptions = {
  /** Run date (YYYY-MM-DD, Asia/Taipei). */
  date: string
  /** Langfuse trace URL. */
  traceUrl: string
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
