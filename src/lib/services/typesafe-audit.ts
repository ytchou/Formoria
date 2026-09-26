import {
  auditedCall,
  getAuditContext,
  type AuditCallContext,
} from "@/lib/audit";
import { JEV_MODEL } from "@/lib/constants/llm-models";
import { priceUsage, type CostBreakdown, type TokenUsage } from "./llm-pricing";
import {
  createTypesafeClient,
  type JevAnswer,
  type JevDecideResult,
  type JevQuestion,
  type JevState,
  type JevUsage,
} from "./typesafe-client";

/**
 * Audited seam for Jev decisions (DEV-1824). Every call runs inside
 * `auditedCall` as `typesafe.decide`, is priced through `llm_model_prices`, and
 * emits one Langfuse generation when a trace is in scope.
 *
 * Eval-only: it does not persist to `brand_ai_results` because eval paths have
 * no enrichment target. Add that when a production phase switches to Jev.
 */

const MAX_INPUT_LENGTH = 2_000;

type AuditFn = (
  spec: { provider: string; operation: string; kind: "external" | "service" },
  fn: (ctx: AuditCallContext) => Promise<JevDecideResult>,
  options?: { summary?: Record<string, unknown> },
) => Promise<JevDecideResult>;

export type DecideDeps = {
  client?: Pick<ReturnType<typeof createTypesafeClient>, "decide">;
  audit?: AuditFn;
  price?: (model: string, usage: TokenUsage) => Promise<CostBreakdown>;
};

export type DecideResult = {
  answers: Record<string, JevAnswer>;
  usage: JevUsage;
  latencyMs: number;
  /** Null when no price is on file or the lookup failed — unknown, not zero. */
  costUsd: number | null;
};

/** Small values stay structured; anything over the limit becomes a truncated JSON string. */
function truncateForTrace(value: unknown): unknown {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (serialized === undefined || serialized.length <= MAX_INPUT_LENGTH) {
    return value;
  }
  return `${serialized.slice(0, MAX_INPUT_LENGTH)}…`;
}

/**
 * Fire-and-forget Langfuse generation. Same shape as `emitLangfuseGeneration`
 * in llm-audit.ts, which is typed to chat events and so does not fit here.
 * Must never throw -- all errors are swallowed.
 */
function emitDecideGeneration(
  profileKey: string,
  state: JevState,
  questions: Record<string, JevQuestion>,
  result: JevDecideResult,
  costUsd: number | null,
): void {
  try {
    const trace = getAuditContext().langfuseTrace;
    if (!trace) return;
    const langfuseTrace = trace as {
      generation: (input: Record<string, unknown>) => void;
    };
    langfuseTrace.generation({
      name: "typesafe/decide",
      model: result.model,
      input: {
        state: truncateForTrace(state),
        questions: truncateForTrace(questions),
      },
      output: result.answers,
      usage: {
        promptTokens: result.usage.input_tokens,
        completionTokens: result.usage.output_tokens,
      },
      ...(costUsd != null ? { costDetails: { total: costUsd } } : {}),
      metadata: { phase: profileKey, latencyMs: result.latencyMs },
    });
  } catch {
    // Langfuse errors must never block the call.
  }
}

export async function decide(
  profileKey: string,
  state: JevState,
  questions: Record<string, JevQuestion>,
  deps: DecideDeps = {},
): Promise<DecideResult> {
  const client = deps.client ?? createTypesafeClient();
  const audit: AuditFn = deps.audit ?? auditedCall;
  const price = deps.price ?? priceUsage;
  let costUsd: number | null = null;

  const result = await audit(
    { provider: "typesafe", operation: "decide", kind: "external" },
    async (ctx) => {
      const decided = await client.decide({ state, questions, model: JEV_MODEL });
      ctx.promptTokens = decided.usage.input_tokens;
      ctx.completionTokens = decided.usage.output_tokens;
      try {
        // Priced against the pinned model: the price row is keyed on JEV_MODEL.
        const cost = await price(JEV_MODEL, {
          prompt_tokens: decided.usage.input_tokens,
          completion_tokens: decided.usage.output_tokens,
        });
        ctx.costUsd = cost.costUsd;
        costUsd = cost.costUsd;
      } catch {
        // Price lookup must never prevent the audit row from being written.
      }
      ctx.summary = { questionCount: Object.keys(questions).length };
      emitDecideGeneration(profileKey, state, questions, decided, costUsd);
      return decided;
    },
    { summary: { phase: profileKey } },
  );

  return {
    answers: result.answers,
    usage: result.usage,
    latencyMs: result.latencyMs,
    costUsd,
  };
}
