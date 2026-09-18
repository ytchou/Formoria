/**
 * E2E test runner — clones staging, installs deps, runs Playwright, parses results.
 *
 * All I/O is behind DI seams so tests never touch the filesystem or network.
 */

import { getInstallationToken } from '@/lib/adapters/github/app-auth'
import {
  unexpectedSkipFailures as unexpectedSkipFailuresImpl,
  type ActionableReportFailure,
  type ExpectedSkipManifest,
} from '@/lib/services/e2e-report/gate'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExecResult = {
  stdout: string
  stderr: string
  exitCode: number
}

export type ExecCommandFn = (
  cmd: string,
  opts?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number },
) => Promise<ExecResult>

export type CloneRepoFn = (opts: {
  ref: string
  shallow: boolean
  token: string
  targetDir: string
}) => Promise<string>

export type FetchRevisionFn = (
  stagingUrl: string,
) => Promise<string>

export type EvaluateSkipsFn = (
  report: unknown,
  manifest: ExpectedSkipManifest,
) => ActionableReportFailure[]

export type RunnerDeps = {
  execCommand: ExecCommandFn
  cloneRepo: CloneRepoFn
  fetchRevision: FetchRevisionFn
  evaluateSkips?: EvaluateSkipsFn
}

export type SourceFailure = {
  file: string | null
  title: string
  error?: string
  project?: string
}

export type PlaywrightStats = {
  expected: number
  unexpected: number
  skipped: number
  flaky: number
  duration: number
}

export type RunResult = {
  passed: boolean
  failures: SourceFailure[]
  unexpectedSkips: ActionableReportFailure[]
  stats: PlaywrightStats
  jsonReport: unknown
  stagingSha: string
}

export type RunE2eSuiteOptions = {
  runId: string
  deps: RunnerDeps
  stagingUrl?: string
  revisionPollIntervalMs?: number
  revisionPollMaxMs?: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_STAGING_URL = process.env.STAGING_BASE_URL ?? 'https://staging.formoria.com'
const REVISION_POLL_INTERVAL_MS = 10_000
const REVISION_POLL_MAX_MS = 10 * 60_000
const PLAYWRIGHT_TIMEOUT_MS = 10 * 60_000
const INSTALL_TIMEOUT_MS = 3 * 60_000

/**
 * Default expected-skip manifest. Kept inline so the runner is self-contained;
 * a future task may load this from the cloned repo.
 */
const DEFAULT_SKIP_MANIFEST: ExpectedSkipManifest = {
  version: 1,
  allowed: [],
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function runE2eSuite(options: RunE2eSuiteOptions): Promise<RunResult> {
  const {
    runId,
    deps,
    stagingUrl = DEFAULT_STAGING_URL,
    revisionPollIntervalMs = REVISION_POLL_INTERVAL_MS,
    revisionPollMaxMs = REVISION_POLL_MAX_MS,
  } = options

  // Step 1: Resolve staging HEAD SHA via git ls-remote
  const lsRemoteResult = await deps.execCommand(
    'git ls-remote origin refs/heads/staging',
  )
  const stagingSha = lsRemoteResult.stdout.split('\t')[0].trim()
  if (!stagingSha) {
    throw new Error('Failed to resolve staging HEAD SHA from git ls-remote')
  }

  console.log(`[e2e-runner] run=${runId} staging-sha=${stagingSha.slice(0, 12)}`)

  // Step 2: Poll X-Formoria-Revision header until it matches staging SHA
  const pollDeadline = Date.now() + revisionPollMaxMs
  let revisionMatched = false

  while (Date.now() < pollDeadline) {
    const deployedRevision = await deps.fetchRevision(stagingUrl)
    if (deployedRevision.startsWith(stagingSha) || stagingSha.startsWith(deployedRevision)) {
      revisionMatched = true
      break
    }
    console.log(
      `[e2e-runner] revision mismatch: deployed=${deployedRevision.slice(0, 12)} expected=${stagingSha.slice(0, 12)}`,
    )
    await sleep(revisionPollIntervalMs)
  }

  if (!revisionMatched) {
    throw new Error(
      `Staging revision did not converge within ${revisionPollMaxMs / 1000}s`,
    )
  }

  // Step 3: Get GitHub App token and shallow clone at SHA
  const cloneToken = await getInstallationToken('clone')
  const targetDir = `/tmp/e2e-run-${runId}`

  await deps.cloneRepo({
    ref: stagingSha,
    shallow: true,
    token: cloneToken,
    targetDir,
  })

  console.log(`[e2e-runner] cloned to ${targetDir}`)

  // Step 4: Install dependencies
  await deps.execCommand(
    'pnpm install --frozen-lockfile',
    { cwd: targetDir, timeoutMs: INSTALL_TIMEOUT_MS },
  )

  // Step 5: Run Playwright with correct env
  const cfAccessClientId = process.env.CF_ACCESS_CLIENT_ID ?? ''
  const cfAccessClientSecret = process.env.CF_ACCESS_CLIENT_SECRET ?? ''

  const playwrightResult = await deps.execCommand(
    'pnpm exec playwright test --project=deep --reporter=json',
    {
      cwd: targetDir,
      timeoutMs: PLAYWRIGHT_TIMEOUT_MS,
      env: {
        FORMORIA_DEPLOYMENT_ENV: 'staging',
        CI: 'true',
        CF_ACCESS_CLIENT_ID: cfAccessClientId,
        CF_ACCESS_CLIENT_SECRET: cfAccessClientSecret,
        BASE_URL: stagingUrl,
      },
    },
  )

  // Step 6: Parse playwright JSON report
  const jsonReport = JSON.parse(playwrightResult.stdout) as Record<string, unknown>
  const rawStats = (jsonReport.stats ?? {}) as Record<string, unknown>

  const stats: PlaywrightStats = {
    expected: Number(rawStats.expected ?? 0),
    unexpected: Number(rawStats.unexpected ?? 0),
    skipped: Number(rawStats.skipped ?? 0),
    flaky: Number(rawStats.flaky ?? 0),
    duration: Number(rawStats.duration ?? 0),
  }

  // Step 7: Evaluate unexpected skips
  const evaluateSkips = deps.evaluateSkips ?? unexpectedSkipFailuresImpl
  const unexpectedSkips = evaluateSkips(jsonReport, DEFAULT_SKIP_MANIFEST)

  // Step 8: Collect failures from errors array
  const rawErrors = Array.isArray(jsonReport.errors) ? jsonReport.errors : []
  const failures: SourceFailure[] = rawErrors.map((err) => {
    const error = err as Record<string, unknown>
    const location = error.location as Record<string, unknown> | undefined
    return {
      file: location?.file ? String(location.file) : null,
      title: String(error.message ?? 'unknown error'),
      error: String(error.message ?? ''),
    }
  })

  const passed = stats.unexpected === 0 && failures.length === 0 && unexpectedSkips.length === 0

  console.log(
    `[e2e-runner] run=${runId} passed=${passed} failures=${failures.length} skips=${unexpectedSkips.length} stats=${JSON.stringify(stats)}`,
  )

  return {
    passed,
    failures,
    unexpectedSkips,
    stats,
    jsonReport,
    stagingSha,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
