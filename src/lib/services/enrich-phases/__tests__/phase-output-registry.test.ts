import { describe, expect, it } from "vitest";
import {
  depositPhaseOutput,
  buildPendingPatch,
  MERGE_ORDER,
  SLOT_ALLOWED_KEYS,
  type PhaseOutputRegistry,
} from "../types";
import {
  BLOCK_ORDER,
  MERGE_ORDER_EXCEPTIONS,
  SLOT_BLOCK,
} from "@/lib/constants/enrich-phases";

describe("depositPhaseOutput", () => {
  it("writes to the named slot", () => {
    const state = { outputs: {} as PhaseOutputRegistry };
    depositPhaseOutput(state, "detect", { slug: "my-brand" });

    expect(state.outputs.detect).toEqual({ slug: "my-brand" });
  });

  it("throws on second write to same slot", () => {
    const state = { outputs: {} as PhaseOutputRegistry };
    depositPhaseOutput(state, "detect", { slug: "my-brand" });

    expect(() =>
      depositPhaseOutput(state, "detect", { slug: "other" }),
    ).toThrow(/detect/);
  });

  it("throws on excess keys not in slot", () => {
    const state = { outputs: {} as PhaseOutputRegistry };
    const output = { slug: "my-brand", bogus: "nope" } as never;

    expect(() => depositPhaseOutput(state, "detect", output)).toThrow(/bogus/);
  });
});

describe("buildPendingPatch", () => {
  it("merges in MERGE_ORDER", () => {
    const registry: PhaseOutputRegistry = {
      linkExpansion: { social_instagram: "https://instagram.com/old" },
      acquire: { social_instagram: "https://instagram.com/new" },
      editorial: { category: "food" },
      tags: { category: "lifestyle" },
    };

    const patch = buildPendingPatch(registry);

    // acquire comes after linkExpansion, so its value wins
    expect(patch.social_instagram).toBe("https://instagram.com/new");
    // tags comes after editorial, so its category wins
    expect(patch.category).toBe("lifestyle");
  });

  it("skips empty slots", () => {
    const registry: PhaseOutputRegistry = {
      detect: { slug: "test-brand" },
      // linkExpansion is undefined (not populated)
    };

    const patch = buildPendingPatch(registry);

    expect(patch).toEqual({ slug: "test-brand" });
    expect(Object.keys(patch)).toEqual(["slug"]);
  });

  it("returns empty object for empty registry", () => {
    const registry: PhaseOutputRegistry = {};

    const patch = buildPendingPatch(registry);

    expect(patch).toEqual({});
  });
});

describe("MERGE_ORDER ↔ SLOT_ALLOWED_KEYS parity", () => {
  it("MERGE_ORDER covers every phase in SLOT_ALLOWED_KEYS", () => {
    expect(new Set(MERGE_ORDER)).toEqual(
      new Set(Object.keys(SLOT_ALLOWED_KEYS)),
    );
  });

  it("every MERGE_ORDER phase has a non-empty allowed-keys Set", () => {
    for (const phase of MERGE_ORDER) {
      expect(SLOT_ALLOWED_KEYS[phase].size).toBeGreaterThan(0);
    }
  });
});

describe("MERGE_ORDER -> BLOCK_ORDER projection", () => {
  it("merge_order_projects_onto_block_order", () => {
    const blockIndices = MERGE_ORDER.map((slot) => {
      const block = SLOT_BLOCK[slot];
      expect(block, `SLOT_BLOCK missing key ${slot}`).toBeDefined();
      return { slot, block, index: BLOCK_ORDER.indexOf(block) };
    });

    // Build exception lookup: (preceding slot, following slot) pairs
    const exceptionPairs = new Set(
      MERGE_ORDER_EXCEPTIONS.map((e) => `${e.slot}|${e.precedesSlot}`),
    );

    for (let i = 1; i < blockIndices.length; i++) {
      const prev = blockIndices[i - 1]!;
      const curr = blockIndices[i]!;
      if (curr.index < prev.index) {
        const pairKey = `${prev.slot}|${curr.slot}`;
        expect(
          exceptionPairs.has(pairKey),
          `${prev.slot} (${prev.block}, idx ${prev.index}) -> ${curr.slot} (${curr.block}, idx ${curr.index}) is not non-decreasing and not a declared exception`,
        ).toBe(true);
      }
    }
  });
});
