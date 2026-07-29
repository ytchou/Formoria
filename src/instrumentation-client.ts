// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

const feedbackCopy = (() => {
  if (typeof document === 'undefined') return {}
  const serialized = document.documentElement.dataset.feedbackCopy
  if (!serialized) return {}

  try {
    return JSON.parse(serialized) as Record<string, string>
  } catch {
    return {}
  }
})()

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Add optional integrations for additional features
  integrations: [
    Sentry.replayIntegration(),
    Sentry.feedbackIntegration({
      colorScheme: 'light',
      themeLight: {
        background: '#FDFCFA',
        submitBackground: '#C04A24',
        submitBackgroundHover: '#A33D1E',
        inputOutlineColor: '#E8E5E0',
      },
      ...feedbackCopy,
    }),
  ],

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 1,
  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Define how likely Replay events are sampled.
  // This sets the sample rate to be 10%. You may want this to be 100% while
  // in development and sample at a lower rate in production
  replaysSessionSampleRate: 0.1,

  // Define how likely Replay events are sampled when an error occurs.
  replaysOnErrorSampleRate: 1.0,

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: false,

  beforeSend(event) {
    if (event.user) {
      delete event.user.email;
      delete event.user.ip_address;
    }

    return event;
  },
});

if (
  process.env.NODE_ENV === 'production'
  && process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
  && process.env.NEXT_PUBLIC_POSTHOG_HOST === 'https://e.formoria.com'
) {
  void import('@/lib/analytics/posthog-client')
    .then(({ initializePostHog }) => initializePostHog())
    .catch(() => undefined)
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
