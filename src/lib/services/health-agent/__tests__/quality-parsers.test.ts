import { describe, expect, it } from 'vitest'

import { stableFingerprint } from '../contracts'
import {
  parseKnipFindings,
  parseVitestFindings,
  type CommandResult,
} from '../quality-parsers'

// ---------------------------------------------------------------------------
// Vitest parser
// ---------------------------------------------------------------------------

describe('parseVitestFindings', () => {
  it('extracts failures from vitest JSON', () => {
    const vitestOutput = {
      numFailedTestSuites: 1,
      numFailedTests: 1,
      numTotalTestSuites: 2,
      numTotalTests: 5,
      success: false,
      testResults: [
        {
          name: 'src/lib/services/foo.test.ts',
          status: 'failed',
          assertionResults: [
            {
              ancestorTitles: ['fooService', 'create'],
              title: 'rejects invalid input',
              status: 'failed',
              fullName: 'fooService > create > rejects invalid input',
              failureMessages: ['Expected true to be false'],
            },
          ],
        },
      ],
    }
    const results: CommandResult[] = [
      {
        id: 'vitest',
        stdout: JSON.stringify(vitestOutput),
        stderr: '',
        exitCode: 1,
        timedOut: false,
      },
    ]

    const findings = parseVitestFindings(results)

    expect(findings).toHaveLength(1)
    const finding = findings[0]
    expect(finding.source).toBe('quality')
    expect(finding.severity).toBe('high')
    expect(finding.mergePolicy).toBe('automatic')
    expect(finding.title).toBe(
      'Test failure: fooService > create > rejects invalid input',
    )
    expect(finding.fingerprint).toBe(
      stableFingerprint(
        'quality',
        'full-unit-suite',
        'fooService > create > rejects invalid input',
      ),
    )
    expect(finding.evidence).toMatchObject({
      failureMessages: ['Expected true to be false'],
    })
  })

  it('returns empty for all-passing', () => {
    const vitestOutput = {
      numFailedTestSuites: 0,
      numFailedTests: 0,
      numTotalTestSuites: 3,
      numTotalTests: 10,
      success: true,
      testResults: [],
    }
    const results: CommandResult[] = [
      {
        id: 'vitest',
        stdout: JSON.stringify(vitestOutput),
        stderr: '',
        exitCode: 0,
        timedOut: false,
      },
    ]

    expect(parseVitestFindings(results)).toEqual([])
  })

  it('sets changedFiles from testResult.name', () => {
    const vitestOutput = {
      numFailedTestSuites: 1,
      numFailedTests: 1,
      numTotalTestSuites: 1,
      numTotalTests: 1,
      success: false,
      testResults: [
        {
          name: 'src/lib/services/foo.test.ts',
          status: 'failed',
          assertionResults: [
            {
              ancestorTitles: ['suite'],
              title: 'fails',
              status: 'failed',
              failureMessages: ['oops'],
            },
          ],
        },
      ],
    }
    const results: CommandResult[] = [
      {
        id: 'vitest',
        stdout: JSON.stringify(vitestOutput),
        stderr: '',
        exitCode: 1,
        timedOut: false,
      },
    ]

    const findings = parseVitestFindings(results)

    expect(findings[0].changedFiles).toEqual([
      'src/lib/services/foo.test.ts',
    ])
  })

  it('returns empty on invalid JSON', () => {
    const results: CommandResult[] = [
      {
        id: 'vitest',
        stdout: 'not valid json {{{',
        stderr: '',
        exitCode: 1,
        timedOut: false,
      },
    ]

    expect(parseVitestFindings(results)).toEqual([])
  })

  it('extracts JSON from mixed stdout with non-JSON prefix', () => {
    const vitestOutput = {
      numFailedTestSuites: 1,
      numFailedTests: 1,
      numTotalTestSuites: 1,
      numTotalTests: 1,
      success: false,
      testResults: [
        {
          name: 'src/test.ts',
          status: 'failed',
          assertionResults: [
            {
              ancestorTitles: [],
              title: 'broken',
              status: 'failed',
              failureMessages: ['err'],
            },
          ],
        },
      ],
    }
    const results: CommandResult[] = [
      {
        id: 'vitest',
        stdout: `Vite startup message\n${JSON.stringify(vitestOutput)}`,
        stderr: '',
        exitCode: 1,
        timedOut: false,
      },
    ]

    const findings = parseVitestFindings(results)

    expect(findings).toHaveLength(1)
    expect(findings[0].title).toBe('Test failure: broken')
  })
})

// ---------------------------------------------------------------------------
// Knip parser
// ---------------------------------------------------------------------------

