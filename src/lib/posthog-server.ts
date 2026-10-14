import { PostHog } from 'posthog-node'
import { after } from 'next/server'
import { auditedCall } from '@/lib/audit'

let posthogClient: PostHog | null = null
const SERVER_EVENT_TIMEOUT_MS = 2_000

function getPostHogClient(): PostHog {
  if (!posthogClient) {
    posthogClient = new PostHog(
      process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!,
      {
        host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
        flushAt: 1,
        flushInterval: 0,
        enableExceptionAutocapture: true,
        requestTimeout: SERVER_EVENT_TIMEOUT_MS,
        fetchRetryCount: 0,
      },
    )
  }

  return posthogClient
}

type ServerEvent = {
  distinctId: string
  event: string
  properties: Record<string, unknown>
  identifyProperties?: Record<string, unknown>
}

/**
 * Captures and flushes one event, awaited. Never throws. For callers outside a
 * Next request (operator scripts), where `after()` is unavailable; inside a
 * request use `captureServerEvent`, which keeps the flush off the response path.
 */
export async function captureServerEventNow(input: ServerEvent): Promise<void> {
  try {
    await auditedCall(
      { provider: 'posthog', operation: 'capture_event', kind: 'external' },
      async (ctx) => {
        const posthog = getPostHogClient()
        if (input.identifyProperties) {
          posthog.identify({
            distinctId: input.distinctId,
            properties: input.identifyProperties,
          })
        }
        posthog.capture({
          distinctId: input.distinctId,
          event: input.event,
          properties: input.properties,
        })
        await posthog.flush()
        ctx.summary.response = { flushed: true }
      },
      { summary: { request: input } },
    )
  } catch (error) {
    console.error(`[analytics:${input.event}] capture failed`, error)
  }
}

export function captureServerEvent(input: ServerEvent): void {
  try {
    after(() => captureServerEventNow(input))
  } catch (error) {
    console.error(`[analytics:${input.event}] scheduling failed`, error)
  }
}
