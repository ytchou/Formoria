import { z } from "zod";
import type {
  RepairFinding,
  RepairRequest,
} from "@/lib/services/health-agent/repair-request";
import type {
  OpsCodeFixInput,
  OpsCodeFixResult,
} from "@/lib/services/ops-agent/code-fix";

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
  runCodeFix: (input: OpsCodeFixInput) => Promise<OpsCodeFixResult>;
};

export type RepairContext = {
  requestId: string;
};

type RepairOutcome = {
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

export const JSON_BLOCK_RE = /```json\s*([\s\S]*?)```/;

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
  // Truncate at the last complete scope entry boundary to avoid partial paths
  const truncated = raw.slice(0, MAX_LENGTH);
  const lastSep = Math.max(truncated.lastIndexOf(", "), truncated.lastIndexOf("\n"));
  const clean = lastSep > 0 ? truncated.slice(0, lastSep) : truncated;
  return `${clean} (${scope.length} files total, truncated)`;
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
      const result = await deps.runCodeFix({
        instruction,
        requestId: ctx.requestId,
      });

      if (result.ok) {
        outcomes.push({ fingerprint: finding.fingerprint, ok: true });
      } else {
        outcomes.push({
          fingerprint: finding.fingerprint,
          ok: false,
          error: result.error,
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
