export interface PostHogProvider {
  capture(event: string, properties?: Record<string, unknown>): void
  identify(distinctId: string, setProperties?: Record<string, unknown>): void
  /**
   * Optional so existing test doubles (and any provider that predates super
   * properties) still satisfy the interface.
   */
  register?(properties: Record<string, unknown>): void
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
    && process.env.NEXT_PUBLIC_DEPLOYMENT_ENV !== 'staging'
    && Boolean(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN)
    && process.env.NEXT_PUBLIC_POSTHOG_HOST === 'https://e.formoria.com'
  )
}

let provider: PostHogProvider | null = null
let identifiedUserId: string | null = null
let identifiedUserProperties: Record<string, unknown> | undefined
let resetBeforeRegistration = false
let superProperties: Record<string, unknown> | null = null
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
  // Replayed before the buffered captures so those events inherit the super
  // properties, exactly as they would have if the provider had existed first.
  if (superProperties) {
    try {
      nextProvider.register?.(superProperties)
    } catch {
      // Analytics must never affect app behavior.
    }
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

/**
 * Registers super properties that PostHog attaches to every subsequent event.
 * Calls merge, so registering `locale` later never drops an earlier key, and the
 * accumulated set is replayed onto whichever provider registers next.
 */
export function registerPostHogSuperProperties(
  properties: Record<string, unknown>,
): void {
  superProperties = { ...superProperties, ...properties }
  try {
    provider?.register?.(properties)
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
    // `reset()` clears posthog-js super properties along with the identity, but
    // these describe the device/session (locale), not the user — without this
    // re-apply every post-sign-out event silently falls back to the fragile
    // pathname locale inference. The locale effect is keyed on [locale] and so
    // will not re-fire on sign-out to repair it.
    if (superProperties) provider.register?.(superProperties)
  } catch {
    // Analytics must never affect app behavior.
  }
}

export function clearPostHogProviderForTests(): void {
  provider = null
  identifiedUserId = null
  identifiedUserProperties = undefined
  resetBeforeRegistration = false
  superProperties = null
  pendingCaptures.length = 0
}
