// The client Sentry options, kept in their own module so a test can read them
// without importing `instrumentation-client.ts`, whose module load calls
// `Sentry.init` and installs global browser handlers.

import type { BrowserOptions } from "@sentry/nextjs";
import {
  isLocalRequestUrl,
  resolveSentryEnvironment,
} from "@/lib/observability/sentry-environment";

export const clientSentryOptions = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Resolved from the `NEXT_PUBLIC_RAILWAY_ENVIRONMENT_NAME` that
  // `next.config.ts` inlines into this bundle. Without it the SDK would fall
  // back to `NODE_ENV` and tag a local `next start` as production (DEV-1561).
  environment: resolveSentryEnvironment(),

  // Error capture and tracing stay enabled; recording the whole session does
  // not justify putting Replay and rrweb on every visitor's critical path.
  integrations: [],

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1,
  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Session replay is disabled, including error sessions. Error events and
  // their normal breadcrumbs still report through Sentry.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: false,

  // Matched against the exception VALUE (and `type: value`), not the URL:
  // `ignoreErrors` runs through `getPossibleEventMessages`, which reads
  // `event.exception.values[last].value`. String entries are a substring test,
  // RegExp entries a `.test()` (@sentry/core `utils/string.js`
  // `isMatchingPattern`).
  //
  // Do NOT re-add `denyUrls` for the GA entries. `_isDeniedUrl` matches
  // `_getEventFilterUrl`, which returns the last valid STACK-FRAME filename --
  // never the destination of the failed request. On the real production events
  // (FORMORIA-6H) the frames are the gtag bundle and a browser extension, so a
  // GA hostname appears in no frame and the filter fired never.
  //
  // 1. Injected by iOS in-app browsers (WKWebView hosts such as LINE, Facebook
  //    and Instagram), not by this app -- `sendDataToNative` /
  //    `sendPageHideMessage` appear in no source file here. The host's own
  //    bridge script throws when it reaches for `window.webkit.messageHandlers`
  //    on a page it does not own. Unfixable from our side and it buries real
  //    story-page errors (DEV-1340 / FORMORIA-5F). Kept narrow so a genuine
  //    `undefined is not an object` still reports.
  // 2. GA4 collect requests cancelled by ad blockers (DEV-1550). The browser
  //    SDK appends the destination host in parentheses when it can attribute
  //    the fetch, so the pattern is anchored on that host and on the closing
  //    paren. A BARE `Failed to fetch` / `Load failed` must keep reporting:
  //    `Load failed` is Safari's generic wording for any failed fetch and one
  //    real unrelated issue (FORMORIA-6T) is exactly that.
  ignoreErrors: [
    "undefined is not an object (evaluating 'window.webkit.messageHandlers')",
    /(?:Failed to fetch|Load failed) \((?:[\w-]+\.)*analytics\.google\.com\)/,
  ],

  beforeSend(event) {
    if (isLocalRequestUrl(event.request?.url)) {
      return null;
    }

    if (event.user) {
      delete event.user.email;
      delete event.user.ip_address;
    }

    return event;
  },
} satisfies BrowserOptions;
