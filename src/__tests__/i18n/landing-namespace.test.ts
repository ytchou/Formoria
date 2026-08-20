import { describe, expect, it } from "vitest";

import en from "../../../messages/en.json";
import zhTW from "../../../messages/zh-TW.json";

/**
 * The landing namespace was recut for the six trust zones (DEV-1479). Two of its
 * keys survive for reasons that are invisible from the homepage, so they are
 * pinned here: `metadata.*` is the site-wide `%s | Formoria` title template read
 * by `[locale]/layout.tsx`, and `trustSeam.line` is the commitment baked into
 * the `/og/trust` card, which statically imports both catalogues and is now its
 * only consumer. `manifesto.headline` is NOT one of them — it is rendered on the
 * homepage again by the restored manifesto band, and is asserted below with the
 * rest of that band's copy.
 */
type MessageNode = { [key: string]: string | MessageNode };

function flatten(node: MessageNode, prefix = "", keys: string[] = []): string[] {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      keys.push(path);
    } else {
      flatten(value, path, keys);
    }
  }
  return keys;
}

function resolve(node: MessageNode, path: string): string | undefined {
  const value = path
    .split(".")
    .reduce<string | MessageNode | undefined>(
      (current, segment) =>
        typeof current === "object" && current !== null
          ? current[segment]
          : undefined,
      node,
    );
  return typeof value === "string" ? value : undefined;
}

const zhLanding = zhTW.landing as unknown as MessageNode;
const enLanding = en.landing as unknown as MessageNode;

/** Keys whose surfaces were deleted by the trust-zone restructure. */
const DEAD_KEYS = [
  "showcase.all",
  "showcase.filterLabel",
  "showcase.browseAllCategory",
  "showcase.emptyCategory",
  "showcase.showAll",
  "valueChips.heading",
  "valueChips.all",
  "valueChips.browseAll",
  "valueChips.browseAllValue",
  "valueChips.emptyValue",
  "categoryGrid.heading",
  // The new-brands rail goes with the restructure (D12).
  "newBrands.heading",
  "newBrands.linkText",
  // `hero-stats.tsx` was deleted with the hero recut. `about.hero.statsBrands`
  // is a DIFFERENT namespace and still ships — only the landing copy is dead.
  "hero.statsBrands",
  // The hero's chip row moved into the persistent nav (D18), so both keys that
  // existed only to label it — the nav landmark's name and the eyebrow above
  // the block — died with `hero-category-chips.tsx`.
  "hero.statsCategories",
  "hero.categoriesEyebrow",
  // The seam section was replaced by that band, so its supporting copy has no
  // renderer. Only `trustSeam.line` survives, for /og/trust.
  "trustSeam.note",
  "trustSeam.cta",
  // The closing band folded two stacked asks into one block with two buttons,
  // so the feature request keeps only its button label.
  "featureRequestBand.headline",
  "featureRequestBand.body",
  // The wall's continuation strip is gone; its trails moved to their own zone.
  "selectedProducts.continuationHeading",
  "selectedProducts.trailLinksLabel",
  "selectedProducts.categoryLinksLabel",
  "selectedProducts.brandsLink",
];

