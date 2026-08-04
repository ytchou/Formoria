import { captureAlert } from "@/lib/adapters/alerting/sentry";
import {
  classifyPostgrestError,
  IN_PROCESS,
  withRetry,
} from "@/lib/retry";
import type { Json } from "@/lib/supabase/database.types";
import { redact } from "./redact";
import type { AuditKind, AuditStatus } from "./types";

export type AuditRecord = {
  spanId: string;
  correlationId: string;
  causationId?: string | null;
  kind: AuditKind;
  status: AuditStatus;
  provider: string;
  operation: string;
  latencyMs?: number | null;
  retryAttempt?: number | null;
  subjectId?: string | null;
  jobId?: string | null;
  summary?: Record<string, unknown> | null;
  errorMessage?: string | null;
  logTag?: string | null;
};

export type AuditWriteError = { code?: string; message: string };
export type AuditWriteSeam = (record: AuditRecord) => Promise<AuditWriteError | null>;

let injectedSeam: AuditWriteSeam | null = null;
let lossCount = 0;
let lossAlertReported = false;

const defaultWait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function defaultAuditWrite(record: AuditRecord): Promise<AuditWriteError | null> {
  if (!record.correlationId) {
    return { message: "Audit record is missing correlationId" };
  }

  const { createServiceClient } = await import("@/lib/supabase/server");
  const { error } = await createServiceClient()
    .from("external_call_audit")
    .insert({
      span_id: record.spanId,
      correlation_id: record.correlationId,
      causation_id: record.causationId ?? null,
      kind: record.kind,
      status: record.status,
      provider: record.provider,
      operation: record.operation,
      latency_ms: record.latencyMs ?? null,
      retry_attempt: record.retryAttempt ?? null,
      subject_id: record.subjectId ?? null,
      job_id: record.jobId ?? null,
      summary: redact(record.summary) as Json,
      error_message: record.errorMessage ?? null,
    });

  return error ? { code: error.code, message: error.message } : null;
}

async function writeWithRetry(
  record: AuditRecord,
  wait: (ms: number) => Promise<void>,
): Promise<AuditWriteError | null> {
  return withRetry(
    IN_PROCESS,
    async () => {
      try {
        return await (injectedSeam ?? defaultAuditWrite)(record);
      } catch (error) {
        return {
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      classify: (error) =>
        error
          ? classifyPostgrestError(error)
          : { retryable: false, reason: "terminal" },
      service: "audit-emit",
      sleep: wait,
    },
  );
}

/**
 * One shot per process. Sustained audit loss fires on EVERY dropped record, and
 * a per-record alert would bury the line it is trying to make unmissable. The
 * counter keeps growing so the true volume is still readable.
 */
function reportWriteLoss(error: AuditWriteError): void {
  lossCount++;
  if (lossAlertReported) return;
  lossAlertReported = true;
  try {
    captureAlert("Audit record write exhausted; record dropped", {
      level: "error",
      context: { code: error.code ?? null, message: error.message },
      error,
    });
  } catch {
    return;
  }
}

function writeStdout(record: AuditRecord): void {
  try {
    console.log(JSON.stringify({
      event: "audit",
      ...record,
      summary: redact(record.summary),
    }));
  } catch {
    return;
  }
}

async function scheduleWrite(
  record: AuditRecord,
  wait: (ms: number) => Promise<void>,
): Promise<void> {
  const write = async (): Promise<void> => {
    try {
      const error = await writeWithRetry(record, wait);
      if (error) reportWriteLoss(error);
    } catch (error) {
      reportWriteLoss({
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // LOAD-BEARING lazy import: `next/server` must never appear as a top-level
  // import in this directory (module-purity.test.ts enforces it), because the
  // curation worker loads this module under plain tsx with no Next runtime.
  // `after` also throws when called outside a request scope, which is the
  // signal to fall back to a direct await. Never a bare unawaited promise --
  // that is killed on response completion.
  try {
    const { after } = await import("next/server");
    after(write);
  } catch {
    await write();
  }
}

export function setAuditWriteSeam(seam: AuditWriteSeam | null): void {
  injectedSeam = seam;
}

export function auditWriteLossCount(): number {
  return lossCount;
}

export function resetAuditEmitterForTests(): void {
  injectedSeam = null;
  lossCount = 0;
  lossAlertReported = false;
}

export async function emitAuditRecord(
  record: AuditRecord,
  wait: (ms: number) => Promise<void> = defaultWait,
): Promise<void> {
  writeStdout(record);
  await scheduleWrite(record, wait);
}
