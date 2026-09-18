import type { FrozenFailure, RepairResult } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ExecResult = { stdout: string; stderr: string; exitCode: number }

export type ValidateDeps = {
  execCommand: (cmd: string, opts?: { cwd?: string }) => Promise<ExecResult>
  cloneRepo: (branch: string) => Promise<string>
  frozenFailures: FrozenFailure[]
  repair: RepairResult
}

export type ValidationResult = {
  passed: boolean
  remainingFailures: FrozenFailure[]
}

// ---------------------------------------------------------------------------
// Playwright JSON reporter shape (subset)
// ---------------------------------------------------------------------------

type PlaywrightSpec = { title: string; ok: boolean }
type PlaywrightSuite = { file?: string; specs?: PlaywrightSpec[]; suites?: PlaywrightSuite[] }
type PlaywrightReport = {
  suites?: PlaywrightSuite[]
  stats?: { expected?: number; unexpected?: number }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deduplicate spec file paths from the frozen failures. */
function uniqueSpecFiles(failures: FrozenFailure[]): string[] {
  return [...new Set(failures.map((f) => f.file))].sort()
}

/** Walk the nested suite tree and collect all failing specs with their file. */
function collectFailingSpecs(
  suites: PlaywrightSuite[],
  parentFile?: string,
): Array<{ file: string; title: string }> {
  const failing: Array<{ file: string; title: string }> = []
  for (const suite of suites) {
    const file = suite.file ?? parentFile ?? ''
    for (const spec of suite.specs ?? []) {
      if (!spec.ok) {
        failing.push({ file, title: spec.title })
      }
    }
    if (suite.suites) {
      failing.push(...collectFailingSpecs(suite.suites, file))
    }
  }
  return failing
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Clone the repair branch and re-run only the originally-frozen spec files
 * to confirm the fix. Returns whether all frozen failures now pass.
 */
export async function validateRepair(deps: ValidateDeps): Promise<ValidationResult> {
  const { execCommand, cloneRepo, frozenFailures, repair } = deps

  // 1. Clone at the repair branch
  const dir = await cloneRepo(repair.branch)

  // 2. Install dependencies
  await execCommand('pnpm install --frozen-lockfile', { cwd: dir })

  // 3. Run only the frozen failure spec files
  const specFiles = uniqueSpecFiles(frozenFailures)
  const cmd = `npx playwright test ${specFiles.join(' ')} --reporter=json`
  const result = await execCommand(cmd, { cwd: dir })

  // 4. Parse results — exit code 0 means all passed
  if (result.exitCode === 0) {
    return { passed: true, remainingFailures: [] }
  }

  // Parse the JSON output to identify which frozen failures still fail
  let report: PlaywrightReport
  try {
    report = JSON.parse(result.stdout) as PlaywrightReport
  } catch {
    // If we can't parse JSON, treat all frozen failures as remaining
    return { passed: false, remainingFailures: [...frozenFailures] }
  }

  const failingSpecs = collectFailingSpecs(report.suites ?? [])

  // Match failing specs back to frozen failures
  const remaining = frozenFailures.filter((frozen) =>
    failingSpecs.some(
      (spec) => spec.file === frozen.file && spec.title === frozen.title,
    ),
  )

  // If we got a non-zero exit but no matching failures, something else broke
  // — still report as failed with an empty remaining set is misleading,
  // so default to all frozen failures as remaining.
  if (remaining.length === 0 && result.exitCode !== 0) {
    return { passed: false, remainingFailures: [...frozenFailures] }
  }

  return { passed: false, remainingFailures: remaining }
}
