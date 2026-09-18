/**
 * Quality result parsers — convert raw vitest/knip JSON stdout from the
 * repo-worker into HealthFinding[] objects.
 *
 * These are lightweight parsers that operate on CommandResult[] (the shape
 * returned by the repo-worker). Unlike detectors/quality.ts which takes
 * pre-parsed reports with repo-root context, these parse from raw stdout
 * and produce simpler findings suitable for the agent pipeline.
 */

import {
  stableFingerprint,
  type HealthFinding,
  type HealthFindingDisposition,
} from './contracts'

// ---------------------------------------------------------------------------
// Local type — mirrors the repo-worker shape without importing across layers
// ---------------------------------------------------------------------------

export type CommandResult = {
  id: string
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function findResult(
  results: CommandResult[],
  id: string,
): CommandResult | undefined {
  return results.find((r) => r.id === id)
}

function safeParse(json: string): unknown | undefined {
  try {
    return JSON.parse(json)
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ---------------------------------------------------------------------------
// Vitest parser
// ---------------------------------------------------------------------------

export function parseVitestFindings(results: CommandResult[]): HealthFinding[] {
  const result = findResult(results, 'vitest')
  if (!result) return []

  const parsed = safeParse(result.stdout)
  if (!isRecord(parsed)) return []

  if (
    typeof parsed.numFailedTests !== 'number' ||
    parsed.numFailedTests === 0
  ) {
    return []
  }

  if (!Array.isArray(parsed.testResults)) return []

  const findings: HealthFinding[] = []

  for (const testResult of parsed.testResults) {
    if (!isRecord(testResult) || !Array.isArray(testResult.assertionResults)) {
      continue
    }

    for (const assertion of testResult.assertionResults) {
      if (!isRecord(assertion) || assertion.status !== 'failed') continue

      const ancestorTitles = Array.isArray(assertion.ancestorTitles)
        ? (assertion.ancestorTitles as string[])
        : []
      const title =
        typeof assertion.title === 'string' ? assertion.title : 'unknown'

      const fullTitle = [...ancestorTitles, title].join(' > ')

      const failureMessages = Array.isArray(assertion.failureMessages)
        ? (assertion.failureMessages as string[])
        : []

      findings.push({
        source: 'quality',
        severity: 'high',
        mergePolicy: 'automatic',
        fingerprint: stableFingerprint('quality', 'vitest-failure', fullTitle),
        title: `Test failure: ${fullTitle}`,
        evidence: {
          failureMessages,
        },
      })
    }
  }

  return findings
}

// ---------------------------------------------------------------------------
// Knip parser
// ---------------------------------------------------------------------------

/**
 * Knip JSON reporter emits `{ issues: [{ file, exports: [{ name }], ... }] }`.
 * Older shapes used top-level `files[]` and `exports[]` — we handle both.
 */
export function parseKnipFindings(results: CommandResult[]): HealthFinding[] {
  const result = findResult(results, 'knip')
  if (!result) return []

  const parsed = safeParse(result.stdout)
  if (!isRecord(parsed)) return []

  const findings: HealthFinding[] = []
  const disposition: HealthFindingDisposition = 'report_only'

  // Current shape: { issues: [{ file, exports: [{ name }], types: [{ name }], ... }] }
  if (Array.isArray(parsed.issues)) {
    for (const issue of parsed.issues) {
      if (!isRecord(issue)) continue
      const file = typeof issue.file === 'string' ? issue.file : 'unknown'

      // Extract unused exports
      if (Array.isArray(issue.exports)) {
        for (const exp of issue.exports) {
          const symbol = isRecord(exp) && typeof exp.name === 'string'
            ? exp.name
            : typeof exp === 'string'
              ? exp
              : undefined
          if (!symbol) continue
          findings.push({
            source: 'quality',
            severity: 'low',
            disposition,
            mergePolicy: 'human',
            fingerprint: stableFingerprint(
              'quality',
              'unused-export',
              `${file}:${symbol}`,
            ),
            title: `Unused export: ${symbol} in ${file}`,
            evidence: { file, symbol },
          })
        }
      }

      // Extract unused types
      if (Array.isArray(issue.types)) {
        for (const typ of issue.types) {
          const symbol = isRecord(typ) && typeof typ.name === 'string'
            ? typ.name
            : typeof typ === 'string'
              ? typ
              : undefined
          if (!symbol) continue
          findings.push({
            source: 'quality',
            severity: 'low',
            disposition,
            mergePolicy: 'human',
            fingerprint: stableFingerprint(
              'quality',
              'unused-export',
              `${file}:${symbol}`,
            ),
            title: `Unused export: ${symbol} in ${file}`,
            evidence: { file, symbol, kind: 'type' },
          })
        }
      }
    }
  }

  // Older shape: top-level { exports: [{ file, symbol }] }
  if (findings.length === 0 && Array.isArray(parsed.exports)) {
    for (const exp of parsed.exports) {
      if (!isRecord(exp)) continue
      const file = typeof exp.file === 'string' ? exp.file : 'unknown'
      const symbol = typeof exp.symbol === 'string'
        ? exp.symbol
        : typeof exp.name === 'string'
          ? exp.name
          : undefined
      if (!symbol) continue
      findings.push({
        source: 'quality',
        severity: 'low',
        disposition,
        mergePolicy: 'human',
        fingerprint: stableFingerprint(
          'quality',
          'unused-export',
          `${file}:${symbol}`,
        ),
        title: `Unused export: ${symbol} in ${file}`,
        evidence: { file, symbol },
      })
    }
  }

  // Older shape: top-level { files: [string] }
  if (findings.length === 0 && Array.isArray(parsed.files)) {
    for (const file of parsed.files) {
      if (typeof file !== 'string') continue
      findings.push({
        source: 'quality',
        severity: 'low',
        disposition,
        mergePolicy: 'human',
        fingerprint: stableFingerprint(
          'quality',
          'unused-export',
          `${file}:*`,
        ),
        title: `Unused file: ${file}`,
        evidence: { file },
      })
    }
  }

  return findings
}
