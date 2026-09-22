import { z } from "zod";
import type {
  RepairRequest,
} from "@/lib/services/health-agent/repair-request";

// ---------------------------------------------------------------------------
// Zod schemas (mirrors RepairFinding / RepairRequest)
// ---------------------------------------------------------------------------

const RepairFindingSchema = z.object({
  fingerprint: z.string(),
  title: z.string(),
  severity: z.string(),
  source: z.string(),
  ticketId: z.string().optional(),
  rootCause: z.string().optional(),
  permalink: z.string().optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
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

