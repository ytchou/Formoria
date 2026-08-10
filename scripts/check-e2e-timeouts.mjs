#!/usr/bin/env node
/**
 * Timeout census and gate for the e2e suite.
 *
 * Two jobs:
 *
 *   --snapshot            write the census to e2e/timeout-baseline.json
 *   (no flag, i.e. CI)    assert the census still matches, and enforce the gate
 *
 * The census records the *effective milliseconds* of every wait in the suite,
 * with `BUDGET`/`POLL` names resolved to their values. That makes the otherwise
 * unreviewable question "did this refactor make any test wait longer?"
 * mechanically answerable, which is what lets the budget migration land in small
 * behaviour-neutral commits instead of one unreviewable diff.
 *
 * The gate exists because raising a timeout was the default repair here and the
 * rule against it bound only the nightly self-heal agent: its prompt forbids
 * raising timeouts and its review step rejects any diff that does, while every
 * timeout raise in this repo's history was human-authored. See e2e/TRIAGE.md.
 *
 * This parses `e2e/budgets.ts` as *text* — a .mjs script cannot import
 * TypeScript. That is why budgets.ts is required to stay flat `as const`
 * literals: anything computed would silently drop out of the census.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const BUDGETS_FILE = 'e2e/budgets.ts'
const BASELINE_FILE = 'e2e/timeout-baseline.json'
const SCAN_ROOT = 'e2e'
const TRIAGE_DOC = 'e2e/TRIAGE.md'

/** The single hard sleep with no readiness signal to replace it: proving a popup did NOT open. */
const WAIT_FOR_TIMEOUT_ALLOWLIST = new Set(['e2e/tests/brand-share.spec.ts'])

const args = process.argv.slice(2)
const snapshotMode = args.includes('--snapshot')

// ---------------------------------------------------------------- budgets

/** Resolve `BUDGET.X`, `BUDGET.TEST.X`, `POLL.X.timeout` to numbers by parsing budgets.ts. */
function loadBudgetSymbols() {
  const source = readFileSync(BUDGETS_FILE, 'utf8')
  const symbols = new Map()
  const polls = new Map()

  const num = (raw) => Number(raw.replace(/_/g, ''))

  // Flat `NAME: 5_000,` entries, and the nested TEST block.
  let scope = 'BUDGET'
  for (const line of source.split('\n')) {
    if (/^\s*TEST:\s*\{/.test(line)) scope = 'BUDGET.TEST'
    else if (/^\s*\},\s*$/.test(line) && scope === 'BUDGET.TEST') scope = 'BUDGET'

    const flat = line.match(/^\s*([A-Z_]+):\s*(\d[\d_]*),/)
    if (flat) symbols.set(`${scope}.${flat[1]}`, num(flat[2]))

    const poll = line.match(
      /^\s*([A-Z_]+):\s*\{\s*timeout:\s*(\d[\d_]*),\s*intervals:\s*\[([\d_,\s]+)\]\s*\}/,
    )
    if (poll) {
      polls.set(`POLL.${poll[1]}`, {
        timeout: num(poll[2]),
        intervals: poll[3].split(',').map((v) => num(v.trim())).filter((v) => !Number.isNaN(v)),
      })
    }
  }

  if (symbols.size === 0) {
    throw new Error(`Parsed no budgets from ${BUDGETS_FILE}. Did its shape change?`)
  }
  return { symbols, polls }
}

// ---------------------------------------------------------------- scanning

function specFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return path.includes('node_modules') ? [] : specFiles(path)
    // budgets.ts is where the numbers are *defined*; counting its literals as
    // usage sites would make adding a named budget look like adding a bare one.
    if (path === BUDGETS_FILE) return []
    return /\.ts$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : []
  })
}

/**
 * Strip `//` line comments so prose like "// Increase timeout: fooAction is slow"
 * is not scanned as code. `://` is spared so URLs inside strings survive.
 */
