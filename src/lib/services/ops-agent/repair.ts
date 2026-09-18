import { z } from "zod";
import type {
  RepairFinding,
  RepairRequest,
} from "@/lib/services/health-agent/repair-request";
import type { dispatchWorkflow } from "@/lib/adapters/github/actions-api";

// ---------------------------------------------------------------------------
// Zod schemas (mirrors RepairFinding / RepairRequest)
// ---------------------------------------------------------------------------

const RepairFindingSchema = z.object({
  fingerprint: z.string(),
  title: z.string(),
  severity: z.string(),
  source: z.string(),
  ticketId: z.string().optional(),
});

const RepairRequestSchema = z.object({
  agent: z.string(),
  ref: z.string(),
  runId: z.string(),
  traceUrl: z.string().optional(),
  scope: z.array(z.string()),
  findings: z.array(RepairFindingSchema).min(1),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RepairDeps = {
  dispatchWorkflow: typeof dispatchWorkflow;
};

export type RepairContext = {
  requestId: string;
  channelId: string;
  threadTs: string;
};

export type RepairOutcome = {
  fingerprint: string;
  ok: boolean;
  error?: string;
};

export type RepairResult = {
  ok: boolean;
  outcomes: RepairOutcome[];
};

// ---------------------------------------------------------------------------
// extractRepairRequest
// ---------------------------------------------------------------------------

const JSON_BLOCK_RE = /```json\s*([\s\S]*?)```/;

export function extractRepairRequest(text: string): RepairRequest | null {
  const match = JSON_BLOCK_RE.exec(text);
  if (!match) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return null;
  }

  const result = RepairRequestSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

// ---------------------------------------------------------------------------
// mapFindingToInstruction
// ---------------------------------------------------------------------------

const MIN_LENGTH = 10;
const MAX_LENGTH = 2000;

export function mapFindingToInstruction(
  finding: RepairFinding,
  runId: string,
  scope: string[],
): string {
  const raw = `Health agent run ${runId}: ${finding.title}\n\nFiles in scope: ${scope.join(", ")}`;
  if (raw.length >= MIN_LENGTH && raw.length <= MAX_LENGTH) return raw;
  // Truncate if somehow over limit (defensive)
  return raw.slice(0, MAX_LENGTH);
}

// ---------------------------------------------------------------------------
// Dispatch repair findings
// ---------------------------------------------------------------------------

export async function executeRepairRequest(
  request: RepairRequest,
  deps: RepairDeps,
  ctx: RepairContext,
): Promise<RepairResult> {
  const outcomes: RepairOutcome[] = [];

  for (const finding of request.findings) {
    const instruction = mapFindingToInstruction(
      finding,
      request.runId,
      request.scope,
    );

    try {
      const result = await deps.dispatchWorkflow("ops-fix.yml", {
        instruction,
        request_id: ctx.requestId,
        channel: ctx.channelId,
        thread_ts: ctx.threadTs,
      });

      if (result.ok) {
        outcomes.push({ fingerprint: finding.fingerprint, ok: true });
      } else {
        outcomes.push({
          fingerprint: finding.fingerprint,
          ok: false,
          error: `Dispatch failed with status ${result.status}`,
        });
      }
    } catch (err) {
      outcomes.push({
        fingerprint: finding.fingerprint,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    ok: outcomes.every((o) => o.ok),
    outcomes,
  };
}
