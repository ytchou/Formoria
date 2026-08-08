export const KNIP_VERSION = "6.23.0" as const;

export const KNIP_KNOWN_NOISE = [
  {
    kind: "files",
    reason:
      "Vitest's server-only module alias fixture is not a production entry.",
    signature: "src/test/server-only.ts",
  },
  {
    kind: "binaries",
    reason:
      "The OCR helper documents tesseract as an optional developer tool, not a repository dependency.",
    signature: "tesseract",
  },
] as const;

export type KnipKnownNoiseKind = (typeof KNIP_KNOWN_NOISE)[number]["kind"];

export function isKnownKnipNoise(kind: string, signature: string): boolean {
  return KNIP_KNOWN_NOISE.some(
    (entry) => entry.kind === kind && entry.signature === signature,
  );
}
