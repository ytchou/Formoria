import { describe, expect, it } from 'vitest'
import type { DetectorContext } from '../../types'
import { githubAppDetector } from '../github-app'

function makeCtx(
  deps: Record<string, unknown> = {},
): DetectorContext {
  return {
    date: '2026-09-17',
    deadline: Date.now() + 30_000,
    signal: new AbortController().signal,
    dryRun: false,
    deps,
  }
}

describe('github-app detector', () => {
  it('fails when an installation token cannot be minted', async () => {
    const fakeFetch = async () =>
      new Response(JSON.stringify({ message: 'Bad credentials' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })

    const ctx = makeCtx({
      fetch: fakeFetch,
      env: {
        GITHUB_APP_ID: '12345',
        GITHUB_APP_PRIVATE_KEY: 'fake-private-key',
        GITHUB_APP_INSTALLATION_ID: '67890',
      },
      signJwt: () => 'fake-jwt',
    })
    const findings = await githubAppDetector.run(ctx)

    expect(findings.length).toBeGreaterThanOrEqual(1)
    expect(findings[0].title).toMatch(/installation token/i)
    expect(findings[0].severity).toBe('high')
  })

  it('fails when the token lacks Dependabot alerts read permission', async () => {
    const fakeFetch = async (url: string) => {
      if (typeof url === 'string' && url.includes('installation')) {
        // Token minting succeeds
        return new Response(
          JSON.stringify({ token: 'ghs_test', expires_at: '2026-09-18T00:00:00Z' }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        )
      }
      // Dependabot alerts endpoint returns 403
      return new Response(JSON.stringify({ message: 'Resource not accessible' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const ctx = makeCtx({
      fetch: fakeFetch,
      env: {
        GITHUB_APP_ID: '12345',
        GITHUB_APP_PRIVATE_KEY: 'fake-private-key',
        GITHUB_APP_INSTALLATION_ID: '67890',
      },
      signJwt: () => 'fake-jwt',
    })
    const findings = await githubAppDetector.run(ctx)

    expect(findings.length).toBeGreaterThanOrEqual(1)
    expect(findings.some((f) => f.title.match(/dependabot/i))).toBe(true)
  })

  it('returns no findings when token and permissions are valid', async () => {
    const fakeFetch = async (url: string) => {
      if (typeof url === 'string' && url.includes('installation')) {
        return new Response(
          JSON.stringify({ token: 'ghs_test', expires_at: '2026-09-18T00:00:00Z' }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        )
      }
      // Dependabot alerts endpoint succeeds
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const ctx = makeCtx({
      fetch: fakeFetch,
      env: {
        GITHUB_APP_ID: '12345',
        GITHUB_APP_PRIVATE_KEY: 'fake-private-key',
        GITHUB_APP_INSTALLATION_ID: '67890',
      },
      signJwt: () => 'fake-jwt',
    })
    const findings = await githubAppDetector.run(ctx)
    expect(findings).toHaveLength(0)
  })

  it('returns no findings when not configured', async () => {
    const ctx = makeCtx({ env: {} })
    const findings = await githubAppDetector.run(ctx)
    expect(findings).toHaveLength(0)
  })
})
