"use client";

import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
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
    <html lang="zh-TW">
      <body>
        {/* `NextError` is the default Next.js error page component. Its type
        definition requires a `statusCode` prop. However, since the App Router
        does not expose status codes for errors, we simply pass 0 to render a
        generic error message. */}
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
