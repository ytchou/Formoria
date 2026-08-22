// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { isPostHogConfigured } from '@/lib/analytics/posthog-provider';
import { clientSentryOptions } from './instrumentation-client.options';

Sentry.init(clientSentryOptions);

if (isPostHogConfigured()) {
  void import('@/lib/analytics/posthog-client')
    .then(({ initializePostHog }) => initializePostHog())
    .catch(() => undefined)
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
