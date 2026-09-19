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
const PLAYWRIGHT_TIMEOUT_MS = 20 * 60_000
const INSTALL_TIMEOUT_MS = 3 * 60_000

const DEFAULT_SKIP_MANIFEST: ExpectedSkipManifest = {
  version: 1,
  allowed: [],
}

const SKIP_MANIFEST_PATH = 'scripts/e2e-expected-skips.json'

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

  // Step 1: Resolve staging HEAD SHA via git ls-remote (with auth for private repo)
  const cloneToken = await getInstallationToken('clone')
  const repoSlug = process.env.GITHUB_APP_REPOSITORY ?? 'ytchou/Formoria'
  const authedUrl = `https://x-access-token:${cloneToken}@github.com/${repoSlug}.git`
  const lsRemoteResult = await deps.execCommand(
    `git ls-remote ${authedUrl} refs/heads/staging`,
  )
  if (lsRemoteResult.exitCode !== 0) {
    throw new Error(
      `git ls-remote failed (exit ${lsRemoteResult.exitCode}): ${lsRemoteResult.stderr.slice(0, 500)}`,
    )
  }
  const stagingSha = lsRemoteResult.stdout.split('\t')[0].trim()
  if (!stagingSha) {
    throw new Error(
      `git ls-remote returned no SHA. stdout=${JSON.stringify(lsRemoteResult.stdout.slice(0, 200))} stderr=${JSON.stringify(lsRemoteResult.stderr.slice(0, 200))}`,
    )
  }

  console.log(`[e2e-runner] run=${runId} staging-sha=${stagingSha.slice(0, 12)}`)

  // Step 2: Poll X-Formoria-Revision header until it matches staging SHA.
  // Best-effort: if the header is never set (empty on every attempt), warn and proceed.
  const pollDeadline = Date.now() + revisionPollMaxMs
  let revisionMatched = false
  let emptyCount = 0
  const MAX_EMPTY_BEFORE_SKIP = 3

  while (Date.now() < pollDeadline) {
    const deployedRevision = await deps.fetchRevision(stagingUrl)
    if (!deployedRevision) {
      emptyCount++
      if (emptyCount >= MAX_EMPTY_BEFORE_SKIP) {
        console.log(`[e2e-runner] revision header absent after ${emptyCount} attempts — skipping revision check`)
        revisionMatched = true
        break
      }
      console.log(`[e2e-runner] revision empty (${emptyCount}/${MAX_EMPTY_BEFORE_SKIP}), retrying…`)
      await sleep(revisionPollIntervalMs)
      continue
    }
    emptyCount = 0
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

  // Step 3: Shallow clone at SHA (reuse token from step 1)
  const targetDir = `/tmp/e2e-run-${runId}`

  await deps.cloneRepo({
    ref: stagingSha,
    shallow: true,
    token: cloneToken,
    targetDir,
  })

  console.log(`[e2e-runner] cloned to ${targetDir}`)

  // Step 4: Install dependencies (NODE_ENV must not be 'production' or pnpm
  // skips devDependencies, which includes @playwright/test)
  console.log('[e2e-runner] installing dependencies…')
  const installResult = await deps.execCommand(
    'pnpm install --frozen-lockfile',
    { cwd: targetDir, timeoutMs: INSTALL_TIMEOUT_MS, env: { NODE_ENV: 'development' } },
  )
  if (installResult.exitCode !== 0) {
    throw new Error(
      `pnpm install failed (exit ${installResult.exitCode}): ${installResult.stderr.slice(0, 500)}`,
    )
  }
  console.log('[e2e-runner] dependencies installed')

  // Step 5: Run Playwright with correct env
  const cfAccessClientId = process.env.CF_ACCESS_CLIENT_ID ?? ''
  const cfAccessClientSecret = process.env.CF_ACCESS_CLIENT_SECRET ?? ''
  const stagingSessionSecret = process.env.E2E_STAGING_SESSION_SECRET ?? ''

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
        E2E_STAGING_SESSION_SECRET: stagingSessionSecret,
        BASE_URL: stagingUrl,
      },
    },
  )

  // Step 6: Parse playwright JSON report
  console.log(
    `[e2e-runner] playwright exit=${playwrightResult.exitCode} stdout=${playwrightResult.stdout.length}b stderr=${playwrightResult.stderr.length}b`,
  )
  if (playwrightResult.exitCode !== 0 && playwrightResult.stdout.length === 0) {
    console.log(`[e2e-runner] playwright stderr: ${playwrightResult.stderr.slice(0, 1000)}`)
  }

  // globalSetup logs and pnpm plugins (dotenvx) write to stdout before the
  // JSON reporter output. Strip non-JSON prefix by finding the report's opening brace.
  let jsonText = playwrightResult.stdout
  const jsonLineStart = jsonText.indexOf('\n{')
  if (jsonLineStart >= 0) {
    jsonText = jsonText.slice(jsonLineStart + 1)
  }

  let jsonReport: Record<string, unknown>
  try {
    jsonReport = JSON.parse(jsonText) as Record<string, unknown>
  } catch {
    console.log(`[e2e-runner] JSON parse failed. stdout preview: ${playwrightResult.stdout.slice(0, 2000)}`)
    console.log(`[e2e-runner] stderr preview: ${playwrightResult.stderr.slice(0, 1000)}`)
    return {
      passed: false,
      failures: [{
        file: null,
        title: 'Failed to parse Playwright JSON report',
        error: `exitCode=${playwrightResult.exitCode}, stdout length=${playwrightResult.stdout.length}`,
      }],
      unexpectedSkips: [],
      stats: { expected: 0, unexpected: 0, skipped: 0, flaky: 0, duration: 0 },
      jsonReport: {},
      stagingSha,
    }
  }
  const rawStats = (jsonReport.stats ?? {}) as Record<string, unknown>

  const stats: PlaywrightStats = {
    expected: Number(rawStats.expected ?? 0),
    unexpected: Number(rawStats.unexpected ?? 0),
    skipped: Number(rawStats.skipped ?? 0),
    flaky: Number(rawStats.flaky ?? 0),
    duration: Number(rawStats.duration ?? 0),
  }

  // Step 7: Load skip manifest from cloned repo, falling back to default
  const skipManifest = await loadSkipManifest(deps.execCommand, targetDir)

  // Step 7b: Evaluate unexpected skips
  const evaluateSkips = deps.evaluateSkips ?? unexpectedSkipFailuresImpl
  const unexpectedSkips = evaluateSkips(jsonReport, skipManifest)

  // Step 8: Collect failures from suite tree (spec-level unexpected results)
  // and global config errors. Test failures live in suites[].specs[].tests[],
  // not in the top-level `errors` array (which only has global/config errors).
  const failures: SourceFailure[] = []
  collectSuiteFailures(jsonReport, failures)

  // Also include global/config errors (e.g. config parse failures)
  const rawErrors = Array.isArray(jsonReport.errors) ? jsonReport.errors : []
  for (const err of rawErrors) {
    const error = err as Record<string, unknown>
    const location = error.location as Record<string, unknown> | undefined
    failures.push({
      file: location?.file ? String(location.file) : null,
      title: String(error.message ?? 'unknown error'),
      error: String(error.message ?? ''),
    })
  }

  const passed =
    playwrightResult.exitCode === 0 &&
    stats.unexpected === 0 &&
    failures.length === 0 &&
    unexpectedSkips.length === 0

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