describe('parseKnipFindings', () => {
  it('extracts unused exports', () => {
    const knipOutput = {
      issues: [
        {
          file: 'src/lib/utils/helpers.ts',
          dependencies: [],
          devDependencies: [],
          optionalPeerDependencies: [],
          unlisted: [],
          binaries: [],
          unresolved: [],
          exports: [{ name: 'unusedHelper', line: 42, col: 1, pos: 500 }],
          types: [],
          enumMembers: [],
          duplicates: [],
          namespaceMembers: [],
          catalog: [],
          files: false,
        },
      ],
    }
    const results: CommandResult[] = [
      {
        id: 'knip',
        stdout: JSON.stringify(knipOutput),
        stderr: '',
        exitCode: 1,
        timedOut: false,
      },
    ]

    const findings = parseKnipFindings(results)

    expect(findings).toHaveLength(1)
    const finding = findings[0]
    expect(finding.source).toBe('quality')
    expect(finding.severity).toBe('low')
    expect(finding.disposition).toBe('report_only')
    expect(finding.mergePolicy).toBe('human')
    expect(finding.title).toBe(
      'Unused export: unusedHelper in src/lib/utils/helpers.ts',
    )
    expect(finding.fingerprint).toBe(
      stableFingerprint(
        'quality',
        'unused-export',
        'src/lib/utils/helpers.ts:unusedHelper',
      ),
    )
  })

  it('returns empty when nothing unused', () => {
    const knipOutput = {
      issues: [
        {
          file: 'src/lib/utils/helpers.ts',
          dependencies: [],
          devDependencies: [],
          optionalPeerDependencies: [],
          unlisted: [],
          binaries: [],
          unresolved: [],
          exports: [],
          types: [],
          enumMembers: [],
          duplicates: [],
          namespaceMembers: [],
          catalog: [],
          files: false,
        },
      ],
    }
    const results: CommandResult[] = [
      {
        id: 'knip',
        stdout: JSON.stringify(knipOutput),
        stderr: '',
        exitCode: 0,
        timedOut: false,
      },
    ]

    expect(parseKnipFindings(results)).toEqual([])
  })

  it('uses unused-type fingerprint kind for type exports', () => {
    const knipOutput = {
      issues: [
        {
          file: 'src/lib/types.ts',
          dependencies: [],
          devDependencies: [],
          optionalPeerDependencies: [],
          unlisted: [],
          binaries: [],
          unresolved: [],
          exports: [],
          types: [{ name: 'OldType', line: 1, col: 1, pos: 0 }],
          enumMembers: [],
          duplicates: [],
          namespaceMembers: [],
          catalog: [],
          files: false,
        },
      ],
    }
    const results: CommandResult[] = [
      {
        id: 'knip',
        stdout: JSON.stringify(knipOutput),
        stderr: '',
        exitCode: 1,
        timedOut: false,
      },
    ]

    const findings = parseKnipFindings(results)

    expect(findings).toHaveLength(1)
    expect(findings[0].fingerprint).toBe(
      stableFingerprint('quality', 'unused-type', 'src/lib/types.ts:OldType'),
    )
    expect(findings[0].title).toBe('Unused type: OldType in src/lib/types.ts')
  })

  it('filters known knip noise entries', () => {
    const knipOutput = {
      issues: [
        {
          file: 'src/lib/adapters/alerting/sentry.ts',
          dependencies: [],
          devDependencies: [],
          optionalPeerDependencies: [],
          unlisted: [],
          binaries: [],
          unresolved: [],
          exports: [
            { name: 'resetSentryAdapterForTests', line: 1, col: 1, pos: 0 },
            { name: 'realExport', line: 2, col: 1, pos: 10 },
          ],
          types: [],
          enumMembers: [],
          duplicates: [],
          namespaceMembers: [],
          catalog: [],
          files: false,
        },
      ],
    }
    const results: CommandResult[] = [
      {
        id: 'knip',
        stdout: JSON.stringify(knipOutput),
        stderr: '',
        exitCode: 1,
        timedOut: false,
      },
    ]

    const findings = parseKnipFindings(results)

    // resetSentryAdapterForTests is in the known-noise list, so only realExport survives
    expect(findings).toHaveLength(1)
    expect(findings[0].title).toBe(
      'Unused export: realExport in src/lib/adapters/alerting/sentry.ts',
    )
  })

  it('handles missing command result', () => {
    const results: CommandResult[] = [
      {
        id: 'vitest',
        stdout: '{}',
        stderr: '',
        exitCode: 0,
        timedOut: false,
      },
    ]

    expect(parseKnipFindings(results)).toEqual([])
  })
})
