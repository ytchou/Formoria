/**
 * The single source of truth for "which model does this process call, with what
 * request parameters".
 *
 * Before this file every phase declared its parameters twice — once in a
 * `*_CONFIG_PARAMS` object persisted as the audit contract in
 * `brand_ai_results.config`, and again as literal arguments to `client.chat`.
 * The two copies drifted, and the audit copy hardcoded the model string while
 * the client resolved its own, so `OPENAI_MODEL_OVERRIDE` made every audit row
 * name a model that never ran.
 */

/**
 * Model registry. `text` and `vision` point at the same snapshot today; they are
 * kept separate so splitting them later is a one-line change here rather than a
 * sweep through every call site.
 */
export const LLM_MODELS = {
  text: "gpt-5.6-luna",
  vision: "gpt-5.6-luna",
} as const;

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_BATCH_SIZE = 100;

export type LlmModelKey = keyof typeof LLM_MODELS;

/**
 * Single source of truth for "which model is this process calling".
 *
 * `OPENAI_MODEL_OVERRIDE` exists for offline A/B evaluation only — it lets a
 * harness run the identical pipeline twice against two snapshots without
 * editing three consts in lockstep. Unset in every deployed environment, where
 * DEFAULT_OPENAI_MODEL is the answer. Callers that record the model into an
 * audit row must read it from here, or the stored row names a model that never
 * ran.
 */
export function resolveOpenAIModel(modelKey: LlmModelKey = "text"): string {
  const override = process.env.OPENAI_MODEL_OVERRIDE?.trim();
  return override && override.length > 0 ? override : LLM_MODELS[modelKey];
}

export type LlmReasoningEffort = "none" | "low" | "medium" | "high";

/**
 * The request parameters for one phase's LLM call.
 *
 * `maxTokens`, `reasoningEffort` and `timeoutMs` are optional because not every
 * call site sets them: image classification sizes its budget from the batch
 * length and leaves the client's own timeout in place. A profile omits a field
 * only where the call omits it today — this table is behaviour-preserving.
 */
export type LlmProfile = {
  model: LlmModelKey;
  maxTokens?: number;
  temperature: number;
  reasoningEffort?: LlmReasoningEffort;
  timeoutMs?: number;
};

const CLASSIFY_TIMEOUT_MS = 30_000;
const BATCH_CLASSIFY_TIMEOUT_MS = 60_000;

/**
 * How many brands go into one batched LLM call. Shared by every batch helper —
 * the detect batch, the classification batch and the name arbiter — because the
 * per-call token budgets in LLM_PROFILES are all sized against this number.
 * Was three inlined `20` literals; changing one without the others silently
 * overflows the matching profile's maxTokens.
 */
export const LLM_BATCH_CHUNK_SIZE = 20;

/**
 * Every phase is extraction or closed-set classification against a fixed rubric,
 * so `none` is the intended production reasoning budget throughout.
 */
