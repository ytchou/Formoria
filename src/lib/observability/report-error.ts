import * as Sentry from "@sentry/nextjs";

/**
 * The application's error-reporting port. This is the only module outside
 * `src/instrumentation*` that imports `@sentry/nextjs`; every call site reports
 * through here so the provider can change without touching business code.
 *
 * Safe in client components, server code and the edge runtime: no
 * `server-only`, no Node APIs.
 *
 * Errors thrown by the provider propagate unchanged. Call sites that must
 * survive a provider failure (the Sentry canary, the rate-limiter alarm)
 * already wrap their own call.
 */

export type ReportLevel = "fatal" | "error" | "warning" | "info" | "debug";

export interface ReportOptions {
  /** Shorthand for the `area` tag; merged over `tags`. */
  area?: string;
  tags?: Record<string, string | number | boolean>;
  level?: ReportLevel;
  extra?: Record<string, unknown>;
  /** Grouping key: events with the same fingerprint group into one issue. */
  fingerprint?: string[];
  /** Named structured context blocks attached to the event. */
  contexts?: Record<string, Record<string, unknown>>;
}

type CaptureContext = {
  tags?: Record<string, string | number | boolean>;
  level?: ReportLevel;
  extra?: Record<string, unknown>;
  fingerprint?: string[];
  contexts?: Record<string, Record<string, unknown>>;
};

/**
 * Builds the provider capture context from only the fields the caller set, so
 * a call with no options reaches the provider with no second argument and the
 * event payload matches a direct SDK call exactly.
 */
function toCaptureContext(options: ReportOptions | undefined): CaptureContext | undefined {
  if (!options) return undefined;
  const { area, tags, level, extra, fingerprint, contexts } = options;
  const context: CaptureContext = {};
  if (tags !== undefined || area !== undefined) {
    context.tags = area === undefined ? { ...tags } : { ...tags, area };
  }
  if (level !== undefined) context.level = level;
  if (extra !== undefined) context.extra = extra;
  if (fingerprint !== undefined) context.fingerprint = fingerprint;
  if (contexts !== undefined) context.contexts = contexts;
  return Object.keys(context).length === 0 ? undefined : context;
}

export function reportError(err: unknown, options?: ReportOptions): void {
  const context = toCaptureContext(options);
  if (context === undefined) {
    Sentry.captureException(err);
  } else {
    Sentry.captureException(err, context);
  }
}

export function reportMessage(message: string, options?: ReportOptions): void {
  const context = toCaptureContext(options);
  if (context === undefined) {
    Sentry.captureMessage(message);
  } else {
    Sentry.captureMessage(message, context);
  }
}

export function setReportContext(name: string, context: Record<string, unknown> | null): void {
  Sentry.setContext(name, context);
}

/** Whether a reporting client is initialised in this runtime. */
export function isReportingEnabled(): boolean {
  return Boolean(Sentry.getClient());
}
