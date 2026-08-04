import { describe, expect, it } from "vitest";
import { redact } from "../redact";

describe("audit redaction", () => {
  it("redacts known secret keys at any nesting depth", () => {
    const result = redact({
      secret: "one",
      nested: {
        token: "two",
        API_KEY: "three",
        Authorization: "Bearer four",
        password: "five",
        values: [{ Cookie: "six", email: "seven" }],
      },
    }) as Record<string, unknown>;

    expect(result).toEqual({
      secret: "[redacted]",
      nested: {
        token: "[redacted]",
        API_KEY: "[redacted]",
        Authorization: "[redacted]",
        password: "[redacted]",
        values: [{ Cookie: "[redacted]", email: "[redacted]" }],
      },
    });
  });

  it("caps payload bytes and marks truncation", () => {
    const result = redact({ message: "a".repeat(200) }, { maxBytes: 40 });

    expect(typeof result).toBe("string");
    expect(result).toContain("[truncated: ");
    expect(new TextEncoder().encode(String(result)).byteLength).toBeLessThanOrEqual(40);
  });

  it("preserves non-sensitive structure", () => {
    const input = { first: "value", nested: { second: 2 }, third: [true, null] };

    expect(redact(input)).toEqual(input);
    expect(Object.keys(redact(input) as object)).toEqual(["first", "nested", "third"]);
  });

  it("handles circular references without throwing", () => {
    const input: { name: string; self?: unknown } = { name: "circle" };
    input.self = input;

    expect(() => redact(input)).not.toThrow();
    expect(redact(input)).toEqual({ name: "circle", self: "[circular]" });
  });
});