export const LLM_PROFILES = {
  /** Facts extraction — taxonomy, city, year, MIT signals, listing verdict. */
  facts: {
    model: "text",
    maxTokens: 1500,
    temperature: 0.1,
    reasoningEffort: "none",
    timeoutMs: 30_000,
  },
  /** Source-cited city/year extraction; confidence is computed afterward. */
  foundingFacts: {
    model: "text",
    maxTokens: 1800,
    temperature: 0,
    reasoningEffort: "none",
    timeoutMs: 30_000,
  },
  /** Separate constrained check of every founding-fact claim and excerpt. */
  foundingFactsVerify: {
    model: "text",
    maxTokens: 1400,
    temperature: 0,
    reasoningEffort: "none",
    timeoutMs: 30_000,
  },
  /** Prose only; FAQ has its own final phase and token budget. */
  descriptions: {
    model: "text",
    maxTokens: 3500,
    temperature: 0.1,
    reasoningEffort: "none",
    timeoutMs: 30_000,
  },
  /** Structured bilingual FAQ generation from the eligible preset registry. */
  faq: {
    model: "text",
    maxTokens: 2500,
    temperature: 0.1,
    reasoningEffort: "none",
    timeoutMs: 60_000,
  },
  /**
   * Curated-product proposals from the brand's own site. Its own key rather than
   * a borrowed one: up to twenty proposals each carrying a 60-160 character
   * description is a different token shape from any other phase, and sharing
   * `faq`'s numbers would mean retuning FAQ silently retunes this call.
   */
  products: {
    model: "text",
    maxTokens: 12_000,
    temperature: 0.1,
    reasoningEffort: "none",
    timeoutMs: 90_000,
  },
  /** Single-brand triage. */
  detect: {
    model: "text",
    maxTokens: 500,
    temperature: 0.1,
    reasoningEffort: "none",
    timeoutMs: CLASSIFY_TIMEOUT_MS,
  },
  /** Batched triage — up to 20 brands per call. */
  detectBatch: {
    model: "text",
    maxTokens: 4000,
    temperature: 0.1,
    reasoningEffort: "none",
    timeoutMs: BATCH_CLASSIFY_TIMEOUT_MS,
  },
  /** Single-brand name arbitration — the per-item fallback after a batch content failure. */
  names: {
    model: "text",
    maxTokens: 400,
    temperature: 0.1,
    reasoningEffort: "none",
    timeoutMs: CLASSIFY_TIMEOUT_MS,
  },
  /** Batched name arbitration — up to LLM_BATCH_CHUNK_SIZE brands per call. */
  namesBatch: {
    model: "text",
    maxTokens: 2500,
    temperature: 0.1,
    reasoningEffort: "none",
    timeoutMs: BATCH_CLASSIFY_TIMEOUT_MS,
  },
  /** Single-site identity arbitration — the per-item fallback after a batch content failure. */
  siteIdentity: {
    model: "text",
    maxTokens: 400,
    temperature: 0.1,
    reasoningEffort: "none",
    timeoutMs: CLASSIFY_TIMEOUT_MS,
  },
  /** Batched site identity arbitration — up to LLM_BATCH_CHUNK_SIZE candidates per call. */
  siteIdentityBatch: {
    model: "text",
    maxTokens: 2500,
    temperature: 0.1,
    reasoningEffort: "none",
    timeoutMs: BATCH_CLASSIFY_TIMEOUT_MS,
  },
  /**
   * Single-brand category classification. 300, not 100: maxTokens is
   * max_completion_tokens on gpt-5, so any preamble the model emits before the
   * JSON eats the same budget and truncates the answer.
   */
  classification: {
    model: "text",
    maxTokens: 300,
    temperature: 0.1,
    reasoningEffort: "none",
    timeoutMs: CLASSIFY_TIMEOUT_MS,
  },
  /** Batched category classification — up to 20 brands per call. */
  classificationBatch: {
    model: "text",
    maxTokens: 1500,
    temperature: 0.1,
    reasoningEffort: "none",
    timeoutMs: BATCH_CLASSIFY_TIMEOUT_MS,
  },
  /**
   * Image classification. No `maxTokens` here: the budget is 250 per image in
   * the batch, so only the call site knows it. No `timeoutMs`/`reasoningEffort`
   * either — this call never set them.
   */
  classifyImages: {
    model: "vision",
    temperature: 0.1,
  },
  /** Stockist extraction from scraped website text. */
  stockists: {
    model: "text",
    temperature: 0.1,
    reasoningEffort: "none",
    timeoutMs: 60_000,
  },
  /** Acquisition agent — plans evidence retrieval per brand. */
  acquisition: {
    model: "text",
    temperature: 0.1,
    reasoningEffort: "none",
    timeoutMs: 30_000,
  },
  /** Acquire phase — the top-level phase wrapping the acquisition agent (DEV-1644). */
  acquire: {
    model: "text",
    temperature: 0.1,
    reasoningEffort: "none",
    timeoutMs: 30_000,
  },
  /** Products agent — select/verify/repair product proposals per brand. */
  products_agent: {
    model: "text",
    temperature: 0.1,
    reasoningEffort: "none",
    timeoutMs: 60_000,
  },
  /** Editorial agent — cross-output repair across descriptions/stockists/faq. */
  editorial: {
    model: "text",
    temperature: 0.1,
    reasoningEffort: "none",
    timeoutMs: 60_000,
  },
  /** Rerank candidates against a query for retrieval. */
  rerank: {
    model: "text",
    temperature: 0,
    maxTokens: 400,
  },
} as const satisfies Record<string, LlmProfile>;

export type LlmProfileKey = keyof typeof LLM_PROFILES;

/** The model a profile actually calls, `OPENAI_MODEL_OVERRIDE` included. */
export function resolveProfileModel(profileKey: LlmProfileKey): string {
  return resolveOpenAIModel(LLM_PROFILES[profileKey].model);
}
