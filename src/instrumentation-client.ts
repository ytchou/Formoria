// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { isPostHogConfigured } from '@/lib/analytics/posthog-provider';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Add optional integrations for additional features
  integrations: [Sentry.replayIntegration()],

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

  beforeSend(event) {
    if (event.user) {
      delete event.user.email;
      delete event.user.ip_address;
    }

    return event;
  },
});

if (isPostHogConfigured()) {
  void import('@/lib/analytics/posthog-client')
    .then(({ initializePostHog }) => initializePostHog())
    .catch(() => undefined)
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