/**
 * Load the expected-skip manifest from the cloned repo via `cat`.
 * Falls back to the built-in empty manifest if the file doesn't exist
 * or can't be parsed.
 */
async function loadSkipManifest(
  execCommand: ExecCommandFn,
  repoDir: string,
): Promise<ExpectedSkipManifest> {
  try {
    const result = await execCommand(`cat ${SKIP_MANIFEST_PATH}`, {
      cwd: repoDir,
    })
    if (result.exitCode !== 0) return DEFAULT_SKIP_MANIFEST
    return JSON.parse(result.stdout) as ExpectedSkipManifest
  } catch {
    return DEFAULT_SKIP_MANIFEST
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Walk the Playwright JSON suite tree and collect spec-level failures
 * (tests with `status: 'unexpected'`). Mirrors the traversal pattern
 * used by `collectSkipped` in e2e-report/gate.ts.
 */
function collectSuiteFailures(
  report: Record<string, unknown>,
  out: SourceFailure[],
): void {
  const suites = Array.isArray(report.suites) ? report.suites : []

  function visitSuite(
    suite: Record<string, unknown>,
    inheritedFile: string | null,
    parents: string[],
  ): void {
    const file = text(suite.file) || inheritedFile
    const nextParents = text(suite.title)
      ? [...parents, text(suite.title)]
      : parents

    const specs = Array.isArray(suite.specs) ? suite.specs : []
    for (const rawSpec of specs) {
      if (!rawSpec || typeof rawSpec !== 'object') continue
      const spec = rawSpec as Record<string, unknown>
      const title = [...nextParents, text(spec.title)]
        .filter(Boolean)
        .join(' › ')

      const tests = Array.isArray(spec.tests) ? spec.tests : []
      for (const rawTest of tests) {
        if (!rawTest || typeof rawTest !== 'object') continue
        const test = rawTest as Record<string, unknown>
        if (test.status !== 'unexpected') continue

        const projectName = text(test.projectName) || undefined
        const results = Array.isArray(test.results) ? test.results : []
        const lastResult = results[results.length - 1] as
          | Record<string, unknown>
          | undefined
        const errorObj = (lastResult?.error ?? test.error) as
          | Record<string, unknown>
          | undefined
        const errorMsg = errorObj ? text(errorObj.message) : ''

        out.push({
          file: file,
          title,
          error: errorMsg || undefined,
          project: projectName,
        })
      }
    }

    const childSuites = Array.isArray(suite.suites) ? suite.suites : []
    for (const rawChild of childSuites) {
      if (rawChild && typeof rawChild === 'object') {
        visitSuite(rawChild as Record<string, unknown>, file, nextParents)
      }
    }
  }

  for (const rawSuite of suites) {
    if (rawSuite && typeof rawSuite === 'object') {
      visitSuite(rawSuite as Record<string, unknown>, null, [])
    }
  }
}
