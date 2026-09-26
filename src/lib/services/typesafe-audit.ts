import {
  auditedCall,
  getAuditContext,
  type AuditCallContext,
} from "@/lib/audit";
import { JEV_MODEL } from "@/lib/constants/llm-models";
import { describeError } from "@/lib/errors";
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
 * emits one Langfuse generation when a trace is in scope -- on failure too, at
 * level ERROR, because the envelope emits no span for an LLM provider.
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
  /** Null when the response carried no usage. */
  usage: JevUsage | null;
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

type DecideOutcome =
  | { ok: true; result: JevDecideResult; costUsd: number | null }
  | { ok: false; error: unknown };

/**
 * Fire-and-forget Langfuse generation. Same shape as `emitLangfuseGeneration`
 * in llm-audit.ts, which is typed to chat events and so does not fit here.
 * A failed call is emitted at level ERROR with the error as statusMessage.
 * Must never throw -- all errors are swallowed.
 */
function emitDecideGeneration(
  profileKey: string,
  state: JevState,
  questions: Record<string, JevQuestion>,
  outcome: DecideOutcome,
): void {
  try {
    const trace = getAuditContext().langfuseTrace;
    if (!trace) return;
    const langfuseTrace = trace as {
      generation: (input: Record<string, unknown>) => void;
    };
    const input = {
      state: truncateForTrace(state),
      questions: truncateForTrace(questions),
    };
    if (!outcome.ok) {
      langfuseTrace.generation({
        name: "typesafe/decide",
        model: JEV_MODEL,
        input,
        level: "ERROR",
        statusMessage: describeError(outcome.error),
        metadata: { phase: profileKey },
      });
      return;
    }
    const { result, costUsd } = outcome;
    langfuseTrace.generation({
      name: "typesafe/decide",
      model: result.model,
      input,
      output: result.answers,
      ...(result.usage
        ? {
            usage: {
              promptTokens: result.usage.inputTokens,
              completionTokens: result.usage.outputTokens,
            },
          }
        : {}),
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
      ctx.summary = { questionCount: Object.keys(questions).length };
      let decided: JevDecideResult;
      try {
        decided = await client.decide({ state, questions, model: JEV_MODEL });
      } catch (error) {
        emitDecideGeneration(profileKey, state, questions, { ok: false, error });
        throw error;
      }
      // Explicit null, not absent: a completed call whose cost is unknown.
      ctx.costUsd = null;
      if (decided.usage) {
        ctx.promptTokens = decided.usage.inputTokens;
        ctx.completionTokens = decided.usage.outputTokens;
        try {
          // Priced with the model that ran, as llm-audit does, so the cost and
          // the generation's model agree. `decided.model` falls back to JEV_MODEL.
          const cost = await price(decided.model, {
            prompt_tokens: decided.usage.inputTokens,
            completion_tokens: decided.usage.outputTokens,
          });
          ctx.costUsd = cost.costUsd;
          costUsd = cost.costUsd;
        } catch {
          // Price lookup must never prevent the audit row from being written.
        }
      }
      emitDecideGeneration(profileKey, state, questions, {
        ok: true,
        result: decided,
        costUsd,
      });
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
