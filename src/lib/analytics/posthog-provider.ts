export interface PostHogProvider {
  capture(event: string, properties?: Record<string, unknown>): void
  identify(distinctId: string): void
  reset(): void
}

let provider: PostHogProvider | null = null
let identifiedUserId: string | null = null
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
    if (identifiedUserId) provider.identify(identifiedUserId)
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

export function identifyPostHogUser(distinctId: string): void {
  identifiedUserId = distinctId
  try {
    provider?.identify(distinctId)
  } catch {
    // Analytics must never affect app behavior.
  }
}

export function resetPostHogUser(): void {
  identifiedUserId = null
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
  resetBeforeRegistration = false
  pendingCaptures.length = 0
}
