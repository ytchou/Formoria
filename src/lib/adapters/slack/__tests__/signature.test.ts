import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySlackSignature } from "../signature";

const TEST_SECRET = "8f742231b10e8888abcd99yyyzzz85a5";

function sign(body: string, timestamp: string, secret: string): string {
  const basestring = `v0:${timestamp}:${body}`;
  const hmac = createHmac("sha256", secret).update(basestring).digest("hex");
  return `v0=${hmac}`;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

describe("verifySlackSignature", () => {
  it("valid_signature_passes", () => {
    const ts = String(nowSeconds());
    const body = '{"token":"xoxb","event":{"type":"message"}}';
    const sig = sign(body, ts, TEST_SECRET);

    expect(
      verifySlackSignature({
        rawBody: body,
        timestamp: ts,
        signature: sig,
        secret: TEST_SECRET,
      }),
    ).toBe(true);
  });

  it("stale_timestamp_fails", () => {
    const staleTs = String(nowSeconds() - 600);
    const body = '{"token":"xoxb"}';
    const sig = sign(body, staleTs, TEST_SECRET);

    expect(
      verifySlackSignature({
        rawBody: body,
        timestamp: staleTs,
        signature: sig,
        secret: TEST_SECRET,
      }),
    ).toBe(false);
  });

  it("tampered_body_fails", () => {
    const ts = String(nowSeconds());
    const body = '{"token":"xoxb"}';
    const sig = sign(body, ts, TEST_SECRET);

    // One changed byte
    const tampered = '{"token":"xoxc"}';
    expect(
      verifySlackSignature({
        rawBody: tampered,
        timestamp: ts,
        signature: sig,
        secret: TEST_SECRET,
      }),
    ).toBe(false);

    // Length mismatch: returns false, never throws
    expect(
      verifySlackSignature({
        rawBody: tampered,
        timestamp: ts,
        signature: "v0=short",
        secret: TEST_SECRET,
      }),
    ).toBe(false);
  });
});
