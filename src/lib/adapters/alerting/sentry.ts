import * as Sentry from "@sentry/nextjs";

/**
 * Sentry adapter for background alerting.
 *
 * The curation worker is a separate container (`Dockerfile.curation-worker`)
 * that runs `tsx src/curation-worker/server.ts` — it never loads Next's
 * instrumentation hook, so `sentry.server.config.ts` never runs there. This
 * adapter therefore self-initializes when no client is present, and piggybacks
 * on the existing client when it is (the Next runtime).
 *
 * `@sentry/nextjs` re-exports the Node SDK on the server, so no `@sentry/node`
 * dependency is needed.
 */

export type AlertLevel = "error" | "warning";

export type AlertContext = Record<string, string | number | boolean | null>;

let initAttempted = false;
let missingDsnWarned = false;

function dsn(): string | undefined {
  const value =
    process.env.SENTRY_DSN?.trim() ||
    process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
  return value ? value : undefined;
}

/**
 * Returns true when a Sentry client is available. Initializes one lazily in
 * plain Node processes (the worker); no-ops when the DSN is unset.
 */
function ensureClient(): boolean {
  if (Sentry.getClient()) {
    return true;
  }

  if (initAttempted) {
    return Boolean(Sentry.getClient());
  }
  initAttempted = true;

  const value = dsn();
  if (!value) {
    if (!missingDsnWarned) {
      missingDsnWarned = true;
      console.warn(
        "[alerting:sentry] No SENTRY_DSN/NEXT_PUBLIC_SENTRY_DSN set — Sentry alerts are disabled",
      );
    }
    return false;
  }

  Sentry.init({
    dsn: value,
    enabled: true,
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });

  return Boolean(Sentry.getClient());
}

/** Reports a message to Sentry. Never throws; returns whether it was sent. */
export function captureAlert(
  message: string,
  options: { level?: AlertLevel; context?: AlertContext; error?: unknown } = {},
): boolean {
  if (!ensureClient()) {
    return false;
  }

  const scopeContext = options.context ?? {};
  Sentry.withScope((scope) => {
    scope.setLevel(options.level ?? "error");
    scope.setContext("curation", scopeContext);
    if (options.error !== undefined) {
      scope.setExtra("alertMessage", message);
      Sentry.captureException(options.error);
      return;
    }
    Sentry.captureMessage(message);
  });

  return true;
}

/** Test seam: forget the lazy-init decision. */
export function resetSentryAdapterForTests(): void {
  initAttempted = false;
  missingDsnWarned = false;
}
