"use client";

import * as Sentry from "@sentry/nextjs";
import posthog from "posthog-js";
import { useEffect, useSyncExternalStore } from "react";
import { Button } from '@/components/ui/button';
import en from '../../messages/en.json';
import zhTW from '../../messages/zh-TW.json';
import './globals.css';

function getBrowserLocale() {
  if (document.documentElement.lang === 'en' || window.location.pathname.startsWith('/en')) {
    return 'en' as const;
  }
  return 'zh-TW' as const;
}

function subscribeToLocale() {
  return () => undefined;
}

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  const locale = useSyncExternalStore(subscribeToLocale, getBrowserLocale, () => 'zh-TW');
  const copy = locale === 'en' ? en.errors.boundary : zhTW.errors.boundary;

  useEffect(() => {
    Sentry.captureException(error);
    posthog.captureException(error);
  }, [error]);

  return (
    <html lang={locale} data-feedback-copy={JSON.stringify(locale === 'en' ? en.feedbackWidget : zhTW.feedbackWidget)}>
      <body className="min-h-screen bg-background text-foreground">
        <main className="page-gutter mx-auto flex min-h-screen max-w-screen-xl flex-col items-center justify-center py-24 text-center">
          <h1 className="type-page-title-large">{copy.title}</h1>
          <p className="mt-3 type-card-description">{copy.description}</p>
          <Button
            type="button"
            variant="primary"
            className="mt-6"
            onClick={() => window.location.reload()}
          >
            {copy.retry}
          </Button>
        </main>
      </body>
    </html>
  );
}
