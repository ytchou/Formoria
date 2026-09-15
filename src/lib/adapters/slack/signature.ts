import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_TIMESTAMP_AGE_SECONDS = 300;

export function verifySlackSignature({
  rawBody,
  timestamp,
  signature,
  secret,
  nowSeconds,
}: {
  rawBody: string;
  timestamp: string;
  signature: string;
  secret: string;
  nowSeconds?: number;
}): boolean {
  const ts = Number(timestamp);
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Number.isNaN(ts) || Math.abs(now - ts) > MAX_TIMESTAMP_AGE_SECONDS) {
    return false;
  }

  const basestring = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${createHmac("sha256", secret).update(basestring).digest("hex")}`;

  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);

  // Length mismatch: return false, never throw
  if (expectedBuf.length !== signatureBuf.length) {
    return false;
  }

  return timingSafeEqual(expectedBuf, signatureBuf);
}
