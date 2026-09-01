import { z } from "zod";

/** Issue shape from Zod's safeParse error — avoids relying on an unexported type name. */
type ZodIssue = z.ZodError["issues"][number];

type ParseSuccess<T> = { success: true; data: T };
type ParseFailure = { success: false; error: string; issues?: ZodIssue[] };
type ParseResult<T> = ParseSuccess<T> | ParseFailure;

/**
 * Parse a raw JSON string and validate it against a Zod schema.
 *
 * Returns a discriminated union so callers can branch on `success` without
 * a try/catch. On Zod failure the `issues` array carries field-level detail
 * (including the received value when `reportInput` is enabled).
 */
export function parseAndValidate<T>(
  raw: string,
  schema: z.ZodType<T>,
): ParseResult<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const message = e instanceof SyntaxError ? e.message : String(e);
    return { success: false, error: `Invalid JSON: ${message}` };
  }

  const result = schema.safeParse(parsed, { reportInput: true });
  if (result.success) {
    return { success: true, data: result.data };
  }

  const formatted = result.error.issues
    .map(
      (issue) =>
        `${issue.path?.join(".") || "(root)"}: ${issue.message}`,
    )
    .join("; ");

  return {
    success: false,
    error: `Schema validation failed: ${formatted}`,
    issues: result.error.issues,
  };
}

/**
 * Convert a Zod schema to a strict JSON Schema (draft-7) suitable for
 * OpenAI's Structured Outputs.
 *
 * Strips the `$schema` keyword that OpenAI's strict mode rejects. Every
 * object produced by Zod already carries `additionalProperties: false`
 * and a fully populated `required` array, as strict mode demands.
 *
 * This is the ONLY export that converts Zod → JSON Schema. All call
 * sites must use this function rather than calling `z.toJSONSchema` directly.
 */
export function toStrictJsonSchema(shape: z.ZodType): Record<string, unknown> {
  const schema = z.toJSONSchema(shape, { target: "draft-7" }) as Record<
    string,
    unknown
  >;
  return Object.fromEntries(
    Object.entries(schema).filter(([key]) => key !== "$schema"),
  );
}

/**
 * Parse a batch LLM response that may arrive as one of three shapes:
 *
 * 1. `{ results: [...] }` — the structured outputs wrapper (preferred)
 * 2. A bare top-level array `[...]` — json_object fallback
 * 3. A single bare object `{ ... }` — json_object fallback with one entry
 *
 * When `json_schema` is rejected and the client falls back to `json_object`
 * mode, the model may return shapes 2 or 3. This helper preserves the
 * tolerance the old `unwrapBatchResults`/`toArbiterEntries` code provided.
 */
export function parseBatchEntries(
  content: string,
  batchShape: z.ZodType<{ results: unknown[] }>,
): { success: true; entries: unknown[] } | { success: false; issues?: ZodIssue[] } {
  const batchResult = parseAndValidate(content, batchShape);
  if (batchResult.success) {
    return { success: true, entries: batchResult.data.results };
  }

  // Fallback: bare array or single object (json_object mode tolerance)
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { success: false, issues: batchResult.issues };
  }
  if (Array.isArray(parsed)) {
    return { success: true, entries: parsed };
  }
  if (parsed !== null && typeof parsed === "object") {
    return { success: true, entries: [parsed] };
  }
  return { success: false, issues: batchResult.issues };
}

/**
 * Build a structured retry instruction from Zod validation issues.
 *
 * Returns a stringified JSON object with a `validation_errors` array,
 * each entry carrying the field path, expected type, and received value.
 * Designed to be injected into an LLM retry prompt so the model knows
 * exactly which fields to fix.
 */
export function formatRetryInstruction(issues: ZodIssue[]): string {
  const validationErrors = issues.map((issue) => {
    const raw = issue as unknown as Record<string, unknown>;
    return {
      field: issue.path?.join(".") || "(root)",
      expected: raw.expected ?? issue.message,
      received: raw.input ?? raw.received ?? "unknown",
    };
  });

  return JSON.stringify({ validation_errors: validationErrors });
}
