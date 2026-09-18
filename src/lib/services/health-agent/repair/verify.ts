/**
 * Repair verification — interprets the exit codes of validation commands
 * (lint, tsc, vitest) into a verdict.
 *
 * The verification commands are:
 * - `pnpm lint`
 * - `pnpm exec tsc --noEmit`
 * - `pnpm exec vitest run` (scoped to changed paths)
 *
 * Pure function: no I/O.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CommandExitResult = {
  exitCode: number
  stdout: string
  stderr: string
}

export type VerificationInput = {
  lintResult: CommandExitResult
  tscResult: CommandExitResult
  vitestResult: CommandExitResult
}

type VerificationVerdict = 'passed' | 'failed'

export type VerificationResult = {
  verdict: VerificationVerdict
  failures: string[]
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Interpret the exit codes of the three validation commands.
 *
 * Any non-zero exit code is a failure. Returns the list of failing
 * commands so the caller can include them in the diagnosis.
 */
export function interpretVerification(input: VerificationInput): VerificationResult {
  const failures: string[] = []

  if (input.lintResult.exitCode !== 0) {
    failures.push('lint')
  }
  if (input.tscResult.exitCode !== 0) {
    failures.push('tsc')
  }
  if (input.vitestResult.exitCode !== 0) {
    failures.push('vitest')
  }

  return {
    verdict: failures.length === 0 ? 'passed' : 'failed',
    failures,
  }
}
