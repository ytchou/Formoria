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

  // Injected by iOS in-app browsers (WKWebView hosts such as LINE, Facebook and
  // Instagram), not by this app — `sendDataToNative` / `sendPageHideMessage`
  // appear in no source file here. The host's own bridge script throws when it
  // reaches for `window.webkit.messageHandlers` on a page it does not own.
  // Unfixable from our side and it buries real story-page errors (DEV-1340 /
  // FORMORIA-5F). Kept narrow so a genuine `undefined is not an object` still
  // reports.
  ignoreErrors: [
    "undefined is not an object (evaluating 'window.webkit.messageHandlers')",
  ],

  // GA4 collect endpoints the gtag bundle calls. Ad blockers cancel those
  // requests, and the resulting `TypeError: Failed to fetch` (Chrome) /
  // `TypeError: Load failed` (Safari) is noise, not a defect (DEV-1550).
  // Filtered by host only: both messages are the generic browser wording for
  // ANY blocked fetch, so an `ignoreErrors` string would silence real
  // same-origin failures site-wide — and silently, since a filter drops events
  // without a trace.
  denyUrls: [
    "analytics.google.com",
    "region1.analytics.google.com",
  ],

  beforeSend(event: Sentry.ErrorEvent) {
    if (event.user) {
      delete event.user.email;
      delete event.user.ip_address;
    }

    return event;
  },
};
