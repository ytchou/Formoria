import { describe, expect, it } from "vitest";

import {
  trailAuthoringWarnings,
  unplacedSectionKeys,
} from "../trail-authoring";

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

  // A failed placement read reaches this as `products: null`. Only the section
  // check consumes products, so the draft flag must survive it — losing it
  // would let a broken query make an unpublished trail look publishable.
  it("keeps the draft flag when the product read failed", () => {
    expect(
      trailAuthoringWarnings({
        frontmatter: { ...baseFrontmatter, draft: true },
        products: null,
      }),
    ).toEqual(["draft"]);
  });

  it("invents no section warning when the product read failed", () => {
    expect(
      trailAuthoringWarnings({ frontmatter: baseFrontmatter, products: null }),
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

/**
 * The same comparison `trailAuthoringWarnings` reduces to a boolean, exposed as
 * the keys themselves (DEV-1520). The nightly supply-decay report names the
 * decayed section, so it needs the keys; the admin panel only needs to know
 * that one exists.
 */
describe("unplacedSectionKeys", () => {
  it("returns the keys of declared sections with no products", () => {
    expect(
      unplacedSectionKeys({
        frontmatter: baseFrontmatter,
        products: [product("second")],
      }),
    ).toEqual(["first", "third"]);
  });

  it("returns empty for a fully placed trail", () => {
    // The real pilot shape: 9 products spread across the 3 declared sections.
    const pilot = [
      ...Array.from({ length: 4 }, () => product("first")),
      ...Array.from({ length: 3 }, () => product("second")),
      ...Array.from({ length: 2 }, () => product("third")),
    ];

    expect(
      unplacedSectionKeys({ frontmatter: baseFrontmatter, products: pilot }),
    ).toEqual([]);
  });

  // A failed placement read must never read as total decay: reporting every
  // declared key would turn one broken query into a report that says the whole
  // trail lost its slate.
  it("returns empty when products is null", () => {
    expect(
      unplacedSectionKeys({ frontmatter: baseFrontmatter, products: null }),
    ).toEqual([]);
  });
});
