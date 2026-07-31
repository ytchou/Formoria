import { createHash } from "node:crypto";

export function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stableImageId(input: {
  brandSlug: string;
  query: string;
  position: number;
  sourceUrl: string;
}): string {
  return sha256(
    `${input.brandSlug}\u0000${input.query}\u0000${input.position}\u0000${input.sourceUrl}`,
  ).slice(0, 24);
}

export function stableNumber(value: string): number {
  return Number.parseInt(sha256(value).slice(0, 8), 16);
}
