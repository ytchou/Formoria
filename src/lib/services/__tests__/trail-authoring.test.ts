import { describe, expect, it } from "vitest";

import { trailAuthoringWarnings } from "../trail-authoring";

/**
 * `trailAuthoringWarnings` is an AUTHORING aid, not a render gate: nothing it
 * returns changes what a visitor sees. The frontmatter contract is enforced in
 * CI, and the old supply/subcategory heuristics are gone — so the fixtures below
 * carry only what the two surviving warnings read.
 */
const baseFrontmatter = {
  draft: false,
  sections: [
    { key: "first", title: "First" },
    { key: "second", title: "Second" },
    { key: "third", title: "Third" },
  ],
};

function product(sectionKey: string) {
  return { sectionKey };
}

describe("trailAuthoringWarnings", () => {
  it("flags a draft trail", () => {
    const warnings = trailAuthoringWarnings({
      frontmatter: { ...baseFrontmatter, draft: true },
      products: [product("first"), product("second"), product("third")],
    });

    expect(warnings).toEqual(["draft"]);
  });

  it("flags a declared section with no products", () => {
    const warnings = trailAuthoringWarnings({
      frontmatter: baseFrontmatter,
      products: [product("first"), product("second")],
    });

    expect(warnings).toContain("unplaced_section");
  });

  it("returns nothing for a published fully placed trail", () => {
    // The real pilot shape: 9 products spread across the 3 declared sections.
    const pilot = [
      ...Array.from({ length: 4 }, () => product("first")),
      ...Array.from({ length: 3 }, () => product("second")),
      ...Array.from({ length: 2 }, () => product("third")),
    ];

    expect(
      trailAuthoringWarnings({ frontmatter: baseFrontmatter, products: pilot }),
    ).toEqual([]);
  });

  // No supply floor survives: a trail is not defective for being small, only
  // for declaring a section it never fills.
  it("does not flag on product count alone", () => {
    const warnings = trailAuthoringWarnings({
      frontmatter: baseFrontmatter,
      products: [product("first"), product("second"), product("third")],
    });

    expect(warnings).toEqual([]);
  });
});
