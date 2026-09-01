import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  formatRetryInstruction,
  parseAndValidate,
  toStrictJsonSchema,
} from "../zod-schema";

const testSchema = z.object({
  name: z.string(),
  age: z.number(),
});

describe("parseAndValidate", () => {
  it("returns data on valid JSON matching schema", () => {
    const result = parseAndValidate('{"name":"Alice","age":30}', testSchema);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ name: "Alice", age: 30 });
      // Verify typed access works
      expect(result.data.name).toBe("Alice");
      expect(result.data.age).toBe(30);
    }
  });

  it("returns error on malformed JSON", () => {
    const result = parseAndValidate("not json at all", testSchema);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/Invalid JSON/);
      expect(result.issues).toBeUndefined();
    }
  });

  it("returns error and issues on schema mismatch", () => {
    const result = parseAndValidate(
      '{"name":123,"age":"not a number"}',
      testSchema,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
      expect(result.issues).toBeDefined();
      expect(result.issues!.length).toBeGreaterThanOrEqual(1);
      // At least one issue should point to a mismatched field
      const paths = result.issues!.map((i) => i.path?.join("."));
      expect(paths).toContain("name");
    }
  });
});

describe("toStrictJsonSchema", () => {
  it("strips $schema key", () => {
    const result = toStrictJsonSchema(testSchema);
    expect(result).not.toHaveProperty("$schema");
    // Should still have the type and properties
    expect(result).toHaveProperty("type", "object");
    expect(result).toHaveProperty("properties");
  });

  it("preserves additionalProperties false and required", () => {
    const result = toStrictJsonSchema(testSchema);
    expect(result).toHaveProperty("additionalProperties", false);
    expect(result).toHaveProperty("required");
    const required = result.required as string[];
    expect(required).toContain("name");
    expect(required).toContain("age");
  });

  it("handles nullable enum", () => {
    const nullableEnum = z.enum(["keep", "reject"]).nullable();
    const result = toStrictJsonSchema(nullableEnum);
    expect(result).not.toHaveProperty("$schema");
    // Should represent as anyOf with enum and null type
    const json = JSON.stringify(result);
    expect(json).toContain("keep");
    expect(json).toContain("reject");
    expect(json).toContain("null");
  });
});

describe("formatRetryInstruction", () => {
  it("produces structured JSON with field errors", () => {
    // Parse something that fails validation to get real issues
    const result = parseAndValidate(
      '{"name":123,"age":"bad"}',
      testSchema,
    );
    expect(result.success).toBe(false);
    if (!result.success && result.issues) {
      const instruction = formatRetryInstruction(result.issues);
      const parsed = JSON.parse(instruction);
      expect(parsed).toHaveProperty("validation_errors");
      expect(Array.isArray(parsed.validation_errors)).toBe(true);
      expect(parsed.validation_errors.length).toBeGreaterThanOrEqual(1);
      const firstError = parsed.validation_errors[0];
      expect(firstError).toHaveProperty("field");
      expect(firstError).toHaveProperty("expected");
      expect(firstError).toHaveProperty("received");
    }
  });
});
