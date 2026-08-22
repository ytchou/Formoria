// The client Sentry options, kept in their own module so a test can read them
// without importing `instrumentation-client.ts`, whose module load calls
// `Sentry.init` and installs global browser handlers.

import * as Sentry from "@sentry/nextjs";

export const clientSentryOptions = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // `replayIntegration` exists only in the browser build of `@sentry/nextjs`.
  // This module is imported by a node-environment test, where evaluating it at
  // module scope throws and the suite collects zero tests. The array form is
  // merged into the defaults by `Sentry.init`, so the browser behavior here is
  // unchanged and the node case simply contributes nothing.
  integrations: Sentry.replayIntegration ? [Sentry.replayIntegration()] : [],

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1,
  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Session replay is disabled: recording 10% of all sessions burns the Sentry
  // quota on a pre-launch site. On-error replay below keeps the high-value half.
  // Raise this once quota headroom is known.
  replaysSessionSampleRate: 0,

  // Define how likely Replay events are sampled when an error occurs.
  replaysOnErrorSampleRate: 1.0,

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
    if (event.user) {
      delete event.user.email;
      delete event.user.ip_address;
    }

    return event;
  },
} satisfies Sentry.BrowserOptions;
