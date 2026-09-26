/**
 * Every JSON schema that travels to OpenAI as a strict Structured Outputs
 * `response_format` must be strict-valid: each object node carries
 * `additionalProperties: false` and lists every property in `required`.
 *
 * Since DEV-1866 the OpenAI client no longer downgrades a rejected schema to
 * `json_object` mode, so a non-strict schema fails the call in production.
 * Known pitfall: `toStrictJsonSchema` omits `.optional()` Zod fields from
 * `required` — use `.nullable()` instead.
 *
 * Schemas are obtained three ways, most faithful first:
 *   1. captured from the real call through a public dependency-injection seam
 *      (or the global `fetch` for calls with no seam),
 *   2. imported directly when the module exports the wire schema,
 *   3. rebuilt with `toStrictJsonSchema(<exported Zod shape>)` exactly as the
 *      module-private constant is built.
 *
 * Not covered (module-private schema whose Zod shape is also private, and no
 * seam that reaches the call without a database):
 *   - enrich-phases/stockists.ts STOCKISTS_SCHEMA (stockistsShape is private)
 *   - enrich-phases/classify-images.ts IMAGE_CLASSIFICATION_SCHEMA (imageClassificationShape is private)
 *   - enrich-phases/faq.ts faqSchema "faq_entries" (buildFaqZodSchema is private)
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// Prompt text is irrelevant to the schema; keep Langfuse off the network.
vi.mock("@/lib/langfuse/prompt", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/langfuse/prompt")>();
  return {
    ...actual,
    fetchLangfusePrompt: vi.fn(async () => "prompt"),
    fetchLangfusePromptWithMeta: vi.fn(async (name: string) => ({
      text: "prompt",
      prompt: { name, version: 1, source: "snapshot" as const },
    })),
  };
});

import { toStrictJsonSchema } from "../_shared/zod-schema";
import { nameArbitrationShape } from "../name-arbiter";
import { siteIdentityShape } from "../site-identity-arbiter";
import { factsShape, researchFoundingFacts } from "../brand-facts";
import {
  classifyBatchShape,
  classifySingleShape,
  detectBatchShape,
  detectSingleShape,
} from "../category-classifier";
import { descriptionShape } from "../description-rewrite";
import { parseQueryIntent } from "../query-intent-parse";
import { rerankProducts } from "../product-rerank";
import { judgeRelevance } from "../eval/search-relevance-judge";
import {
  classifySentryIssue,
  type SentryClassifyDeps,
} from "../health-agent/classifiers/sentry-classify";
import { CritiqueVerdictSchema } from "../enrich-phases/acquisition/plan";
import {
  PRODUCTS_PROPOSAL_SHAPE,
  PRODUCTS_SCHEMA,
} from "../enrich-phases/products";
import { repairEditorialCrossOutput } from "../enrich-phases/editorial/validators";
import type { AgentModel } from "../enrich-phases/agents/runtime";

type JsonSchema = Record<string, unknown>;
type WireSchema = { name: string; schema: JsonSchema };

// ---------------------------------------------------------------------------
// Checker
// ---------------------------------------------------------------------------

/** Returns one message per strict-mode violation; empty means strict-valid. */
function strictViolations(node: unknown, path = "$"): string[] {
  if (Array.isArray(node)) {
    return node.flatMap((child, index) =>
      strictViolations(child, `${path}[${index}]`),
    );
  }
  if (!node || typeof node !== "object") return [];
  const obj = node as JsonSchema;
  const violations: string[] = [];

  const types = Array.isArray(obj.type) ? obj.type : [obj.type];
  const properties = (obj.properties ?? {}) as Record<string, unknown>;
  if (types.includes("object")) {
    if (obj.additionalProperties !== false) {
      violations.push(
        `${path}: additionalProperties is ${JSON.stringify(obj.additionalProperties)}, not false`,
      );
    }
    const required = new Set(
      Array.isArray(obj.required) ? (obj.required as string[]) : [],
    );
    const keys = new Set(Object.keys(properties));
    for (const key of keys) {
      if (!required.has(key))
        violations.push(`${path}.properties.${key}: missing from required`);
    }
    for (const key of required) {
      if (!keys.has(key))
        violations.push(`${path}.required: "${key}" is not a property`);
    }
  }

  for (const [key, child] of Object.entries(properties)) {
    violations.push(...strictViolations(child, `${path}.properties.${key}`));
  }
  if (obj.items !== undefined)
    violations.push(...strictViolations(obj.items, `${path}.items`));
  if (obj.anyOf !== undefined)
    violations.push(...strictViolations(obj.anyOf, `${path}.anyOf`));
  for (const defsKey of ["$defs", "definitions"] as const) {
    const defs = obj[defsKey];
    if (defs && typeof defs === "object") {
      for (const [key, child] of Object.entries(
        defs as Record<string, unknown>,
      )) {
        violations.push(
          ...strictViolations(child, `${path}.${defsKey}.${key}`),
        );
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Capture helpers
// ---------------------------------------------------------------------------

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

/**
 * Stubs the global `fetch` and records every strict `json_schema` sent to the
 * OpenAI chat endpoint. `replies` are returned in order as message content.
 */
function captureOpenAiFetch(replies: string[]): WireSchema[] {
  const captured: WireSchema[] = [];
  let index = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url !== OPENAI_URL) return new Response("not found", { status: 404 });
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        response_format?: { json_schema?: WireSchema };
      };
      if (body.response_format?.json_schema)
        captured.push(body.response_format.json_schema);
      const content = replies[Math.min(index++, replies.length - 1)] ?? "{}";
      return new Response(
        JSON.stringify({
          choices: [{ message: { content }, finish_reason: "stop" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }),
  );
  return captured;
}

function capturingChat<T>(reply: T) {
  const schemas: WireSchema[] = [];
  const chat = vi.fn(async (input: { schema?: WireSchema }) => {
    if (input.schema) schemas.push(input.schema);
    return reply;
  });
  return { chat, schemas };
}

function firstSent(schemas: WireSchema[]): JsonSchema {
  const sent = schemas.at(0);
  if (!sent) throw new Error("no json_schema was sent");
  return sent.schema;
}

function only(schemas: WireSchema[], name: string): JsonSchema {
  const match = schemas.find((schema) => schema.name === name);
  if (!match)
    throw new Error(
      `schema "${name}" was not sent; captured: ${schemas.map((s) => s.name).join(", ")}`,
    );
  return match.schema;
}

// ---------------------------------------------------------------------------
// Loaders — each resolves to the schema body sent on the wire
// ---------------------------------------------------------------------------

async function captureIntentParse(): Promise<JsonSchema> {
  const { chat, schemas } = capturingChat({ ok: false, content: null });
  await parseQueryIntent("送給媽媽的生日禮物", {
    client: { chat },
    cache: { get: async () => null, set: async () => {} },
  });
  return firstSent(schemas);
}

async function captureRerank(): Promise<JsonSchema> {
  const { chat, schemas } = capturingChat({ ok: false, content: null });
  await rerankProducts("禮物", [{ id: "a", document: "doc" }], { chat });
  return firstSent(schemas);
}

async function captureJudge(): Promise<JsonSchema> {
  const { chat, schemas } = capturingChat({ content: "{}" });
  await judgeRelevance(
    { query: "禮物", product: { name_zh: "茶具" } },
    { chat, samples: 1 },
  );
  return firstSent(schemas);
}

async function captureSentry(): Promise<JsonSchema> {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  const { chat, schemas } = capturingChat({ content: null });
  const deps: SentryClassifyDeps = {
    createClient: (() => ({
      chat,
    })) as unknown as SentryClassifyDeps["createClient"],
    chatParams: (() => ({})) as unknown as SentryClassifyDeps["chatParams"],
    fetchPrompt: (async (name: string) => ({
      text: "prompt",
      prompt: { name, version: 1, source: "snapshot" as const },
    })) as unknown as SentryClassifyDeps["fetchPrompt"],
  };
  await classifySentryIssue(
    {
      id: "1",
      title: "TypeError",
      count: "1",
      userCount: 1,
      lastSeen: "2026-09-19T00:00:00.000Z",
      permalink: "https://sentry.io/issues/1/",
      level: "error",
      culprit: "app/route",
      firstSeen: "2026-09-18T00:00:00.000Z",
      platform: "node",
      metadata: { type: "TypeError", value: "x" },
    },
    deps,
  );
  return only(schemas, "sentry_classification");
}

async function captureEditorialRepair(): Promise<JsonSchema> {
  const schemas: WireSchema[] = [];
  const model: AgentModel = {
    invoke: vi.fn(async (_messages, options?: { schema?: WireSchema }) => {
      if (options?.schema) schemas.push(options.schema);
      return { content: "{}" };
    }),
  } as unknown as AgentModel;
  await repairEditorialCrossOutput({
    patch: { description_en: "In a world where tea matters." },
    failures: [
      { field: "description_en", reason: "ai_artifact:^in a world where\\b" },
    ],
    model,
  });
  return firstSent(schemas);
}

/** Both founding-facts calls: extraction, then (given one citable claim) verification. */
async function captureFoundingFacts(): Promise<WireSchema[]> {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  const url = "https://brand.example.tw/about";
  const captured = captureOpenAiFetch([
    JSON.stringify({
      claims: [
        {
          field: "city",
          value: "台北",
          cited_url: url,
          exact_excerpt: "創立於台北",
          location_context: "founding",
        },
      ],
    }),
    JSON.stringify({ results: [] }),
  ]);
  await researchFoundingFacts(
    "測試品牌",
    [
      {
        url,
        text: "創立於台北",
        sourceType: "first-party",
        reputable: true,
        fetched: true,
      },
    ],
    {},
  );
  return captured;
}

const WIRE_SCHEMAS: Array<[string, () => Promise<JsonSchema>]> = [
  // Captured from the real call.
  ["query-intent-parse INTENT_PARSE_JSON_SCHEMA", captureIntentParse],
  ["product-rerank RERANK_JSON_SCHEMA", captureRerank],
  ["eval/search-relevance-judge JUDGE_JSON_SCHEMA", captureJudge],
  [
    "health-agent/sentry-classify SENTRY_CLASSIFICATION_JSON_SCHEMA",
    captureSentry,
  ],
  ["editorial/validators EDITORIAL_REPAIR_SCHEMA", captureEditorialRepair],
  [
    "brand-facts FOUNDING_FACTS_SCHEMA",
    async () => only(await captureFoundingFacts(), "founding_fact_claims"),
  ],
  [
    "brand-facts FOUNDING_FACTS_VERIFY_SCHEMA",
    async () =>
      only(await captureFoundingFacts(), "founding_fact_verification"),
  ],
  // Exported wire schema.
  [
    "enrich-phases/products PRODUCTS_SCHEMA",
    async () => PRODUCTS_SCHEMA.schema,
  ],
  // Rebuilt from the exported Zod shape, as the source builds it.
  [
    "name-arbiter NAME_ARBITRATION_SCHEMA",
    async () => toStrictJsonSchema(nameArbitrationShape),
  ],
  [
    "site-identity-arbiter SITE_IDENTITY_SCHEMA",
    async () => toStrictJsonSchema(siteIdentityShape),
  ],
  ["brand-facts FACTS_SCHEMA", async () => toStrictJsonSchema(factsShape)],
  [
    "category-classifier DETECT_SCHEMA",
    async () => toStrictJsonSchema(detectSingleShape),
  ],
  [
    "category-classifier DETECT_BATCH_SCHEMA",
    async () => toStrictJsonSchema(detectBatchShape),
  ],
  [
    "category-classifier CLASSIFY_SCHEMA",
    async () => toStrictJsonSchema(classifySingleShape),
  ],
  [
    "category-classifier CLASSIFY_BATCH_SCHEMA",
    async () => toStrictJsonSchema(classifyBatchShape),
  ],
  [
    "description-rewrite DESCRIPTION_SCHEMA",
    async () => toStrictJsonSchema(descriptionShape),
  ],
  [
    "acquisition/graph CRITIQUE_SCHEMA",
    async () => toStrictJsonSchema(CritiqueVerdictSchema),
  ],
  [
    "products/graph REPAIR_SCHEMA",
    async () =>
      toStrictJsonSchema(PRODUCTS_PROPOSAL_SHAPE.pick({ products: true })),
  ],
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("strict JSON schemas sent to OpenAI", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each(WIRE_SCHEMAS)(
    "every wire schema is strict-valid: %s",
    async (_name, load) => {
      const schema = await load();
      expect(schema).toMatchObject({ type: "object" });
      expect(strictViolations(schema)).toEqual([]);
    },
  );

  it("guard rejects a non-strict schema", () => {
    const handBuilt: JsonSchema = {
      type: "object",
      properties: {
        kept: { type: "string" },
        optional: { type: "string" },
        nested: {
          type: ["object", "null"],
          properties: { inner: { type: "string" } },
          required: ["inner"],
        },
      },
      required: ["kept", "nested"],
      additionalProperties: false,
    };
    expect(strictViolations(handBuilt)).toEqual([
      "$.properties.optional: missing from required",
      "$.properties.nested: additionalProperties is undefined, not false",
    ]);

    // The known pitfall: `.optional()` drops the key from `required`.
    const fromZod = toStrictJsonSchema(
      z.object({
        items: z.array(z.object({ a: z.string(), b: z.string().optional() })),
      }),
    );
    expect(strictViolations(fromZod)).toEqual([
      "$.properties.items.items.properties.b: missing from required",
    ]);
  });
});
