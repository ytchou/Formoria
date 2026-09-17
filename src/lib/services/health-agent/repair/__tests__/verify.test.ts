import { describe, expect, it } from 'vitest'

import {
  interpretVerification,
  type VerificationInput,
} from '../verify'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<VerificationInput> = {}): VerificationInput {
  return {
    lintResult: { exitCode: 0, stdout: '', stderr: '' },
    tscResult: { exitCode: 0, stdout: '', stderr: '' },
    vitestResult: { exitCode: 0, stdout: '', stderr: '' },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('repair verification', () => {
  it('all commands passing returns passed', () => {
    const result = interpretVerification(makeInput())
    expect(result.verdict).toBe('passed')
    expect(result.failures).toHaveLength(0)
  })

  it('lint failure returns failed with lint reason', () => {
    const result = interpretVerification(
      makeInput({
        lintResult: { exitCode: 1, stdout: 'error', stderr: 'ESLint found problems' },
      }),
    )
    expect(result.verdict).toBe('failed')
    expect(result.failures).toContain('lint')
  })

  it('tsc failure returns failed with tsc reason', () => {
    const result = interpretVerification(
      makeInput({
        tscResult: { exitCode: 2, stdout: '', stderr: 'error TS2345: ...' },
      }),
    )
    expect(result.verdict).toBe('failed')
    expect(result.failures).toContain('tsc')
  })

  it('vitest failure returns failed with vitest reason', () => {
    const result = interpretVerification(
      makeInput({
        vitestResult: { exitCode: 1, stdout: '', stderr: 'FAIL tests' },
      }),
    )
    expect(result.verdict).toBe('failed')
    expect(result.failures).toContain('vitest')
  })

  it('multiple failures are all listed', () => {
    const result = interpretVerification(
      makeInput({
        lintResult: { exitCode: 1, stdout: '', stderr: '' },
        tscResult: { exitCode: 1, stdout: '', stderr: '' },
      }),
    )
    expect(result.verdict).toBe('failed')
    expect(result.failures).toEqual(expect.arrayContaining(['lint', 'tsc']))
  })
})
