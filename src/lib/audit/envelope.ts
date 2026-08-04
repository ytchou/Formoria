import { randomUUID } from "node:crypto";
import { classifyThrownError } from "@/lib/retry";
import { emitAuditRecord } from "./emit";
import { getAuditContext, newCorrelationId } from "./context";
import type { AuditSpec, AuditStatus } from "./types";

export type AuditedCallOptions<T> = {
  classify?: (result: T) => AuditStatus;
  summary?: Record<string, unknown>;
  subjectId?: string | null;
  jobId?: string | null;
  logTag?: string | null;
  wait?: (ms: number) => Promise<void>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function thrownStatus(error: unknown): AuditStatus {
  const reason = classifyThrownError(error).reason;
  if (reason === "timeout") return "timeout";
  if (reason === "network") return "network_error";
  return "failed";
}

export async function auditedCall<T>(
  spec: AuditSpec,
  fn: () => T | Promise<T>,
  options: AuditedCallOptions<T> = {},
): Promise<T> {
  const spanId = spec.spanId ?? randomUUID();
  const context = getAuditContext();
  const correlationId = context.correlationId ?? newCorrelationId();
  const summary = {
    ...spec.meta,
    ...options.summary,
    ...(spec.attempt === undefined ? {} : { attempt: spec.attempt }),
  };
  const common = {
    spanId,
    correlationId,
    causationId: spec.causationId ?? null,
    kind: spec.kind,
    provider: spec.provider,
    operation: spec.operation,
    retryAttempt: spec.retryAttempt ?? null,
    subjectId: options.subjectId ?? null,
    jobId: options.jobId ?? null,
    summary,
    logTag: options.logTag ?? null,
  };

  // A dropped start row must not stop the call it was about to record. The
  // catch is empty on purpose: emitAuditRecord already counts the loss and
  // alerts once per process, so there is nothing left to do here but proceed.
  try {
    await emitAuditRecord({ ...common, status: "started" }, options.wait);
  } catch {
    // Deliberately swallowed -- see above.
  }

  return runAfterStart<T>(common, fn, options);
}

async function runAfterStart<T>(
  common: Omit<Parameters<typeof emitAuditRecord>[0], "status" | "latencyMs" | "errorMessage">,
  fn: () => T | Promise<T>,
  options: AuditedCallOptions<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    try {
      await emitAuditRecord({
        ...common,
        status: options.classify?.(result) ?? "succeeded",
        latencyMs: Math.max(0, Date.now() - startedAt),
      }, options.wait);
    } catch {
      return result;
    }
    return result;
  } catch (error) {
    try {
      await emitAuditRecord({
        ...common,
        status: thrownStatus(error),
        latencyMs: Math.max(0, Date.now() - startedAt),
        errorMessage: errorMessage(error),
      }, options.wait);
    } catch {
      return Promise.reject(error);
    }
    throw error;
  }
}
