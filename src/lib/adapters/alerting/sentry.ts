import * as Sentry from "@sentry/node";

/**
 * Sentry adapter for background alerting.
 *
 * The curation worker is a one-shot Railway cron process
 * (`Dockerfile.curation-worker`, `tsx src/curation-worker/server.ts`) that
 * drains the queue and exits. It never loads Next's instrumentation hook, so
 * `sentry.server.config.ts` never runs there. This adapter therefore
 * self-initializes when no client is present, and piggybacks on the existing
 * client when it is (the Next runtime). `captureAlert` only queues an event;
 * a process about to exit must `await flushAlerts()` first or lose it.
 *
 * It imports `@sentry/node`, not `@sentry/nextjs`. Under ESM (the workers run
 * with `"type":"module"`), `@sentry/nextjs` resolves to a CJS build whose
 * re-exported Node API is invisible to the ESM namespace, so `getClient`,
 * `flush`, and `captureException` were undefined (DEV-1920). Both packages
 * share one global client, so in the Next runtime this still reuses the client
 * `sentry.server.config.ts` initialized. Keep `@sentry/node` pinned to the
 * exact version `@sentry/nextjs` depends on, or the clients diverge.
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

/**
 * Drains queued Sentry events before a short-lived process exits. Never
 * throws; resolves true when there is nothing to flush or the flush finished
 * within `timeoutMs`.
 */
export async function flushAlerts(timeoutMs = 2_000): Promise<boolean> {
  try {
    if (!Sentry.getClient()) {
      return true;
    }
    return await Sentry.flush(timeoutMs);
  } catch {
    return false;
  }
}
