// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

const isEn = typeof window !== 'undefined' && window.location.pathname.startsWith('/en')

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Add optional integrations for additional features
  integrations: [
    Sentry.replayIntegration(),
    Sentry.feedbackIntegration({
      colorScheme: 'light',
      themeLight: {
        background: '#FAF8F3',
        submitBackground: '#C4693B',
        submitBackgroundHover: '#A85A30',
        inputOutlineColor: '#E5E0D8',
      },
      triggerLabel: isEn ? 'Report Issue' : '回報問題',
      formTitle: isEn ? 'Report Issue' : '回報問題',
      nameLabel: isEn ? 'Name' : '姓名',
      namePlaceholder: isEn ? 'Your name' : '你的名字',
      emailLabel: isEn ? 'Email' : '電子信箱',
      emailPlaceholder: 'you@example.com',
      messageLabel: isEn ? 'Description' : '問題描述',
      messagePlaceholder: isEn ? 'Describe the issue you encountered' : '請描述你遇到的問題',
      submitButtonLabel: isEn ? 'Submit' : '送出',
      cancelButtonLabel: isEn ? 'Cancel' : '取消',
      addScreenshotButtonLabel: isEn ? 'Add screenshot' : '新增截圖',
      removeScreenshotButtonLabel: isEn ? 'Remove screenshot' : '移除截圖',
      successMessageText: isEn ? 'Thank you for your report!' : '感謝你的回報！',
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
