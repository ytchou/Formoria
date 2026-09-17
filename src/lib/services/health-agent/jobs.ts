/**
 * Health agent job definitions — the commands dispatched to the repo worker.
 *
 * Each entry describes the commands, scope, and validation for one kind of
 * health repair job. The definitions are pure data: no I/O, no side effects.
 *
 * Provider: claude-code (already registered in audit providers).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HealthJobCommand = {
  id: string
  run: string
  timeoutMs: number
}

export type HealthJobDefinition = {
  name: string
  source: string
  commands: HealthJobCommand[]
  /** For jobs that produce findings where certain kinds are report-only. */
  dependencyDisposition?: 'report_only'
  /** Validation commands run after a repair to verify correctness. */
  validationCommands?: string[]
  /** Provider for Claude Code CLI integration. */
  provider?: string
}

// ---------------------------------------------------------------------------
// Timeouts
// ---------------------------------------------------------------------------

const VITEST_TIMEOUT_MS = 180_000
const KNIP_TIMEOUT_MS = 120_000
const KNIP_FIX_TIMEOUT_MS = 120_000
const MDX_LINKS_TIMEOUT_MS = 60_000
const _LINT_TIMEOUT_MS = 60_000
const _TSC_TIMEOUT_MS = 120_000

// ---------------------------------------------------------------------------
// Job definitions
// ---------------------------------------------------------------------------

export const HEALTH_JOBS: Record<string, HealthJobDefinition> = {
  vitest: {
    name: 'vitest',
    source: 'quality',
    commands: [
      {
        id: 'vitest',
        run: 'pnpm exec vitest run --reporter=json --outputFile=vitest-report.json',
        timeoutMs: VITEST_TIMEOUT_MS,
      },
    ],
  },

  knip: {
    name: 'knip',
    source: 'quality',
    dependencyDisposition: 'report_only',
    commands: [
      {
        id: 'knip',
        run: 'pnpm exec knip --reporter json',
        timeoutMs: KNIP_TIMEOUT_MS,
      },
    ],
  },

  'knip-fix': {
    name: 'knip-fix',
    source: 'quality',
    commands: [
      {
        id: 'knip-fix',
        run: 'pnpm exec knip --fix --fix-type exports,files --allow-remove-files --reporter json',
        timeoutMs: KNIP_FIX_TIMEOUT_MS,
      },
    ],
    validationCommands: [
      'pnpm lint',
      'pnpm exec tsc --noEmit',
      'pnpm exec vitest run --changed',
    ],
  },

  'mdx-links': {
    name: 'mdx-links',
    source: 'quality',
    commands: [
      {
        id: 'mdx-links',
        run: 'find content/stories content/trails -name "*.mdx" -exec grep -hoE "https?://[^)\"\\s]+" {} + | sort -u',
        timeoutMs: MDX_LINKS_TIMEOUT_MS,
      },
    ],
  },

  investigate: {
    name: 'investigate',
    source: 'quality',
    provider: 'claude-code',
    commands: [],
  },
}
