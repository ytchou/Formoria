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
        'vitest-failure',
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
