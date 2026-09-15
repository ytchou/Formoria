import { describe, expect, it } from "vitest";
import {
  depositPhaseOutput,
  buildPendingPatch,
  MERGE_ORDER,
  type PhaseOutputRegistry,
} from "../types";

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

    expect(() => depositPhaseOutput(state, "detect", output)).toThrow(
      /bogus/,
    );
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

describe("MERGE_ORDER", () => {
  it("has exactly 8 phases in execution order", () => {
    expect(MERGE_ORDER).toEqual([
      "detect",
      "linkExpansion",
      "acquire",
      "names",
      "editorial",
      "categoryDerivation",
      "products",
      "tags",
    ]);
  });
});
