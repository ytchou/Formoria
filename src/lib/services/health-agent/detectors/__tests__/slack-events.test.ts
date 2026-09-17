import { describe, expect, it } from 'vitest'
import type { DetectorContext } from '../../types'
import { slackEventsDetector } from '../slack-events'

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

describe('slack-events detector', () => {
  it('posts a correctly signed url_verification and fails when the challenge is not echoed', async () => {
    const requests: { url: string; body: string; headers: Record<string, string> }[] = []

    const fakeFetch = async (url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : ''
      const headers = init?.headers as Record<string, string> ?? {}
      requests.push({ url: url as string, body, headers })
      // Return a response that does NOT echo the challenge
      return new Response(JSON.stringify({ wrong_field: 'not-the-challenge' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const ctx = makeCtx({
      fetch: fakeFetch,
      env: {
        SLACK_SIGNING_SECRET: 'test-signing-secret',
        SLACK_EVENTS_URL: 'https://example.com/api/slack/events',
      },
      computeSlackSignature: (_secret: string, _timestamp: string, _body: string) =>
        'v0=fake_signature',
    })

    const findings = await slackEventsDetector.run(ctx)

    // Should have made a request
    expect(requests).toHaveLength(1)
    // Should contain url_verification type
    const sentBody = JSON.parse(requests[0].body)
    expect(sentBody.type).toBe('url_verification')
    expect(sentBody.challenge).toBeDefined()
    // Request should have Slack signature headers
    expect(requests[0].headers['x-slack-signature']).toBeDefined()
    expect(requests[0].headers['x-slack-request-timestamp']).toBeDefined()

    // Should fail because challenge was not echoed
    expect(findings).toHaveLength(1)
    expect(findings[0].title).toMatch(/challenge/i)
  })

  it('returns no findings when the challenge is correctly echoed', async () => {
    let sentChallenge = ''
    const fakeFetch = async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
      sentChallenge = body.challenge
      return new Response(JSON.stringify({ challenge: sentChallenge }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const ctx = makeCtx({
      fetch: fakeFetch,
      env: {
        SLACK_SIGNING_SECRET: 'test-signing-secret',
        SLACK_EVENTS_URL: 'https://example.com/api/slack/events',
      },
      computeSlackSignature: () => 'v0=fake_signature',
    })

    const findings = await slackEventsDetector.run(ctx)
    expect(findings).toHaveLength(0)
  })

  it('returns no findings when not configured', async () => {
    const ctx = makeCtx({ env: {} })
    const findings = await slackEventsDetector.run(ctx)
    expect(findings).toHaveLength(0)
  })
})
