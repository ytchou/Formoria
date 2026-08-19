"use client";

import * as Sentry from "@sentry/nextjs";
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
    // Loaded lazily: a static `posthog-js` import here put the ~230KB
    // analytics vendor chunk in the first load of all 65 routes, because the
    // global error boundary is part of every route's client entry. Fire and
    // forget — this runs while the app is already broken, so nothing in the
    // analytics path may throw or block Sentry's report above.
    void import("posthog-js")
      .then(({ default: posthog }) => {
        if (posthog.__loaded) posthog.captureException(error);
      })
      .catch(() => undefined);
  }, [error]);

  return (
    <html lang={locale}>
      <body className="min-h-screen bg-background text-foreground">
        <main className="page-gutter mx-auto flex min-h-screen page-measure flex-col items-center justify-center py-24 text-center">
          <h1 className="type-page-title">{copy.title}</h1>
          <p className="mt-3 type-body-sm">{copy.description}</p>
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
