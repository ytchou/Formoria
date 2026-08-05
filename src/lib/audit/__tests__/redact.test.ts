import { describe, expect, it } from "vitest";
import { redact } from "../redact";

// Built from code points so this source file stays pure ASCII.
// U+00E9 is two bytes in UTF-8; U+FFFD is the replacement character a byte-wise
// slice through a multi-byte character decodes to.
const TWO_BYTE_CHAR = String.fromCodePoint(0x00e9);
const REPLACEMENT_CHAR = String.fromCodePoint(0xfffd);

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? "").byteLength;
}

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

  it("redacts secret-bearing key variants, not just exact names", () => {
    const result = redact({
      accessToken: "a",
      refresh_token: "b",
      api_secret_key: "c",
      bearer: "d",
      sessionToken: "e",
      "x-api-key": "f",
      credentials: "g",
      Authorization: "h",
    });

    expect(result).toEqual({
      accessToken: "[redacted]",
      refresh_token: "[redacted]",
      api_secret_key: "[redacted]",
      bearer: "[redacted]",
      sessionToken: "[redacted]",
      "x-api-key": "[redacted]",
      credentials: "[redacted]",
      Authorization: "[redacted]",
    });
  });

  it("keeps non-secret fields that merely resemble sensitive names", () => {
    const input = { keyword: "shoes", keywords: ["a"], emailBody: "hello", emailsSent: 3 };

    expect(redact(input)).toEqual(input);
  });

  it("keeps measurements of a secret, which are metadata and not the secret", () => {
    const input = {
      tokenLength: 15,
      apiKeyCount: 2,
      secretLengths: [8, 16],
      tokenProvided: true,
      passwordPresent: false,
    };

    expect(redact(input)).toEqual(input);
  });

  it("a metric suffix cannot be used to smuggle a secret out", () => {
    const result = redact({
      lengthKey: "a",
      countToken: "b",
      accessToken: "c",
      refresh_token: "d",
      api_secret_key: "e",
      sessionToken: "f",
      bearer: "g",
    });

    expect(result).toEqual({
      lengthKey: "[redacted]",
      countToken: "[redacted]",
      accessToken: "[redacted]",
      refresh_token: "[redacted]",
      api_secret_key: "[redacted]",
      sessionToken: "[redacted]",
      bearer: "[redacted]",
    });
  });

  it("an over-cap payload stays an object carrying a truncation marker", () => {
    const result = redact({ message: "a".repeat(200) }, { maxBytes: 90 }) as Record<
      string,
      unknown
    >;

    expect(typeof result).toBe("object");
    expect(result.truncated).toBe(true);
    expect(result.bytes).toEqual(expect.any(Number));
    expect(String(result.preview).length).toBeGreaterThan(0);
    expect(serializedBytes(result)).toBeLessThanOrEqual(90);
  });

  it("never exceeds maxBytes, even when the cap is smaller than the marker", () => {
    for (const maxBytes of [0, 1, 8, 17, 18, 30, 41, 42, 90]) {
      const result = redact({ message: "a".repeat(200) }, { maxBytes });

      expect(serializedBytes(result)).toBeLessThanOrEqual(Math.max(maxBytes, 4));
    }

    expect(redact({ message: "a".repeat(200) }, { maxBytes: 8 })).toBeNull();
    expect(redact({ message: "a".repeat(200) }, { maxBytes: 20 })).toEqual({ truncated: true });
  });

  it("truncates on a character boundary, never mid multi-byte character", () => {
    const multiByte = TWO_BYTE_CHAR.repeat(200);
    const result = redact({ message: multiByte }, { maxBytes: 90 }) as Record<string, unknown>;
    const preview = String(result.preview);

    expect(preview).not.toContain(REPLACEMENT_CHAR);
    expect(preview.length).toBeGreaterThan(0);
    expect(serializedBytes(result)).toBeLessThanOrEqual(90);
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

  it("keeps a shared reference that is not an ancestor cycle", () => {
    const target = { id: "brand-1", name: "shared" };
    const input = { target, context: { target }, siblings: [target, target] };

    expect(redact(input)).toEqual({
      target: { id: "brand-1", name: "shared" },
      context: { target: { id: "brand-1", name: "shared" } },
      siblings: [
        { id: "brand-1", name: "shared" },
        { id: "brand-1", name: "shared" },
      ],
    });
  });

  it("still reports a cycle nested below a shared reference", () => {
    const cycle: { id: string; self?: unknown } = { id: "loop" };
    cycle.self = cycle;
    const shared = { id: "plain" };

    expect(redact({ first: shared, second: shared, cycle })).toEqual({
      first: { id: "plain" },
      second: { id: "plain" },
      cycle: { id: "loop", self: "[circular]" },
    });
  });
});
