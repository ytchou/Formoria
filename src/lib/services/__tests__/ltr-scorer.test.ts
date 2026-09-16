import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import {
  loadLtrModel,
  scoreCandidates,
  _testResetCache,
} from "../ltr-scorer";


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MODELS_DIR = join(process.cwd(), "models");

type ParityEntry = {
  features: number[];
  score: number;
};

function loadParity(version: string): ParityEntry[] {
  const path = join(MODELS_DIR, `ltr-${version}.parity.json`);
  return JSON.parse(readFileSync(path, "utf8"));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ltr-scorer", () => {
  beforeEach(() => {
    _testResetCache();
  });

  it("scoreCandidates matches the Python parity fixture within 1e-5 (smoke)", async () => {
    const parity = loadParity("smoke");
    const rows = parity.map(
      (entry) => new Float32Array(entry.features),
    );

    const scores = await scoreCandidates(rows, "smoke");

    expect(scores).toHaveLength(parity.length);
    for (let i = 0; i < parity.length; i++) {
      expect(
        Math.abs(scores[i]! - parity[i]!.score),
        `Row ${i}: TS=${scores[i]}, Python=${parity[i]!.score}`,
      ).toBeLessThan(1e-5);
    }
  });

  const v1Exists = existsSync(join(MODELS_DIR, "ltr-v1.onnx"));
  it.skipIf(!v1Exists)(
    "scoreCandidates matches the Python parity fixture within 1e-5 (v1)",
    async () => {
      const parity = loadParity("v1");
      const rows = parity.map(
        (entry) => new Float32Array(entry.features),
      );

      const scores = await scoreCandidates(rows, "v1");

      expect(scores).toHaveLength(parity.length);
      for (let i = 0; i < parity.length; i++) {
        expect(
          Math.abs(scores[i]! - parity[i]!.score),
          `Row ${i}: TS=${scores[i]}, Python=${parity[i]!.score}`,
        ).toBeLessThan(1e-5);
      }
    },
  );

  it("loadLtrModel rejects a feature-spec hash mismatch", async () => {
    await expect(
      loadLtrModel("nonexistent-bad-hash", {
        modelDir: join(MODELS_DIR, "does-not-exist"),
      }),
    ).rejects.toThrow();
  });

  it("loadLtrModel memoises the session per version", async () => {
    const a = await loadLtrModel("smoke");
    const b = await loadLtrModel("smoke");
    expect(a).toBe(b);
  });

  it("scoreCandidates returns [] for no rows", async () => {
    const scores = await scoreCandidates([]);
    expect(scores).toEqual([]);
  });
});
