// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs'

type PostgrestContext = {
  code: string
  message: string | null
  details: string | null
  hint: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null
}

export function extractPostgrestContext(error: unknown): PostgrestContext | null {
  let current = error

  for (let depth = 0; depth < 5; depth += 1) {
    if (!isRecord(current)) {
      return null
    }

    if (
      typeof current.code === 'string'
      && /^PGRST/.test(current.code)
      && isNullableString(current.message)
      && isNullableString(current.details)
      && isNullableString(current.hint)
    ) {
      return {
        code: current.code,
        message: current.message,
        details: current.details,
        hint: current.hint,
      }
    }

    current = current.cause
  }

  return null
}

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 0.1,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: false,

  beforeSend(event, hint) {
    const postgrestContext = extractPostgrestContext(hint.originalException);
    if (postgrestContext) {
      event.contexts = {
        ...event.contexts,
        postgrest: {
          ...event.contexts?.postgrest,
          ...postgrestContext,
        },
      }
    }

    if (event.user) {
      delete event.user.email
      delete event.user.ip_address
    }

    return event
  },
})
