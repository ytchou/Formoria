export interface PostHogProvider {
  capture(event: string, properties?: Record<string, unknown>): void
  identify(distinctId: string, setProperties?: Record<string, unknown>): void
  reset(): void
}

type PendingCapture = { event: string; properties?: Record<string, unknown> }

/**
 * Single source of truth for whether a PostHog provider can ever be registered.
 * `instrumentation-client.ts` gates initialization on this, and consumers that
 * would otherwise fill the pending-capture buffer for nothing check the same
 * function instead of re-deriving the preconditions and drifting from them.
 */
export function isPostHogConfigured(): boolean {
  return (
    process.env.NODE_ENV === 'production'
    && Boolean(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN)
    && process.env.NEXT_PUBLIC_POSTHOG_HOST === 'https://e.formoria.com'
  )
}

let provider: PostHogProvider | null = null
let identifiedUserId: string | null = null
let identifiedUserProperties: Record<string, unknown> | undefined
let resetBeforeRegistration = false
const pendingCaptures: PendingCapture[] = []
const MAX_PENDING_CAPTURES = 50

export function registerPostHogProvider(nextProvider: PostHogProvider): void {
  provider = nextProvider
  if (resetBeforeRegistration) {
    try {
      provider.reset()
    } catch {
      // Analytics must never affect app behavior.
    }
    resetBeforeRegistration = false
  }
  for (const pending of pendingCaptures.splice(0)) {
    try {
      provider.capture(pending.event, pending.properties)
    } catch {
      // Analytics must never affect app behavior.
    }
  }
  try {
    if (identifiedUserId) provider.identify(identifiedUserId, identifiedUserProperties)
  } catch {
    // Analytics must never affect app behavior.
  }
}

export function capturePostHogEvent(
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (!provider) {
    pendingCaptures.push({ event, properties })
    if (pendingCaptures.length > MAX_PENDING_CAPTURES) pendingCaptures.shift()
    return
  }
  try {
    provider.capture(event, properties)
  } catch {
    // Analytics must never affect app behavior.
  }
}

export function identifyPostHogUser(
  distinctId: string,
  setProperties?: Record<string, unknown>,
): void {
  identifiedUserId = distinctId
  identifiedUserProperties = setProperties
  try {
    provider?.identify(distinctId, setProperties)
  } catch {
    // Analytics must never affect app behavior.
  }
}

/**
 * Clears the identity. `finalEvent` is the last event belonging to the session
 * being ended (e.g. `user_signed_out`); it is emitted as part of the reset so it
 * cannot be dropped by the buffer wipe below.
 */
export function resetPostHogUser(finalEvent?: PendingCapture): void {
  identifiedUserId = null
  identifiedUserProperties = undefined
  if (!provider) {
    // Drop the ending session's buffered events so they are never replayed under
    // a post-reset identity — but keep `finalEvent`, which registration replays
    // after `provider.reset()`.
    pendingCaptures.length = 0
    if (finalEvent) pendingCaptures.push(finalEvent)
    resetBeforeRegistration = true
    return
  }
  try {
    // Captured before the reset so it is still attributed to the ending session.
    if (finalEvent) provider.capture(finalEvent.event, finalEvent.properties)
    provider.reset()
  } catch {
    // Analytics must never affect app behavior.
  }
}

export function clearPostHogProviderForTests(): void {
  provider = null
  identifiedUserId = null
  identifiedUserProperties = undefined
  resetBeforeRegistration = false
  pendingCaptures.length = 0
}
