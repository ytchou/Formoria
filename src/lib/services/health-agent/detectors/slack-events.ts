/**
 * Slack Events API detector — posts a url_verification challenge and
 * verifies the challenge is echoed back.
 *
 * Pattern: Slack's Events API requires a signed POST with
 * `{ type: "url_verification", challenge: "<random>" }`. The endpoint
 * must respond with `{ challenge: "<same>" }`.
 */

import { randomUUID } from 'node:crypto'
import { auditedCall } from '@/lib/audit'
import { stableFingerprint, type HealthFinding } from '../contracts'
import type { Detector, DetectorContext } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Env = Record<string, string | undefined>
type FetchFn = typeof fetch
type ComputeSlackSignature = (secret: string, timestamp: string, body: string) => string

function getEnv(ctx: DetectorContext): Env {
  return (ctx.deps.env as Env | undefined) ?? {}
}

function getFetch(ctx: DetectorContext): FetchFn {
  return (ctx.deps.fetch as FetchFn | undefined) ?? fetch
}

function getComputeSlackSignature(ctx: DetectorContext): ComputeSlackSignature | null {
  return (ctx.deps.computeSlackSignature as ComputeSlackSignature | undefined) ?? null
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export const slackEventsDetector: Detector = {
  name: 'slack-events',
  source: 'credential',
  schedule: 'nightly',
  severity: 'high',

  async run(ctx: DetectorContext): Promise<HealthFinding[]> {
    const env = getEnv(ctx)
    const signingSecret = env.SLACK_SIGNING_SECRET
    const eventsUrl = env.SLACK_EVENTS_URL
    if (!signingSecret || !eventsUrl) return []

    const fetchFn = getFetch(ctx)
    const computeSig = getComputeSlackSignature(ctx)
    if (!computeSig) return []

    const challenge = randomUUID()
    const body = JSON.stringify({
      type: 'url_verification',
      challenge,
      token: 'health-probe',
    })

    const timestamp = Math.floor(Date.now() / 1000).toString()
    const signature = computeSig(signingSecret, timestamp, body)

    const response = await auditedCall(
      {
        provider: 'health-agent',
        operation: 'probe_slack_events',
        kind: 'external',
        meta: { endpoint: eventsUrl, method: 'POST' },
      },
      async () => {
        return fetchFn(eventsUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-slack-signature': signature,
            'x-slack-request-timestamp': timestamp,
          },
          body,
          signal: ctx.signal,
        })
      },
    )

    if (!response.ok) {
      return [
        {
          source: 'credential',
          fingerprint: stableFingerprint('credential', 'slack-events', 'url-verification'),
          title: `Slack Events url_verification failed: HTTP ${response.status}`,
          severity: 'high',
          evidence: { status: response.status, eventsUrl },
          mergePolicy: 'human',
        },
      ]
    }

    const responseBody = (await response.json()) as { challenge?: string }
    if (responseBody.challenge !== challenge) {
      return [
        {
          source: 'credential',
          fingerprint: stableFingerprint('credential', 'slack-events', 'url-verification'),
          title: 'Slack Events url_verification challenge not echoed',
          severity: 'high',
          evidence: {
            expected: challenge,
            received: responseBody.challenge ?? null,
          },
          mergePolicy: 'human',
        },
      ]
    }

    return []
  },
}
