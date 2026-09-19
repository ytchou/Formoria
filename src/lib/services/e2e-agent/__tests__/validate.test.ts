import { describe, expect, it, vi } from 'vitest'
import { validateRepair, type ValidateDeps } from '../validate'
import type { FrozenFailure, RepairResult } from '../types'

function makeFrozen(overrides: Partial<FrozenFailure> = {}): FrozenFailure {
  return {
    file: 'e2e/tests/search.spec.ts',
    title: 'search renders results',
    error: 'Locator not found',
    fingerprint: 'abc123',
    ...overrides,
  }
}

function makeRepair(overrides: Partial<RepairResult> = {}): RepairResult {
  return {
    changedFiles: [{ path: 'e2e/tests/search.spec.ts', content: '// fixed' }],
    branch: 'e2e-selfheal/fix-abc',
    baseSha: 'deadbeef',
    ...overrides,
  }
}

function makeDeps(overrides: Partial<ValidateDeps> = {}): ValidateDeps {
  return {
    execCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    cloneRepo: vi.fn().mockResolvedValue('/tmp/clone-dir'),
    frozenFailures: [makeFrozen()],
    repair: makeRepair(),
    ...overrides,
  }
}

describe('validate_clones_repair_branch_and_reruns_exact_failures', () => {
  it('runs targeted Playwright with only frozen failure specs', async () => {
    const execCommand = vi.fn()
      // install deps
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      // playwright run — returns JSON with all passing
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          suites: [],
          stats: { expected: 1, unexpected: 0 },
        }),
        stderr: '',
        exitCode: 0,
      })
    const cloneRepo = vi.fn().mockResolvedValue('/tmp/clone-dir')
    const frozen1 = makeFrozen({ file: 'e2e/tests/search.spec.ts' })
    const frozen2 = makeFrozen({
      file: 'e2e/tests/mobile.spec.ts',
      title: 'mobile search works',
      fingerprint: 'def456',
    })
    const deps = makeDeps({
      execCommand,
      cloneRepo,
      frozenFailures: [frozen1, frozen2],
    })

    await validateRepair(deps)

    expect(cloneRepo).toHaveBeenCalledWith(deps.repair.branch)
    // The playwright command should reference both spec files
    const playwrightCall = execCommand.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('playwright'),
    )
    expect(playwrightCall).toBeDefined()
    const cmd = playwrightCall![0] as string
    expect(cmd).toContain('e2e/tests/search.spec.ts')
    expect(cmd).toContain('e2e/tests/mobile.spec.ts')
    expect(cmd).toContain('--reporter=json')
  })
})

describe('validate_returns_passed_true_when_all_exact_failures_pass', () => {
  it('returns passed true when Playwright exits 0', async () => {
    const execCommand = vi.fn()
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          suites: [],
          stats: { expected: 1, unexpected: 0 },
        }),
        stderr: '',
        exitCode: 0,
      })
    const deps = makeDeps({ execCommand })

    const result = await validateRepair(deps)

    expect(result.passed).toBe(true)
    expect(result.remainingFailures).toEqual([])
  })
})

describe('validate_returns_passed_false_with_remaining_failures', () => {
  it('returns passed false when some tests still fail', async () => {
    const frozen1 = makeFrozen({ file: 'e2e/tests/search.spec.ts', fingerprint: 'aaa' })
    const frozen2 = makeFrozen({
      file: 'e2e/tests/mobile.spec.ts',
      title: 'mobile search works',
      fingerprint: 'bbb',
    })
    const execCommand = vi.fn()
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          suites: [
            {
              file: 'e2e/tests/mobile.spec.ts',
              specs: [{ title: 'mobile search works', ok: false }],
            },
          ],
          stats: { expected: 1, unexpected: 1 },
        }),
        stderr: '',
        exitCode: 1,
      })
    const deps = makeDeps({
      execCommand,
      frozenFailures: [frozen1, frozen2],
    })

    const result = await validateRepair(deps)

    expect(result.passed).toBe(false)
    expect(result.remainingFailures).toHaveLength(1)
    expect(result.remainingFailures[0].file).toBe('e2e/tests/mobile.spec.ts')
  })
})
