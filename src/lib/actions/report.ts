import * as Sentry from "@sentry/nextjs";

export function reportAndReturn<T>(error: unknown, result: T): T {
  Sentry.captureException(error, { tags: { layer: "server-action" } });
  return result;
}