describe("landing namespace", () => {
  it("zh-TW and en landing key sets are identical", () => {
    const zhKeys = new Set(flatten(zhLanding));
    const enKeys = new Set(flatten(enLanding));

    const onlyInZh = [...zhKeys].filter((key) => !enKeys.has(key)).sort();
    const onlyInEn = [...enKeys].filter((key) => !zhKeys.has(key)).sort();

    expect({ onlyInZh, onlyInEn }).toEqual({ onlyInZh: [], onlyInEn: [] });
  });

  it("dead keys are gone", () => {
    for (const key of DEAD_KEYS) {
      expect(resolve(zhLanding, key), `zh-TW landing.${key}`).toBeUndefined();
      expect(resolve(enLanding, key), `en landing.${key}`).toBeUndefined();
    }

    expect(zhLanding).not.toHaveProperty("valueChips");
    expect(enLanding).not.toHaveProperty("valueChips");
    expect(zhLanding).not.toHaveProperty("categoryGrid");
    expect(enLanding).not.toHaveProperty("categoryGrid");
    expect(zhLanding).not.toHaveProperty("newBrands");
    expect(enLanding).not.toHaveProperty("newBrands");
  });

  it("the canonical promise ships", () => {
    const hero = Object.values(zhLanding.hero as MessageNode).join(" ");

    expect(hero).toContain("生活可以更像自己一點");
  });

  it("site-wide metadata keys survive", () => {
    // `[locale]/layout.tsx` uses these as the title template and the default
    // description for EVERY route, not just `/`.
    for (const catalogue of [zhLanding, enLanding]) {
      expect(resolve(catalogue, "metadata.title")).toBeTruthy();
      expect(resolve(catalogue, "metadata.description")).toBeTruthy();
    }
  });

  it("the trust commitment ships and the homepage states it again", () => {
    // `/og/trust/opengraph-image.tsx` statically imports both catalogues and
    // reads this key, so deleting it is a build-time type error. The homepage
    // trust band renders it as a heading again as of the v2 rebuild. It is the
    // commitment in docs/strategy/brand-voice.md, so it is pinned by value.
    expect(resolve(zhLanding, "trustSeam.line")).toBe("收錄與選物，清楚分開");
    expect(resolve(enLanding, "trustSeam.line")).toBeTruthy();
  });

  it("the manifesto band's copy ships in both catalogues", () => {
    for (const catalogue of [zhLanding, enLanding]) {
      for (const key of ["headline", "body1", "body2", "cta"]) {
        expect(resolve(catalogue, `manifesto.${key}`)).toBeTruthy();
      }
    }
    expect(resolve(zhLanding, "manifesto.headline")).toBe("讓台灣品牌重新回到大眾目光");
  });

  it("keeps the keys the new trust zones render", () => {
    const required = [
      "hero.headline",
      "hero.subheadline",
      "hero.searchLabel",
      "hero.searchPlaceholder",
      "hero.browseCta",
      // The editorial opener's own three lines: a 黑體 eyebrow, the promise as
      // the display line (`headline`, above), and the lede under it. The
      // secondary path reads "or <browseCta>", so its connector is copy too.
      "hero.eyebrow",
      "hero.lede",
      "hero.browsePrefix",
      "selectedProducts.heading",
      "selectedProducts.note",
      "selectedProducts.showMore",
      // The reveal control is a disclosure, so it needs both of its labels.
      "selectedProducts.showLess",
      // Read by /og/trust AND, since the v2 rebuild, by the homepage trust band
      // that renders it as a heading over the three-column explanation below.
      "trustSeam.line",
      // The trust IA as prose, never as badges: one note plus a title and a
      // body for each of the three labels the homepage is allowed to explain.
      "trust.note",
      "trust.listedTitle",
      "trust.listedBody",
      "trust.selectedTitle",
      "trust.selectedBody",
      "trust.suppliedTitle",
      "trust.suppliedBody",
      "latestStories.heading",
      "trails.heading",
      "trails.note",
      "trails.linkText",
      "manifesto.headline",
      "manifesto.body1",
      "manifesto.body2",
      "manifesto.cta",
      "showcase.heading",
      "showcase.subheading",
      "showcase.browseAll",
    ];

    for (const key of required) {
      expect(resolve(zhLanding, key), `zh-TW landing.${key}`).toBeTruthy();
      expect(resolve(enLanding, key), `en landing.${key}`).toBeTruthy();
    }
  });

  it("the browse CTA is an invitation, never a brand count", () => {
    expect(resolve(zhLanding, "hero.browseCta")).not.toMatch(/\d/);
    expect(resolve(enLanding, "hero.browseCta")).not.toMatch(/\d/);
  });
});