function stripLineComment(line) {
  const index = line.search(/(^|[^:])\/\//)
  if (index === -1) return line
  return line.slice(0, line.indexOf('//', index))
}

/** TypeScript type positions — `timeout: number` declares a parameter, it is not a wait. */
const TYPE_NAMES = new Set(['number', 'string', 'boolean', 'any', 'undefined', 'never'])

/** A numeric literal, or a BUDGET/POLL reference. Anything else is unresolved on purpose. */
function resolveExpression(raw, { symbols, polls }) {
  const expr = raw.trim()

  if (/^\d[\d_]*$/.test(expr)) {
    return { ms: Number(expr.replace(/_/g, '')), literal: true }
  }
  if (symbols.has(expr)) return { ms: symbols.get(expr), literal: false }

  const pollTimeout = expr.match(/^(POLL\.[A-Z_]+)\.timeout$/)
  if (pollTimeout && polls.has(pollTimeout[1])) {
    return { ms: polls.get(pollTimeout[1]).timeout, literal: false }
  }
  if (polls.has(expr)) {
    const entry = polls.get(expr)
    return { ms: entry.timeout, intervals: entry.intervals, literal: false }
  }
  return { unresolved: true, expr }
}

function scan(budgets) {
  const sites = []
  for (const file of specFiles(SCAN_ROOT)) {
    const rel = relative('.', file)
    const lines = readFileSync(file, 'utf8').split('\n')

    lines.forEach((rawLine, index) => {
      const lineNo = index + 1
      const previous = lines[index - 1] ?? ''
      const measured = /\/\/\s*measured:/.test(previous) || /\/\/\s*measured:/.test(rawLine)
      const line = stripLineComment(rawLine)

      const record = (kind, rawExpr, extra = {}) => {
        if (TYPE_NAMES.has(rawExpr.trim())) return
        const resolved = resolveExpression(rawExpr, budgets)
        sites.push({ file: rel, line: lineNo, kind, measured, ...resolved, ...extra })
      }

      // Inline poll ladders, e.g. `{ timeout: 60_000, intervals: [3_000, ...] }`.
      // Recorded even though they are not a `POLL.*` reference: the ladder is the
      // silent-flake vector, and a census that only saw named ladders would have
      // left every inline one unprotected — which is exactly the hole that let a
      // fold-to-POLL report as a ladder change when nothing had changed.
      const inlineLadder = line.match(/intervals:\s*\[([\d_,\s]+)\]/)
      if (inlineLadder) {
        const intervals = inlineLadder[1]
          .split(',')
          .map((value) => Number(value.trim().replace(/_/g, '')))
          .filter((value) => !Number.isNaN(value))
        sites.push({ file: rel, line: lineNo, kind: 'ladder', intervals, measured })
      }

      for (const match of line.matchAll(/\btimeout:\s*([A-Za-z0-9_.]+)/g)) {
        record('timeout', match[1])
      }
      for (const match of line.matchAll(/\btest\.setTimeout\(\s*([A-Za-z0-9_.]+)\s*\)/g)) {
        record('setTimeout', match[1])
      }
      for (const match of line.matchAll(/\.toPass\(\s*([A-Za-z0-9_.]+)\s*\)/g)) {
        record('toPass', match[1])
      }
      for (const match of line.matchAll(/\bwaitForTimeout\(\s*(\d[\d_]*)\s*\)/g)) {
        record('waitForTimeout', match[1])
      }
      // A bare toPass() inherits a timeout of 0 and retries until the test dies.
      if (/\.toPass\(\s*\)/.test(line)) {
        sites.push({ file: rel, line: lineNo, kind: 'toPass', unresolved: true, expr: '(bare)', measured })
      }
    })
  }
  return sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
}

// ---------------------------------------------------------------- run

let budgets
try {
  budgets = loadBudgetSymbols()
} catch (error) {
  console.error(`✖ ${error.message}`)
  process.exit(1)
}

const sites = scan(budgets)
// `measured` is kept in the census: the comparison below counts unjustified bare
// numbers, so both sides must agree on what counts as justified.
const census = sites

if (snapshotMode) {
  writeFileSync(BASELINE_FILE, `${JSON.stringify({ version: 1, sites: census }, null, 2)}\n`)
  const unresolved = census.filter((s) => s.unresolved).length
  console.log(
    `Wrote ${BASELINE_FILE}: ${census.length} sites` +
      (unresolved ? `, ${unresolved} unresolved (recorded; no new ones may be added)` : ''),
  )
  process.exit(0)
}

if (!existsSync(BASELINE_FILE)) {
  console.error(`✖ ${BASELINE_FILE} is missing. Run: node scripts/check-e2e-timeouts.mjs --snapshot`)
  process.exit(1)
}

const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))

