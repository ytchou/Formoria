import { describe, expect, it } from "vitest";

import en from "../../../messages/en.json";
import zhTW from "../../../messages/zh-TW.json";

/**
 * The landing namespace was recut for the six trust zones (DEV-1479). Two of its
 * keys survive the recut for reasons that are invisible from the homepage, so
 * they are pinned here: `metadata.*` is the site-wide `%s | Formoria` title
 * template read by `[locale]/layout.tsx`, and `manifesto.headline` is the text
 * baked into the site-wide OG image, which statically imports both catalogues.
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
  // `manifesto.body3` stays dead: the band renders two body paragraphs, not
  // the three production's copy carried. body1/body2/cta came BACK on
  // 2026-08-17 with the band itself.
  "manifesto.body3",
  // The seam section was replaced by that band, so its supporting copy has no
  // renderer. Only `trustSeam.line` survives, for /og/trust.
  "trustSeam.note",
  "trustSeam.cta",
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

  it("the trust commitment ships even though no homepage section states it", () => {
    // The manifesto band replaced the trust seam on the homepage (2026-08-17),
    // so `/og/trust/opengraph-image.tsx` is now the only build-time consumer of
    // this line. It statically imports both catalogues and reads the key —
    // deleting it is a build-time type error, and it is the commitment in
    // docs/strategy/brand-voice.md, so it is pinned by value here.
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
      // Also the aria-label on both hero category navs, not just HeroStats.
      "hero.statsCategories",
      // The hero now lists every L1, so the "all categories" escape hatch is
      // gone and this eyebrow labels the chip block in its place.
      "hero.categoriesEyebrow",
      "selectedProducts.heading",
      "selectedProducts.note",
      "selectedProducts.showMore",
      // The reveal control is a disclosure, so it needs both of its labels.
      "selectedProducts.showLess",
      // `.line` only — it is read by /og/trust, not by any landing zone. The
      // seam section it used to render was replaced by the manifesto band.
      "trustSeam.line",
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
