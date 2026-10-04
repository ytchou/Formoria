// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs'
import {
  isLocalRequestUrl,
  resolveSentryEnvironment,
} from '@/lib/observability/sentry-environment'

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

// Supabase fronts PostgREST with Cloudflare. When the origin saturates,
// PostgREST returns no JSON body at all — `error.message` carries a whole
// Cloudflare error page. Service code interpolates that into its own message
// (`Failed to fetch event <slug>: <!DOCTYPE html>...`), so the issue title,
// the grouping and the event payload are all the HTML page rather than the
// failure. The page also embeds a Ray ID, a timestamp and a client IP, so
// every occurrence is a slightly different string.
//
// Collapse the markup to the one fact it carries — the upstream status — and
// keep the caller's prefix, which is what makes the issue identifiable.
const HTML_ERROR_BODY = /<!DOCTYPE html>[\s\S]*$/i
const HTML_ERROR_TITLE = /<title>([^<]{0,200})<\/title>/i

export function summarizeUpstreamHtmlError(message: string): string {
  const body = HTML_ERROR_BODY.exec(message)
  if (!body) {
    return message
  }

  const title = HTML_ERROR_TITLE.exec(body[0])?.[1]?.trim()
  const summary = title
    ? `<upstream HTML error response: ${title}>`
    : '<upstream HTML error response>'

  return `${message.slice(0, body.index)}${summary}`
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

// Next.js throws this by design when a POST carries an action id the running
// build does not have: a tab opened before a deploy, or a bot replaying an old
// form (DEV-1927). The id-less wording is the no-JS form path (E975), where
// `deploymentId` skew protection cannot help because no client router runs.
// A real visitor on the JS path still reports through the browser SDK as
// `UnrecognizedActionError`, so dropping the server copy loses no user signal.
// Anchored on Next's own wording so an unrelated action failure keeps reporting.
export const SERVER_ACTION_SKEW =
  /^Failed to find Server Action(?: "[^"]+")?\. This request might be from an older or newer deployment\./

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: process.env.NODE_ENV === 'production',

  // Never let `NODE_ENV` name the environment: a local `next build` +
  // `next start` sets it to 'production' (DEV-1561).
  environment: resolveSentryEnvironment(),

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 0.1,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: false,

  ignoreErrors: [SERVER_ACTION_SKEW],

  beforeSend(event, hint) {
    // Second net. A correctly tagged local event is still noise in a
    // production project, and the request URL survives the prod-parity
    // harness even when every other value looks deployed.
    if (isLocalRequestUrl(event.request?.url)) {
      return null
    }

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

    for (const exception of event.exception?.values ?? []) {
      if (typeof exception.value === 'string') {
        exception.value = summarizeUpstreamHtmlError(exception.value)
      }
    }

    if (typeof event.message === 'string') {
      event.message = summarizeUpstreamHtmlError(event.message)
    }

    if (event.user) {
      delete event.user.email
      delete event.user.ip_address
    }

    return event
  },
})
