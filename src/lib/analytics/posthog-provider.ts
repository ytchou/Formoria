export interface PostHogProvider {
  capture(event: string, properties?: Record<string, unknown>): void
  identify(distinctId: string, setProperties?: Record<string, unknown>): void
  reset(): void
}

let provider: PostHogProvider | null = null
let identifiedUserId: string | null = null
let identifiedUserProperties: Record<string, unknown> | undefined
let resetBeforeRegistration = false
const pendingCaptures: Array<{ event: string; properties?: Record<string, unknown> }> = []
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

export function resetPostHogUser(): void {
  identifiedUserId = null
  identifiedUserProperties = undefined
  pendingCaptures.length = 0
  if (!provider) {
    resetBeforeRegistration = true
    return
  }
  try {
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
