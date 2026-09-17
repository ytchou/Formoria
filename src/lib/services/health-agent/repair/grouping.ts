/**
 * Repair grouping — clusters health findings into problems and selects
 * candidates for investigation.
 *
 * Sentry issues sharing the top in-app frame are grouped into one problem.
 * Failing tests are grouped by test file. All other findings remain
 * individual.
 *
 * Only fingerprints never ticketed or regressed are selected, capped at
 * MAX_INVESTIGATIONS_PER_RUN per run.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_INVESTIGATIONS_PER_RUN = 3

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RepairCandidate = {
  id: string
  fingerprint: string
  source: string
  title: string
  evidence: Record<string, unknown>
  changedFiles: string[]
  mergePolicy: 'automatic' | 'human'
  ticketedAt: string | null
  regressedAt: string | null
  /** Top in-app frame for sentry issues. */
  topInAppFrame: string | null
  /** Test file path for vitest failures. */
  testFile: string | null
}

export type RepairGroup = {
  /** Stable key for the group. */
  groupKey: string
  source: string
  members: RepairCandidate[]
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/**
 * Groups findings into problems.
 *
 * - Sentry issues sharing `topInAppFrame` → one group.
 * - Vitest failures sharing `testFile` → one group.
 * - Everything else → one group per finding.
 */
export function groupFindings(findings: RepairCandidate[]): RepairGroup[] {
  const sentryByFrame = new Map<string, RepairCandidate[]>()
  const testByFile = new Map<string, RepairCandidate[]>()
  const ungrouped: RepairCandidate[] = []

  for (const finding of findings) {
    if (finding.source === 'sentry' && finding.topInAppFrame) {
      const frame = finding.topInAppFrame
      const group = sentryByFrame.get(frame) ?? []
      group.push(finding)
      sentryByFrame.set(frame, group)
    } else if (finding.testFile) {
      const file = finding.testFile
      const group = testByFile.get(file) ?? []
      group.push(finding)
      testByFile.set(file, group)
    } else {
      ungrouped.push(finding)
    }
  }

  const groups: RepairGroup[] = []

  for (const [frame, members] of sentryByFrame) {
    groups.push({
      groupKey: `sentry:frame:${frame}`,
      source: 'sentry',
      members,
    })
  }

  for (const [file, members] of testByFile) {
    groups.push({
      groupKey: `quality:test-file:${file}`,
      source: 'quality',
      members,
    })
  }

  for (const finding of ungrouped) {
    groups.push({
      groupKey: finding.fingerprint,
      source: finding.source,
      members: [finding],
    })
  }

  return groups
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * Filters findings to those eligible for repair and caps the result.
 *
 * Exclusions:
 * - Already ticketed (ticketedAt is set)
 * - Regressed (regressedAt is set)
 *
 * The cap (`MAX_INVESTIGATIONS_PER_RUN`) limits how many investigations
 * the agent runs per nightly cycle.
 */
export function selectForRepair(
  findings: RepairCandidate[],
): RepairCandidate[] {
  const eligible = findings.filter(
    (f) => f.ticketedAt === null && f.regressedAt === null,
  )
  return eligible.slice(0, MAX_INVESTIGATIONS_PER_RUN)
}
