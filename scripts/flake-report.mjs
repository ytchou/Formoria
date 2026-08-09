#!/usr/bin/env node
/**
 * Per-test flake history for the nightly e2e suite.
 *
 * Downloads the `playwright-results-history` artifact from the last N nightly
 * runs and reports, per test, how often it was flaky (failed, then passed on
 * retry) and how often it failed outright.
 *
 * Why this exists: a flaky test makes the run *green*, so nothing in CI output
 * records it. The nightly failure report is only written when the run fails, so
 * the flake signal was discarded on exactly the runs that carried it (DEV-1414).
 *
 * Why it does not tell you what to fix: a single run's evidence is close to
 * worthless — roughly 170 reruns are needed for 95% confidence that a *passing*
 * test is not flaky. Read this as a ranking to investigate, never as a verdict,
 * and never as a quarantine list. Classifying tests by history is how suites end
 * up hiding real regressions: on Chromium's CI, flaky-test prediction at 99.2%
 * precision would still have dropped ~76% of genuine fault-revealing failures.
 *
 * Usage:
 *   node scripts/flake-report.mjs [--runs 20] [--json]
 *   node scripts/flake-report.mjs --dir <path>   # aggregate already-downloaded JSONs
 *
 * The `gh` CLI (authenticated) is required unless --dir is used.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const WORKFLOW = 'e2e-nightly.yml'
const ARTIFACT = 'playwright-results-history'

const args = process.argv.slice(2)
const runLimit = Number(valueOf('--runs') ?? 20)
const asJson = args.includes('--json')

function valueOf(flag) {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}

function gh(cliArgs, options = {}) {
  return execFileSync('gh', cliArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options })
}

/** Walk Playwright's nested suite tree; `file` is only set on the outer suite. */
function collectResults(node, inheritedFile, out) {
  for (const spec of node.specs ?? []) {
    for (const test of spec.tests ?? []) {
      out.push({
        file: node.file ?? inheritedFile ?? '(unknown)',
        title: spec.title,
        statuses: (test.results ?? []).map((result) => result.status),
      })
    }
  }
  for (const child of node.suites ?? []) {
    collectResults(child, node.file ?? inheritedFile, out)
  }
}

function classify(statuses) {
  if (statuses.length === 0) return 'empty'
  const last = statuses[statuses.length - 1]
  if (last === 'skipped') return 'skipped'
  // Playwright's own definition: failed at least once, passed on a retry.
  if (statuses.length > 1 && last === 'passed' && statuses.slice(0, -1).some((s) => s !== 'passed')) {
    return 'flaky'
  }
  return last === 'passed' ? 'passed' : 'failed'
}

const stats = new Map()
let runsParsed = 0

/** Fold one run's report into the running tally. Returns false if it had no tests. */
function tally(reportPath, label) {
  let report
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'))
  } catch {
    console.error(`  ! unparseable results in ${label}; skipping`)
    return false
  }

  const results = []
  for (const suite of report.suites ?? []) collectResults(suite, null, results)
  if (results.length === 0) return false

  for (const { file: specFile, title, statuses } of results) {
    const key = `${specFile} › ${title}`
    const entry = stats.get(key) ?? { runs: 0, flaky: 0, failed: 0 }
    entry.runs += 1
    const verdict = classify(statuses)
    if (verdict === 'flaky') entry.flaky += 1
    if (verdict === 'failed') entry.failed += 1
    stats.set(key, entry)
  }
  return true
}

const localDir = valueOf('--dir')
if (localDir) {
  // Recursive so it accepts an unzipped `gh run download` tree as-is.
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return walk(path)
      return entry.name.endsWith('.json') ? [path] : []
    })
  for (const path of walk(localDir)) {
    if (tally(path, path)) runsParsed += 1
  }
} else {
  let runIds
  try {
    runIds = JSON.parse(
      gh(['run', 'list', '--workflow', WORKFLOW, '--limit', String(runLimit), '--json', 'databaseId,conclusion,createdAt']),
    )
  } catch (error) {
    console.error(`Could not list workflow runs. Is \`gh\` authenticated?\n${error.message}`)
    process.exit(1)
  }

  const workDir = mkdtempSync(join(tmpdir(), 'flake-report-'))
  try {
    for (const run of runIds) {
      const target = join(workDir, String(run.databaseId))
      try {
        gh(['run', 'download', String(run.databaseId), '-n', ARTIFACT, '-D', target], { stdio: 'ignore' })
      } catch {
        // Runs from before this artifact existed, or expired. Expected; skip.
        continue
      }
      const file = readdirSync(target).find((name) => name.endsWith('.json'))
      if (file && tally(join(target, file), `run ${run.databaseId}`)) runsParsed += 1
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

if (runsParsed === 0) {
  console.error(
    `No runs with a \`${ARTIFACT}\` artifact were found in the last ${runLimit} runs of ${WORKFLOW}.\n` +
      'If this is the first run after enabling it, wait for a nightly and try again.',
  )
  process.exit(1)
}

const ranked = [...stats.entries()]
  .map(([test, entry]) => ({
    test,
    ...entry,
    flakeRate: entry.flaky / entry.runs,
    failRate: entry.failed / entry.runs,
  }))
  .filter((row) => row.flaky > 0 || row.failed > 0)
  .sort((a, b) => b.flakeRate - a.flakeRate || b.failRate - a.failRate)

if (asJson) {
  console.log(JSON.stringify({ runsParsed, tests: ranked }, null, 2))
  process.exit(0)
}

console.log(`\nFlake history — ${runsParsed} nightly run(s) with results, ${stats.size} distinct tests\n`)
if (ranked.length === 0) {
  console.log('  No test failed or flaked in the sampled runs.')
} else {
  const width = Math.min(96, Math.max(...ranked.map((row) => row.test.length)))
  console.log(`  ${'TEST'.padEnd(width)}  FLAKY   FAILED`)
  for (const row of ranked) {
    const label = row.test.length > width ? `${row.test.slice(0, width - 1)}…` : row.test.padEnd(width)
    console.log(
      `  ${label}  ${String(row.flaky).padStart(2)}/${row.runs}   ${String(row.failed).padStart(2)}/${row.runs}`,
    )
  }
}
console.log(
  '\n  A ranking to investigate, not a verdict — see docs/testing/e2e-triage.md.' +
    '\n  Fix or delete. Do not quarantine by flake history.\n',
)
