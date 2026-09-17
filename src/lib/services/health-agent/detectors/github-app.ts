/**
 * GitHub App credential detector — verifies that an installation token
 * can be minted and that it has Dependabot alerts read permission.
 */

import { auditedCall } from '@/lib/audit'
import { stableFingerprint, type HealthFinding } from '../contracts'
import type { Detector, DetectorContext } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Env = Record<string, string | undefined>
type FetchFn = typeof fetch
type SignJwt = (payload: Record<string, unknown>, key: string, opts: { algorithm: string }) => string

function getEnv(ctx: DetectorContext): Env {
  return (ctx.deps.env as Env | undefined) ?? {}
}

function getFetch(ctx: DetectorContext): FetchFn {
  return (ctx.deps.fetch as FetchFn | undefined) ?? fetch
}

function getSignJwt(ctx: DetectorContext): SignJwt | null {
  return (ctx.deps.signJwt as SignJwt | undefined) ?? null
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export const githubAppDetector: Detector = {
  name: 'github-app',
  source: 'credential',
  schedule: 'nightly',
  severity: 'high',

  async run(ctx: DetectorContext): Promise<HealthFinding[]> {
    const env = getEnv(ctx)
    const appId = env.GITHUB_APP_ID
    const privateKey = env.GITHUB_APP_PRIVATE_KEY
    const installationId = env.GITHUB_APP_INSTALLATION_ID
    if (!appId || !privateKey || !installationId) return []

    const fetchFn = getFetch(ctx)
    const signJwt = getSignJwt(ctx)
    if (!signJwt) return []

    // Step 1: Mint an installation token
    const jwt = signJwt(
      {
        iss: appId,
        iat: Math.floor(Date.now() / 1000) - 60,
        exp: Math.floor(Date.now() / 1000) + 600,
      },
      privateKey,
      { algorithm: 'RS256' },
    )

    const tokenUrl = `https://api.github.com/app/installations/${installationId}/access_tokens`
    const tokenResponse = await auditedCall(
      {
        provider: 'health-agent',
        operation: 'probe_github_app',
        kind: 'external',
        meta: { endpoint: tokenUrl, method: 'POST', step: 'mint_token' },
      },
      async () => {
        return fetchFn(tokenUrl, {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${jwt}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
          signal: ctx.signal,
        })
      },
    )

    if (!tokenResponse.ok) {
      return [
        {
          source: 'credential',
          fingerprint: stableFingerprint('credential', 'github-app', 'installation-token'),
          title: `GitHub App installation token minting failed: HTTP ${tokenResponse.status}`,
          severity: 'high',
          evidence: { status: tokenResponse.status, installationId },
          mergePolicy: 'human',
        },
      ]
    }

    const tokenBody = (await tokenResponse.json()) as { token?: string }
    if (!tokenBody.token) {
      return [
        {
          source: 'credential',
          fingerprint: stableFingerprint('credential', 'github-app', 'installation-token'),
          title: 'GitHub App installation token minting returned no token',
          severity: 'high',
          evidence: { installationId },
          mergePolicy: 'human',
        },
      ]
    }

    // Step 2: Check Dependabot alerts read permission
    const owner = env.GITHUB_OWNER ?? 'formoria'
    const repo = env.GITHUB_REPO ?? 'formoria'
    const alertsUrl = `https://api.github.com/repos/${owner}/${repo}/dependabot/alerts?per_page=1`
    const alertsResponse = await auditedCall(
      {
        provider: 'health-agent',
        operation: 'probe_github_app',
        kind: 'external',
        meta: { endpoint: alertsUrl, method: 'GET', step: 'check_dependabot' },
      },
      async () => {
        return fetchFn(alertsUrl, {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${tokenBody.token}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
          signal: ctx.signal,
        })
      },
    )

    if (!alertsResponse.ok) {
      return [
        {
          source: 'credential',
          fingerprint: stableFingerprint('credential', 'github-app', 'dependabot-alerts'),
          title: `GitHub App lacks Dependabot alerts read: HTTP ${alertsResponse.status}`,
          severity: 'high',
          evidence: { status: alertsResponse.status },
          mergePolicy: 'human',
        },
      ]
    }

    return []
  },
}
