import { describe, expect, it } from "vitest";

import en from "../../../messages/en.json";
import zhTW from "../../../messages/zh-TW.json";

/**
 * The landing namespace was recut for the current homepage zones (DEV-1479,
 * then DEV-1607). Two of its keys survive for reasons that are invisible from
 * the homepage, so they are pinned here: `metadata.*` is the site-wide
 * `%s | Formoria` title template read by `[locale]/layout.tsx`, and
 * `trustSeam.line` is the commitment baked into the `/og/trust` card, which
 * statically imports both catalogues and is now its only consumer.
 */
type MessageNode = { [key: string]: string | MessageNode };

function flatten(
  node: MessageNode,
  prefix = "",
  keys: string[] = [],
): string[] {
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

/** Keys whose surfaces were deleted by the landing-zone restructure. */
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
  // The homepage glossary is owned by About and FAQ now.
  "trust.note",
  "trust.listedTitle",
  "trust.listedBody",
  "trust.selectedTitle",
  "trust.selectedBody",
  "trust.suppliedTitle",
  "trust.suppliedBody",
  // The feature-request board was retired, so the closing band lost its second
  // button and the whole `featureRequestBand` namespace went with it.
  "featureRequestBand.headline",
  "featureRequestBand.body",
  "featureRequestBand.cta",
  // The wall's continuation strip is gone; its trails moved to their own zone.
  "selectedProducts.continuationHeading",
  "selectedProducts.trailLinksLabel",
  "selectedProducts.categoryLinksLabel",
  "selectedProducts.brandsLink",
  // BrandShowcase replaced by BrandStrip — showcase keys are dead.
  "showcase.heading",
  "showcase.subheading",
  "showcase.browseAll",
  // Inline manifesto PhotoBand replaced by MissionCloser component.
  "manifesto.headline",
  "manifesto.body1",
  "manifesto.body2",
  "manifesto.cta",
  // ProductWall replaced by CuratedProductGrid — old wall label keys are dead.
  "selectedProducts.heading",
  "selectedProducts.note",
  "selectedProducts.showMore",
  "selectedProducts.showLess",
];

describe("landing namespace", () => {
  it("zh-TW and en landing key sets are identical", () => {
    const zhKeys = new Set(flatten(zhLanding));
    const enKeys = new Set(flatten(enLanding));

    const onlyInZh = [...zhKeys].filter((key) => !enKeys.has(key)).sort();
    const onlyInEn = [...enKeys].filter((key) => !zhKeys.has(key)).sort();

    expect({ onlyInZh, onlyInEn }).toEqual({ onlyInZh: [], onlyInEn: [] });
  });

  // Bug caught: deleting the homepage renderer without deleting its bilingual
  // trust copy leaves a dead namespace that can drift from About and FAQ.
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
    expect(zhLanding).not.toHaveProperty("featureRequestBand");
    expect(enLanding).not.toHaveProperty("featureRequestBand");
    expect(zhLanding).not.toHaveProperty("trust");
    expect(enLanding).not.toHaveProperty("trust");
    expect(zhLanding).not.toHaveProperty("showcase");
    expect(enLanding).not.toHaveProperty("showcase");
    expect(zhLanding).not.toHaveProperty("manifesto");
    expect(enLanding).not.toHaveProperty("manifesto");
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

  it("the trust commitment ships for its OG surface", () => {
    // `/og/trust/opengraph-image.tsx` statically imports both catalogues and
    // reads this key, so deleting it is a build-time type error. The commitment
    // remains on About, FAQ, and the OG surface, not the homepage glossary.
    expect(resolve(zhLanding, "trustSeam.line")).toBeTruthy();
    expect(resolve(enLanding, "trustSeam.line")).toBeTruthy();
  });

  it("MissionCloser copy ships in both catalogues", () => {
    for (const catalogue of [zhLanding, enLanding]) {
      for (const key of ["headline", "subtitle", "cta"]) {
        expect(resolve(catalogue, `missionCloser.${key}`)).toBeTruthy();
      }
    }
  });

  it("keeps the keys the remaining landing zones render", () => {
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
      // CuratedProductGrid reads its product-tile labels from this namespace.
      "selectedProducts.productCta",
      "selectedProducts.brandSiteCta",
      "selectedProducts.unavailable",
      // Read by /og/trust; the homepage no longer renders the glossary that
      // used to explain the three labels below.
      "trustSeam.line",
      "latestStories.heading",
      "latestStories.note",
      "latestStories.linkText",
      "trails.heading",
      "trails.note",
      "trails.linkText",
      "trails.eyebrow",
      "trails.cta",
      // CuratedProductGrid's own copy — selection headline, subtitle, CTA.
      "selection.headline",
      "selection.subtitle",
      "selection.cta",
      // MissionCloser's copy — the closing mission band.
      "missionCloser.headline",
      "missionCloser.subtitle",
      "missionCloser.cta",
      // BrandStrip's copy — the count line and browse-all link.
      "brands.count",
      "brands.browseAll",
      "brands.pause",
      "brands.resume",
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

  // Bug caught: presentational arrows in translated labels become part of the
  // accessible name and can be duplicated when renderers add the shared icon.
  it("keeps editorial action arrows out of bilingual labels", () => {
    const paths = [
      "landing.latestStories.linkText",
      "landing.trails.linkText",
      "landing.selection.cta",
      "landing.missionCloser.cta",
      "landing.brands.browseAll",
      "about.guide.cta",
    ];

    for (const catalogue of [zhTW, en]) {
      for (const path of paths) {
        expect(
          resolve(catalogue as unknown as MessageNode, path),
          path,
        ).not.toMatch(/→|->/);
      }
    }
  });
});
