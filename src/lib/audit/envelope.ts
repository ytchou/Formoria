import { randomUUID } from "node:crypto";
import { classifyThrownError } from "@/lib/retry";
import { emitAuditRecord } from "./emit";
import { getAuditContext, newCorrelationId } from "./context";
import type { AuditSpec, AuditStatus } from "./types";

/**
 * Handed to `fn` so a call can attach fields it only learns while running --
 * content type, byte length, a truncation flag, a record count.
 *
 * CONTRACT
 * - `ctx.summary` starts empty and is merged OVER the base summary
 *   (`spec.meta` + `options.summary` + `attempt`) on the TERMINAL row only.
 * - The `started` row never sees it: at span open those fields are not known
 *   yet, and a started row must describe the world as of span open.
 * - It is read once, synchronously, immediately before the terminal row is
 *   emitted, so mutating it during `fn` is the supported usage. Mutating it
 *   after `fn` settles has no effect.
 * - `ctx.summary` is the ONLY supported way to attach a field discovered during
 *   `fn`. Mutating the object passed as `options.summary` is not: the envelope
 *   shallow-copies it at span open (so a new top-level key added during `fn` is
 *   lost outright), and `emitAuditRecord` deep-snapshots each row as it is
 *   emitted (so a nested mutation lands on neither the started row nor,
 *   reliably, the terminal one).
 */
export type AuditCallContext = {
  summary: Record<string, unknown>;
  promptTokens?: number | null;
  completionTokens?: number | null;
  costUsd?: number | null;
};

export type AuditedCallOptions<T> = {
  classify?: (result: T) => AuditStatus;
  summary?: Record<string, unknown>;
  subjectId?: string | null;
  jobId?: string | null;
  logTag?: string | null;
  wait?: (ms: number) => Promise<void>;
};

type AuditCommon = {
  spanId: string;
  correlationId: string;
  causationId: string | null;
  kind: AuditSpec["kind"];
  provider: string;
  operation: string;
  retryAttempt: number | null;
  subjectId: string | null;
  jobId: string | null;
  logTag: string | null;
};

/** Providers whose LLM calls are recorded as Langfuse generations in llm-audit.ts. */
const LLM_PROVIDERS = ["openai", "deepseek"];

/**
 * Fire-and-forget Langfuse span for external non-LLM calls.
 * Must never throw -- all errors are swallowed.
 */
function emitLangfuseSpan(
  common: AuditCommon,
  startedAt: number,
  latencyMs: number,
  statusMessage: string,
): void {
  try {
    const trace = getAuditContext().langfuseTrace;
    if (trace && common.kind === "external" && !LLM_PROVIDERS.includes(common.provider)) {
      const langfuseTrace = trace as { span: (input: Record<string, unknown>) => void };
      langfuseTrace.span({
        name: `${common.provider}/${common.operation}`,
        startTime: new Date(startedAt),
        endTime: new Date(startedAt + latencyMs),
        statusMessage,
        metadata: { provider: common.provider },
      });
    }
  } catch {
    // Langfuse errors must never block production
  }
}

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
  fn: (ctx: AuditCallContext) => T | Promise<T>,
  options: AuditedCallOptions<T> = {},
): Promise<T> {
  const spanId = spec.spanId ?? randomUUID();
  const context = getAuditContext();
  const correlationId = context.correlationId ?? newCorrelationId();
  const baseSummary = {
    ...spec.meta,
    ...options.summary,
    ...(spec.attempt === undefined ? {} : { attempt: spec.attempt }),
  };
  const common: AuditCommon = {
    spanId,
    correlationId,
    causationId: spec.causationId ?? null,
    kind: spec.kind,
    provider: spec.provider,
    operation: spec.operation,
    retryAttempt: spec.retryAttempt ?? null,
    subjectId: options.subjectId ?? null,
    jobId: options.jobId ?? null,
    logTag: options.logTag ?? null,
  };
  const callContext: AuditCallContext = { summary: {} };

  // A dropped start row must not stop the call it was about to record. The
  // catch is empty on purpose: emitAuditRecord already counts the loss and
  // alerts once per process, so there is nothing left to do here but proceed.
  //
  // KNOWN CEILING (bounded, DEV-1349): this AWAITS the emit, so outside a Next
  // request scope -- where `after()` is unavailable and the write runs inline --
  // an unavailable audit DB still adds latency to the call being audited. That
  // cost is now capped at the emitter's INLINE_BUDGET_MS wall clock rather than
  // the full retry backoff; past it the record is dropped and counted. Remaining
  // upgrade path if the loss counter goes sustained non-zero: a bounded
  // in-process queue that drains asynchronously, with a flush on shutdown.
  try {
    await emitAuditRecord(
      { ...common, status: "started", summary: baseSummary },
      options.wait,
    );
  } catch {
    // Deliberately swallowed -- see above.
  }

  return runAfterStart<T>(common, baseSummary, callContext, fn, options);
}

async function runAfterStart<T>(
  common: AuditCommon,
  baseSummary: Record<string, unknown>,
  callContext: AuditCallContext,
  fn: (ctx: AuditCallContext) => T | Promise<T>,
  options: AuditedCallOptions<T>,
): Promise<T> {
  const startedAt = Date.now();
  // Read once, at emit time, so fields attached late by `fn` reach the
  // terminal row -- and only the terminal row.
  const finishSummary = (): Record<string, unknown> => ({
    ...baseSummary,
    ...callContext.summary,
  });

  try {
    const result = await fn(callContext);
    const latencyMs = Math.max(0, Date.now() - startedAt);
    const status = options.classify?.(result) ?? "succeeded";

    // Langfuse span first -- fire-and-forget observability must survive an
    // audit-write failure (Finding 5).
    emitLangfuseSpan(common, startedAt, latencyMs, status);

    try {
      await emitAuditRecord({
        ...common,
        status,
        latencyMs,
        summary: finishSummary(),
        promptTokens: callContext.promptTokens,
        completionTokens: callContext.completionTokens,
        costUsd: callContext.costUsd,
      }, options.wait);
    } catch {
      return result;
    }

    return result;
  } catch (error) {
    const latencyMs = Math.max(0, Date.now() - startedAt);

    // Langfuse span first -- fire-and-forget observability must survive an
    // audit-write failure (Finding 5).
    emitLangfuseSpan(common, startedAt, latencyMs, "failed");

    try {
      await emitAuditRecord({
        ...common,
        status: thrownStatus(error),
        latencyMs,
        summary: finishSummary(),
        errorMessage: errorMessage(error),
        promptTokens: callContext.promptTokens,
        completionTokens: callContext.completionTokens,
        costUsd: callContext.costUsd,
      }, options.wait);
    } catch {
      return Promise.reject(error);
    }

    throw error;
  }
}