/**
 * Compare per file, not per line.
 *
 * Line numbers are not stable identities: inserting one line above a spec's
 * assertions renumbers every site below it, so a line-keyed baseline reports a
 * whole file as "new" on any edit. That is noise, and noise in a gate gets the
 * gate switched off. Per-file aggregates are insertion-robust and still answer
 * the only question that matters: did this file gain a longer wait, a new bare
 * number, or a new thing the census cannot see?
 */
function summarize(entries) {
  const byFile = new Map()
  for (const site of entries) {
    const summary = byFile.get(site.file) ?? {
      waits: [],
      literals: 0,
      unresolved: 0,
      ladders: [],
    }
    if (typeof site.ms === 'number') summary.waits.push(site.ms)
    if (site.literal && !site.measured) summary.literals += 1
    if (site.unresolved) summary.unresolved += 1
    if (site.intervals) summary.ladders.push(JSON.stringify(site.intervals))
    byFile.set(site.file, summary)
  }
  for (const summary of byFile.values()) {
    summary.waits.sort((a, b) => b - a)
    summary.ladders.sort()
  }
  return byFile
}

const before = summarize(baseline.sites)
const after = summarize(sites)
const problems = []

for (const [file, now] of after) {
  const was = before.get(file) ?? { waits: [], literals: 0, unresolved: 0, ladders: [] }

  // 1. Nothing may get longer. Both lists descending: if the nth-longest wait in
  //    this file is longer than it used to be, something was raised.
  for (let i = 0; i < now.waits.length; i += 1) {
    const previous = was.waits[i] ?? 0
    if (now.waits[i] > previous) {
      problems.push(
        `${file}: a wait was raised (${previous || 'none'}ms -> ${now.waits[i]}ms). ` +
          `A raise is a claim about product latency, not about the test — ${TRIAGE_DOC} step 6. ` +
          `If it is justified, re-run --snapshot and link the measurement in the commit.`,
      )
      break
    }
  }

  // 2. No new bare numbers.
  if (now.literals > was.literals) {
    problems.push(
      `${file}: ${now.literals - was.literals} new bare numeric timeout(s). ` +
        `Use a name from ${BUDGETS_FILE}, or justify each with a \`// measured: <run url>\` comment above it.`,
    )
  }

  // 3. Nothing new the census cannot resolve — otherwise rule 1 has a blind spot.
  if (now.unresolved > was.unresolved) {
    problems.push(
      `${file}: ${now.unresolved - was.unresolved} new timeout(s) this script cannot resolve statically. ` +
        `Use a name from ${BUDGETS_FILE} so the value stays auditable.`,
    )
  }

  // 4. Poll ladders are the silent-flake vector: same ceiling, later first retry,
  //    misses a window that closes early. Changed ladders get their own commit.
  if (JSON.stringify(now.ladders) !== JSON.stringify(was.ladders)) {
    problems.push(
      `${file}: a poll ladder changed (${was.ladders.join(' ') || 'none'} -> ${now.ladders.join(' ') || 'none'}). ` +
        `Change ladders in their own commit, never alongside a ceiling.`,
    )
  }
}

// 5. Hard sleeps, allowlisted only where no readiness signal can exist.
for (const site of sites) {
  if (site.kind === 'waitForTimeout' && !WAIT_FOR_TIMEOUT_ALLOWLIST.has(site.file)) {
    problems.push(
      `${site.file}:${site.line} uses waitForTimeout. Wait for a condition instead — ${TRIAGE_DOC} step 7.`,
    )
  }
}

if (problems.length > 0) {
  console.error(`✖ e2e timeout gate: ${problems.length} problem(s)\n`)
  for (const problem of problems) console.error(`  - ${problem}`)
  console.error(
    `\n  If a wait genuinely needs to be longer, that is a claim about product latency, not\n` +
      `  about the test. Measure it, link the run, and say so. See ${TRIAGE_DOC}.\n`,
  )
  process.exit(1)
}

console.log(`e2e timeout gate passed (${census.length} sites).`)
