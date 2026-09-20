/**
 * Claude token detector — when optional issuance metadata is configured,
 * warns 30 days before the one-year anniversary.
 *
 * No outbound HTTP call — pure environment check.
 */

import { stableFingerprint, type HealthFinding } from '../contracts'
import type { Detector, DetectorContext } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Env = Record<string, string | undefined>

function getEnv(ctx: DetectorContext): Env {
  return (ctx.deps.env as Env | undefined) ?? {}
}

function getNow(ctx: DetectorContext): () => number {
  return (ctx.deps.now as (() => number) | undefined) ?? (() => Date.now())
}

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export const claudeTokenDetector: Detector = {
  name: 'claude-token',
  source: 'credential',
  schedule: 'nightly',
  severity: 'high',

  async run(ctx: DetectorContext): Promise<HealthFinding[]> {
    const env = getEnv(ctx)
    const issuedAt = env.CLAUDE_TOKEN_ISSUED_AT
    if (!issuedAt) return []

    const now = getNow(ctx)()

    const issuedDate = new Date(issuedAt).getTime()
    if (Number.isNaN(issuedDate)) {
      return [
        {
          source: 'credential',
          fingerprint: stableFingerprint('credential', 'claude-token', 'invalid-date'),
          title: `Claude token CLAUDE_TOKEN_ISSUED_AT is not a valid date: "${issuedAt}"`,
          severity: 'high',
          evidence: { rawValue: issuedAt },
          mergePolicy: 'human',
        },
      ]
    }

    const expiresAt = issuedDate + ONE_YEAR_MS
    const daysUntilExpiry = Math.floor((expiresAt - now) / (24 * 60 * 60 * 1000))

    if (now >= expiresAt) {
      return [
        {
          source: 'credential',
          fingerprint: stableFingerprint('credential', 'claude-token', 'expired'),
          title: `Claude token expired ${Math.abs(daysUntilExpiry)} days ago`,
          severity: 'high',
          evidence: { issuedAt, expiresAt: new Date(expiresAt).toISOString(), daysOverdue: Math.abs(daysUntilExpiry) },
          mergePolicy: 'human',
        },
      ]
    }

    if (expiresAt - now <= THIRTY_DAYS_MS) {
      return [
        {
          source: 'credential',
          fingerprint: stableFingerprint('credential', 'claude-token', 'expiring-soon'),
          title: `Claude token expires in ${daysUntilExpiry} days`,
          severity: 'medium',
          evidence: { issuedAt, expiresAt: new Date(expiresAt).toISOString(), daysRemaining: daysUntilExpiry },
          mergePolicy: 'human',
        },
      ]
    }

    return []
  },
}
