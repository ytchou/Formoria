import { describe, expect, it } from 'vitest'

import {
  evaluateQualityReports,
  type QualityReportsInput,
} from '../quality'
import { stableFingerprint } from '../../contracts'

// ---------------------------------------------------------------------------
// Helpers — mirrors scripts/health-agent/quality.ts test fixtures
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<QualityReportsInput> = {}): QualityReportsInput {
  return {
    knipExitCode: 0,
    knipReport: { issues: [] },
    repoRoot: '/repo',
    trackedFiles: new Set(['src/app.ts', 'src/lib/utils.ts']),
    vitestExitCode: 0,
    vitestReport: {
      numFailedTestSuites: 0,
      numFailedTests: 0,
      numTotalTestSuites: 5,
      numTotalTests: 20,
      success: true,
      testResults: [],
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('quality detector', () => {
  it('vitest and knip findings keep the quality:* fingerprints of the scripts implementation', () => {
    // Vitest failure → fingerprint matches scripts/health-agent/quality.ts format
    const vitestResult = evaluateQualityReports(
      makeInput({
        vitestExitCode: 1,
        vitestReport: {
          numFailedTestSuites: 1,
          numFailedTests: 1,
          numTotalTestSuites: 5,
          numTotalTests: 20,
          success: false,
          testResults: [
            {
              name: '/repo/src/app.test.ts',
              status: 'failed',
              assertionResults: [
                {
                  status: 'failed',
                  fullName: 'app renders correctly',
                  title: 'renders correctly',
                  failureMessages: ['Expected true, got false at /repo/src/app.ts:10:5'],
                },
              ],
            },
          ],
        },
      }),
    )

    const vitestFindings = vitestResult.findings.filter(
      (f) => f.evidence.check === 'full-unit-suite',
    )
    expect(vitestFindings.length).toBe(1)
    // Must start with "quality:" to match the scripts implementation
    expect(vitestFindings[0]!.fingerprint).toMatch(/^quality:/)
    expect(vitestFindings[0]!.fingerprint).toBe(
      stableFingerprint('quality', 'full-unit-suite', 'src/app.test.ts::app renders correctly'),
    )

    // Knip failure → fingerprint also matches
    const knipResult = evaluateQualityReports(
      makeInput({
        knipExitCode: 1,
        knipReport: {
          issues: [
            {
              file: 'src/lib/utils.ts',
              exports: ['unusedFn'],
            },
          ],
        },
      }),
    )

    const knipFindings = knipResult.findings.filter(
      (f) => f.evidence.check === 'dead-code',
    )
    expect(knipFindings.length).toBe(1)
    expect(knipFindings[0]!.fingerprint).toMatch(/^quality:/)
  })

  it('unused dependencies are reported as findings with report_only disposition', () => {
    const result = evaluateQualityReports(
      makeInput({
        knipExitCode: 1,
        knipReport: {
          issues: [
            {
              file: 'package.json',
              dependencies: ['unused-pkg'],
            },
          ],
        },
      }),
    )

    const depFindings = result.findings.filter(
      (f) => f.evidence.kind === 'dependencies',
    )
    expect(depFindings.length).toBe(1)
    expect(depFindings[0]!.disposition).toBe('report_only')
  })

  it('clean reports produce zero findings', () => {
    const result = evaluateQualityReports(makeInput())
    expect(result.findings).toHaveLength(0)
    expect(result.status).toBe('success')
    expect(result.failures).toHaveLength(0)
  })

  it('malformed vitest report produces a failure', () => {
    const result = evaluateQualityReports(
      makeInput({ vitestReport: 'not-an-object' }),
    )
    expect(result.failures).toContain('full-unit-suite:malformed_output')
    expect(result.status).toBe('failed')
  })

  it('malformed knip report produces a failure', () => {
    const result = evaluateQualityReports(
      makeInput({ knipReport: 'not-an-object' }),
    )
    expect(result.failures).toContain('dead-code:malformed_output')
    expect(result.status).toBe('failed')
  })

  it('known knip noise is suppressed', () => {
    const result = evaluateQualityReports(
      makeInput({
        knipExitCode: 1,
        knipReport: {
          issues: [
            {
              file: 'src/test/server-only.ts',
              files: ['src/test/server-only.ts'],
            },
          ],
        },
        trackedFiles: new Set(['src/test/server-only.ts']),
      }),
    )

    // The known noise entry for files:src/test/server-only.ts should be suppressed
    // Exit code 1 with all issues suppressed = empty findings and success status
    expect(result.findings).toHaveLength(0)
    expect(result.status).toBe('success')
  })

  it('files and dependency kinds get empty changedFiles scope', () => {
    const result = evaluateQualityReports(
      makeInput({
        knipExitCode: 1,
        knipReport: {
          issues: [
            {
              file: 'src/lib/utils.ts',
              dependencies: ['leftpad'],
              exports: ['deadExport'],
            },
          ],
        },
        trackedFiles: new Set(['src/lib/utils.ts']),
      }),
    )

    const depFinding = result.findings.find((f) => f.evidence.kind === 'dependencies')
    const exportFinding = result.findings.find((f) => f.evidence.kind === 'exports')

    // Dependencies: agent can't repair → empty scope
    expect(depFinding?.changedFiles).toEqual([])
    // Exports: agent CAN repair → includes the file
    expect(exportFinding?.changedFiles).toEqual(['src/lib/utils.ts'])
  })
})
