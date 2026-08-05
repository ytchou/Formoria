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

/**
 * The migration carries
 * `create unique index ... on external_call_audit (span_id) where status = 'started'`.
 * When the first insert commits but its response is lost, the retry comes back
 * as 23505 -- which is terminal, so the old code counted a row that is sitting
 * in the table as a DROPPED record and poisoned the audit-loss signal. A unique
 * violation on this table means the write succeeded.
 */
const UNIQUE_VIOLATION = "23505";

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
      // Already redacted and snapshotted by `emitAuditRecord` -- see
      // `snapshotRecord`. Redacting again here would be a no-op at best and, on
      // a deferred write, would re-read a summary the caller has since mutated.
      summary: (record.summary ?? null) as unknown as Json,
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
        const error = await (injectedSeam ?? defaultAuditWrite)(record);
        // See UNIQUE_VIOLATION above: the row is already there, so this is a
        // success, not a loss.
        return error && error.code === UNIQUE_VIOLATION ? null : error;
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
    console.log(JSON.stringify({ event: "audit", ...record }));
  } catch {
    return;
  }
}

/**
 * Redaction and DEEP COPY happen here, synchronously, at the moment the row is
 * emitted -- before any await and before `after()` can defer the insert.
 *
 * Both rows of a span used to share one summary object reference, so a caller
 * that mutated its summary during `fn` (mit-registry does exactly this) got a
 * `started` row serialized with FINAL values inside a Next request scope and
 * with initial values outside one: same code, two different persisted rows.
 * `redact` rebuilds every object and array it walks, so its result is already
 * detached from the caller's object; that is what makes it a snapshot as well
 * as a redaction. This also keeps the ordering the audit path depends on --
 * redact first, then cap -- on every write path.
 */
function snapshotRecord(record: AuditRecord): AuditRecord {
  if (record.summary == null) return { ...record, summary: null };

  const redacted = redact(record.summary);
  const summary =
    redacted !== null && typeof redacted === "object" && !Array.isArray(redacted)
      ? (redacted as Record<string, unknown>)
      : null;

  return { ...record, summary };
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
  const snapshot = snapshotRecord(record);
  writeStdout(snapshot);
  await scheduleWrite(snapshot, wait);
}
