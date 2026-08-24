import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { L1_CATEGORIES, L2_SUBCATEGORIES, isVisibleCategory } from "@/lib/taxonomy/ontology";
import {
  CACHEABLE_DIRECTORY_QUERY_KEYS,
  decideDirectoryTaxonomyRedirect,
  isDirectoryIndexPath,
} from "@/proxy";

/** A `next.config.ts` redirect row, flattened out of Next's permanent/statusCode union. */
type RedirectRule = {
  source: string;
  destination: string;
  permanent?: boolean;
  statusCode?: number;
};

async function configuredRedirects(): Promise<RedirectRule[]> {
  const rows = (await nextConfig.redirects?.()) ?? [];
  return rows.map((row) => ({
    source: row.source,
    destination: row.destination,
    permanent: (row as { permanent?: boolean }).permanent,
    statusCode: (row as { statusCode?: number }).statusCode,
  }));
}

function ruleFor(
  rules: RedirectRule[],
  source: string,
): RedirectRule | undefined {
  return rules.find((rule) => rule.source === source);
}

/**
 * A Next `source` is a PATTERN, not a literal: `/category/:category` and
 * `/categories/:slug*` both shadow whole path spaces. Comparing sources as
 * strings would report a wildcard that swallows every live L1 as no match at
 * all, so they are compiled before being tested.
 */
function sourceMatcher(source: string): RegExp {
  const pattern = source
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/:[A-Za-z0-9_]+\*/g, ".*")
    .replace(/:[A-Za-z0-9_]+/g, "[^/]+");
  return new RegExp(`^${pattern}$`);
}

/** Drop a locale prefix so `/en/categories/kids` compares as `/categories/kids`. */
function withoutLocale(path: string): string {
  return path.replace(/^\/(en|zh-TW)(?=\/)/, "");
}

const LIVE_CATEGORY_PATHS = L1_CATEGORIES.flatMap((category) => [
  `/categories/${category.slug}`,
  `/en/categories/${category.slug}`,
  `/zh-TW/categories/${category.slug}`,
]);

describe("directory taxonomy redirects", () => {
  it("redirects a pure single-category state", () => {
    expect(decideDirectoryTaxonomyRedirect("/brands", "category=home")).toEqual(
      {
        action: "redirect",
        status: 301,
        pathname: "/categories/home",
      },
    );
  });

  it("redirects a pure category+sub state and preserves page", () => {
    expect(
      decideDirectoryTaxonomyRedirect(
        "/brands",
        "category=home&sub=furniture&page=2",
      ),
    ).toEqual({
      action: "redirect",
      status: 301,
      pathname: "/categories/home/furniture?page=2",
    });
  });

  it("preserves unrecognized query params while removing taxonomy params", () => {
    expect(
      decideDirectoryTaxonomyRedirect(
        "/brands",
        "category=home&sub=furniture&page=2&utm_source=newsletter",
      ),
    ).toEqual({
      action: "redirect",
      status: 301,
      pathname: "/categories/home/furniture?page=2&utm_source=newsletter",
    });
  });

  it.each(["search=chairs", "verification=owned", "sort=name"])(
    "does not redirect when %s is present",
    (query) => {
      expect(
        decideDirectoryTaxonomyRedirect("/brands", `category=home&${query}`)
          .action,
      ).toBe("none");
    },
  );

  it("ignores the retired price input when redirecting taxonomy URLs", () => {
    expect(
      decideDirectoryTaxonomyRedirect("/brands", "category=home&price=2"),
    ).toEqual({
      action: "redirect",
      status: 301,
      pathname: "/categories/home",
    });
  });

  it("does not redirect multi-valued category or sub", () => {
    expect(
      decideDirectoryTaxonomyRedirect("/brands", "category=home,fashion")
        .action,
    ).toBe("none");
    expect(
      decideDirectoryTaxonomyRedirect(
        "/brands",
        "category=home&sub=furniture,lighting",
      ).action,
    ).toBe("none");
  });

  it("does not redirect an invalid category or a wrong-parent sub", () => {
    expect(
      decideDirectoryTaxonomyRedirect("/brands", "category=zzz").action,
    ).toBe("none");
    expect(
      decideDirectoryTaxonomyRedirect(
        "/brands",
        "category=home&sub=tops-and-tshirts",
      ),
    ).toEqual({
      action: "redirect",
      status: 301,
      pathname: "/categories/home",
    });
  });

  it("edge-cache predicate accepts bare category paths", () => {
    expect(isDirectoryIndexPath("/categories/home")).toBe(true);
    expect(isDirectoryIndexPath("/categories/home/furniture")).toBe(true);
  });

  it("isDirectoryIndexPath accepts allow-listed filter keys", () => {
    expect(isDirectoryIndexPath("/brands", "?category=food-drink")).toBe(true);
    expect(isDirectoryIndexPath("/brands", "?page=2&sort=newest")).toBe(true);
    expect(
      isDirectoryIndexPath(
        "/brands",
        "?category=fashion&sub=backpacks&material=leather&verification=all",
      ),
    ).toBe(true);
  });

  it("isDirectoryIndexPath rejects free-text search", () => {
    expect(isDirectoryIndexPath("/brands", "?search=tea")).toBe(false);
    expect(isDirectoryIndexPath("/brands", "?page=2&search=")).toBe(false);
  });

  it("isDirectoryIndexPath rejects retired and unknown keys", () => {
    expect(isDirectoryIndexPath("/brands", "?price=1,3")).toBe(false);
    expect(isDirectoryIndexPath("/brands", "?foo=bar")).toBe(false);
    expect(
      isDirectoryIndexPath("/brands", "?category=food-drink&utm_source=x"),
    ).toBe(false);
  });

  it("isDirectoryIndexPath applies the same allow-list to category paths", () => {
    expect(isDirectoryIndexPath("/categories/home", "?page=2")).toBe(true);
    expect(isDirectoryIndexPath("/categories/home", "?search=x")).toBe(false);
  });

  it("isDirectoryIndexPath accepts in-vocabulary filter values", () => {
    expect(isDirectoryIndexPath("/brands", "?page=1")).toBe(true);
    expect(isDirectoryIndexPath("/brands", "?page=60")).toBe(true);
    expect(isDirectoryIndexPath("/brands", "?sort=name")).toBe(true);
    expect(isDirectoryIndexPath("/brands", "?verification=mit-declared")).toBe(
      true,
    );
    expect(isDirectoryIndexPath("/brands", "?material=leather")).toBe(true);
    expect(isDirectoryIndexPath("/brands", "?sub=backpacks")).toBe(true);
  });

  // Every one of these renders EXACTLY the page it renders today: the parsers
  // drop or clamp an out-of-vocabulary term. `false` here withholds an edge
  // cache key, nothing more -- which is the whole point, because a bot walking
  // `?page=<random>` would otherwise mint unbounded always-MISS keys through an
  // allow-listed param.
  it("isDirectoryIndexPath rejects out-of-vocabulary filter values", () => {
    expect(isDirectoryIndexPath("/brands", "?page=abc")).toBe(false);
    expect(isDirectoryIndexPath("/brands", "?page=0")).toBe(false);
    expect(isDirectoryIndexPath("/brands", "?page=-1")).toBe(false);
    expect(isDirectoryIndexPath("/brands", "?page=999999999")).toBe(false);
    expect(isDirectoryIndexPath("/brands", "?page=")).toBe(false);
    expect(isDirectoryIndexPath("/brands", "?sort=cheapest")).toBe(false);
    expect(isDirectoryIndexPath("/brands", "?verification=maybe")).toBe(false);
    expect(isDirectoryIndexPath("/brands", "?price=9")).toBe(false);
    expect(isDirectoryIndexPath("/brands", "?category=not-a-category")).toBe(
      false,
    );
    expect(isDirectoryIndexPath("/brands", "?sub=not-a-subcategory")).toBe(
      false,
    );
    expect(isDirectoryIndexPath("/brands", "?material=unobtainium")).toBe(
      false,
    );
  });

  it("isDirectoryIndexPath rejects a repeated key", () => {
    expect(isDirectoryIndexPath("/brands", "?page=1&page=2")).toBe(false);
    expect(
      isDirectoryIndexPath("/brands", "?category=home&category=food-drink"),
    ).toBe(false);
  });

  it("isDirectoryIndexPath rejects one bad value among good ones", () => {
    expect(
      isDirectoryIndexPath("/brands", "?category=home&page=999999999"),
    ).toBe(false);
    expect(isDirectoryIndexPath("/categories/home", "?page=abc")).toBe(false);
  });

  it("a rejected value is a cacheability verdict, not a routing one", () => {
    // The predicate only gates the edge `Cache-Control` header, so a junk value
    // must leave the taxonomy redirect decision untouched: the page still
    // renders, and nothing 404s or redirects because of it.
    expect(isDirectoryIndexPath("/brands", "?page=999999999")).toBe(false);
    expect(
      decideDirectoryTaxonomyRedirect("/brands", "page=999999999"),
    ).toEqual({ action: "none" });
  });

  it("the allow-list is exactly the directory filter keys minus search", () => {
    expect([...CACHEABLE_DIRECTORY_QUERY_KEYS].sort()).toEqual([
      "category",
      "material",
      "page",
      "sort",
      "sub",
      "verification",
    ]);
    expect(CACHEABLE_DIRECTORY_QUERY_KEYS.has("search")).toBe(false);
  });
});

/**
 * DEV-1510 split `kids-pets` into the live L1s `kids` and `pets`. The three
 * cases below pin the redirect table against the failure that split creates:
 * a retirement row left pointing at `/categories/kids-pets` makes a brand-new
 * L1 unreachable by URL, and the chain still answers 200 in local dev — the
 * loss only surfaces weeks later as a deindexed category in Search Console.
 *
 * `permanent: true` is what the config can express; Next serves it on the wire
 * as a 308, which is what `e2e/tests/public-routing-regressions.spec.ts`
 * asserts. Both are permanent redirects and both pass equity.
 */
describe("retired L1 taxonomy redirects", () => {
  it("pets_is_a_live_route_not_a_redirect", async () => {
    const rules = await configuredRedirects();

    // `pets` is an L1 the ontology owns, so /categories/pets renders.
    expect(L1_CATEGORIES.map((category) => category.slug)).toContain("pets");
    expect(decideDirectoryTaxonomyRedirect("/brands", "category=pets")).toEqual(
      {
        action: "redirect",
        status: 301,
        pathname: "/categories/pets",
      },
    );

    // Generalised past `pets` deliberately: any redirect whose source MATCHES a
    // live L1 shadows a real page, and this loop is what catches the next split.
    const shadowed = rules
      .filter((rule) =>
        LIVE_CATEGORY_PATHS.some((path) =>
          sourceMatcher(rule.source).test(path),
        ),
      )
      .map((rule) => `${rule.source} -> ${rule.destination}`);
    expect(shadowed).toEqual([]);

    // And nothing may hop through the retired parent on the way somewhere else.
    const chained = rules
      .filter((rule) => rule.destination.endsWith("/categories/kids-pets"))
      .map((rule) => `${rule.source} -> ${rule.destination}`);
    expect(chained).toEqual([]);

    // The other half of the same invariant, and the half a split actually
    // breaks: every category destination has to be a category that still
    // renders. `baby-kids -> /categories/kids` is only a repair while `kids`
    // is live; the day an L1 is merged away it becomes a 301 into a 404, which
    // no status check and no `pnpm build` reports.
    //
    // Both depths, deliberately. The one-segment-only filter this replaces
    // could not see a `/categories/<l1>/<l2>` destination at all, so every L2
    // row the DEV-1531 generator emits — the two relocations into `home` and
    // all seventeen reparented rows — was excluded by construction, and the
    // only thing checking them lived inside a generator (`--check`) that no
    // gate ran. An L2 destination is validated as a `(parent, slug)` PAIR:
    // `beverages` is a live L2 under `food-drink` and a retired L1 elsewhere,
    // so a bare-slug check would call a wrong-parent destination live.
    const deadDestinations = rules
      .map((rule) => ({ rule, target: withoutLocale(rule.destination) }))
      // A parameterized destination (`/categories/:category`) resolves per
      // request and cannot be checked against the ontology here.
      .filter(({ target }) =>
        /^\/categories\/[^/:]+(?:\/[^/:]+)?$/.test(target),
      )
      .filter(({ target }) => {
        const tail = target.slice("/categories/".length);
        return tail.includes("/")
          ? !L2_SUBCATEGORIES.some(
              (sub) => tail === `${sub.category}/${sub.slug}`,
            )
          : !L1_CATEGORIES.some((category) => tail === category.slug);
      })
      .map(({ rule }) => `${rule.source} -> ${rule.destination}`);
    expect(deadDestinations).toEqual([]);
  });

  it("baby_kids_redirects_to_kids", async () => {
    const rules = await configuredRedirects();

    expect(ruleFor(rules, "/categories/baby-kids")).toMatchObject({
      destination: "/categories/kids",
      permanent: true,
    });
    expect(ruleFor(rules, "/en/categories/baby-kids")).toMatchObject({
      destination: "/en/categories/kids",
      permanent: true,
    });
    expect(ruleFor(rules, "/zh-TW/categories/baby-kids")).toMatchObject({
      destination: "/categories/kids",
      permanent: true,
    });
  });

  it("kids_pets_redirects_to_brands", async () => {
    const rules = await configuredRedirects();

    // The merged L1 has no successor category — `kids` and `pets` each own half
    // of it — so the directory root is the closest surviving intent, exactly as
    // for the retired `others` bucket.
    expect(ruleFor(rules, "/categories/kids-pets")).toMatchObject({
      destination: "/brands",
      permanent: true,
    });
    expect(ruleFor(rules, "/en/categories/kids-pets")).toMatchObject({
      destination: "/en/brands",
      permanent: true,
    });
    expect(ruleFor(rules, "/zh-TW/categories/kids-pets")).toMatchObject({
      destination: "/brands",
      permanent: true,
    });
  });

  it("crafts_redirects_to_brands", async () => {
    const rules = await configuredRedirects();

    // `crafts` was dissolved rather than merged (DEV-1507): its L2s scattered
    // across `home`, `jewelry`, `bags-accessories` and `stationery`, so no
    // single L1 is the successor and the directory root is the closest
    // surviving intent — the same shape as `kids-pets` and `others`.
    expect(ruleFor(rules, "/categories/crafts")).toMatchObject({
      destination: "/brands",
      permanent: true,
    });
    expect(ruleFor(rules, "/en/categories/crafts")).toMatchObject({
      destination: "/en/brands",
      permanent: true,
    });
    expect(ruleFor(rules, "/zh-TW/categories/crafts")).toMatchObject({
      destination: "/brands",
      permanent: true,
    });

    // Nothing may hop through the dissolved parent on the way somewhere else.
    const chained = rules
      .filter((rule) => rule.destination.endsWith("/categories/crafts"))
      .map((rule) => `${rule.source} -> ${rule.destination}`);
    expect(chained).toEqual([]);
  });

  /**
   * The L1 rows above rescue `/categories/crafts` and `/categories/kids-pets`
   * and nothing else: a Next `source` is a literal path, not a prefix, so all
   * 29 indexed `/categories/<retired-parent>/<l2>` URLs 404 the moment the new
   * ontology ships. The rows these cases pin are generated by
   * `scripts/generate-category-redirects.ts`; the expectations below are
   * written out by hand on purpose, so a regenerated block that quietly loses
   * a node fails here instead of shipping a hole.
   */
  const DELETED_CRAFTS_L2 = [
    "ceramics",
    "woodcraft",
    "metalwork",
    "bamboo-craft",
    "glass-art",
    "natural-dyeing",
    "leather-craft",
    "embroidery",
    "needle-felting",
    "weaving-and-crochet",
  ] as const;

  const RELOCATED_CRAFTS_L2 = [
    ["illustration-and-art", "/categories/home/wall-art"],
    ["dried-flowers-and-floral-design", "/categories/home/floral-arrangements"],
  ] as const;

  const REPARENTED_L2 = [
    ["kids-clothing", "kids"],
    ["family-matching", "kids"],
    ["baby-clothing", "kids"],
    ["baby-bedding", "kids"],
    ["bibs-and-muslin", "kids"],
    ["kids-tableware", "kids"],
    ["toys", "kids"],
    ["learning-aids", "kids"],
    ["play-mats-and-fences", "kids"],
    ["parenting-essentials", "kids"],
    ["pet-food", "pets"],
    ["pet-treats", "pets"],
    ["pet-supplements", "pets"],
    ["pet-apparel", "pets"],
    ["pet-beds-and-scratchers", "pets"],
    ["pet-grooming", "pets"],
    ["pet-supplies", "pets"],
  ] as const;

  it("deleted_crafts_l2_redirects_to_brands", async () => {
    const rules = await configuredRedirects();

    // Ten technique nodes left the vocabulary with no successor anywhere in the
    // ontology, so the directory root is the closest surviving intent — the
    // same landing the dissolved parent itself takes.
    for (const slug of DELETED_CRAFTS_L2) {
      expect(ruleFor(rules, `/categories/crafts/${slug}`)).toMatchObject({
        destination: "/brands",
        permanent: true,
      });
      expect(ruleFor(rules, `/en/categories/crafts/${slug}`)).toMatchObject({
        destination: "/en/brands",
        permanent: true,
      });
      expect(ruleFor(rules, `/zh-TW/categories/crafts/${slug}`)).toMatchObject({
        destination: "/brands",
        permanent: true,
      });
    }
  });

  it("relocated_crafts_l2_redirects_to_its_successor", async () => {
    const rules = await configuredRedirects();

    // These two named a product kind rather than a technique, so they survive
    // the retirement under `home`. Their destinations are two-segment L2 paths,
    // which the L1-level dead-destination sweep above deliberately skips.
    for (const [slug, destination] of RELOCATED_CRAFTS_L2) {
      expect(ruleFor(rules, `/categories/crafts/${slug}`)).toMatchObject({
        destination,
        permanent: true,
      });
      expect(ruleFor(rules, `/en/categories/crafts/${slug}`)).toMatchObject({
        destination: `/en${destination}`,
        permanent: true,
      });
      expect(ruleFor(rules, `/zh-TW/categories/crafts/${slug}`)).toMatchObject({
        destination,
        permanent: true,
      });
    }
  });

  it("reparented_l2_keeps_its_slug_under_the_new_parent", async () => {
    const rules = await configuredRedirects();

    // The `kids-pets` split moved seventeen nodes without renaming any of them:
    // ten to `kids`, seven to `pets`. Only the parent segment changes, so a
    // destination that reuses the old parent is the failure to catch.
    expect(
      REPARENTED_L2.filter(([, parent]) => parent === "kids"),
    ).toHaveLength(10);
    expect(
      REPARENTED_L2.filter(([, parent]) => parent === "pets"),
    ).toHaveLength(7);

    for (const [slug, parent] of REPARENTED_L2) {
      const destination = `/categories/${parent}/${slug}`;
      expect(ruleFor(rules, `/categories/kids-pets/${slug}`)).toMatchObject({
        destination,
        permanent: true,
      });
      expect(ruleFor(rules, `/en/categories/kids-pets/${slug}`)).toMatchObject({
        destination: `/en${destination}`,
        permanent: true,
      });
      expect(
        ruleFor(rules, `/zh-TW/categories/kids-pets/${slug}`),
      ).toMatchObject({
        destination,
        permanent: true,
      });
    }
  });

  it("every_l2_redirect_has_three_locale_forms", async () => {
    const rules = await configuredRedirects();

    // A missing locale form is invisible in production: the prefix-free URL
    // still 308s, and only the `/en/` crawl keeps hitting a 404. zh-TW is the
    // unprefixed default locale, so its destination is prefix-free by design —
    // prefixing it would make the hop land on another redirect.
    const sources = [
      ...DELETED_CRAFTS_L2.map((slug) => `crafts/${slug}`),
      ...RELOCATED_CRAFTS_L2.map(([slug]) => `crafts/${slug}`),
      ...REPARENTED_L2.map(([slug]) => `kids-pets/${slug}`),
    ];
    expect(sources).toHaveLength(29);

    const missing = sources.flatMap((source) =>
      ["", "/en", "/zh-TW"]
        .filter((prefix) => !ruleFor(rules, `${prefix}/categories/${source}`))
        .map((prefix) => `${prefix}/categories/${source}`),
    );
    expect(missing).toEqual([]);

    for (const source of sources) {
      const bare = ruleFor(rules, `/categories/${source}`);
      const zh = ruleFor(rules, `/zh-TW/categories/${source}`);
      const en = ruleFor(rules, `/en/categories/${source}`);
      expect(zh?.destination).toBe(bare?.destination);
      expect(en?.destination).toBe(`/en${bare?.destination}`);
      expect(withoutLocale(en?.destination ?? "")).toBe(bare?.destination);
    }
  });

  it("every_l2_redirect_destination_under_a_deferred_l1_is_still_in_the_ontology", async () => {
    // A deferred L1 still exists in the ontology — its category page redirects
    // to /brands at the page component level (Task 5A), but any redirect
    // destination pointing at it is valid from an ontology standpoint. This test
    // confirms the reparented L2 destinations under deferred parents resolve.
    const rules = await configuredRedirects();
    const deferredDestinations = rules
      .map((rule) => ({ rule, target: withoutLocale(rule.destination) }))
      .filter(({ target }) =>
        /^\/categories\/[^/:]+(?:\/[^/:]+)?$/.test(target),
      )
      .filter(({ target }) => {
        const segments = target.slice("/categories/".length).split("/");
        return segments.length >= 1 && !isVisibleCategory(segments[0]!);
      });

    // Deferred L1s are still valid redirect destinations (they exist in the
    // ontology), so this just confirms they resolve and none point at a truly
    // retired parent.
    for (const { target } of deferredDestinations) {
      const tail = target.slice("/categories/".length);
      if (tail.includes("/")) {
        expect(
          L2_SUBCATEGORIES.some(
            (sub) => tail === `${sub.category}/${sub.slug}`,
          ),
          `${target} is a valid L2`,
        ).toBe(true);
      } else {
        expect(
          L1_CATEGORIES.some((category) => tail === category.slug),
          `${target} is a valid L1`,
        ).toBe(true);
      }
    }
  });

  it("beverages_l2_is_not_shadowed_by_the_retired_l1", async () => {
    const rules = await configuredRedirects();

    // `beverages` is BOTH a retired L1 (`/categories/beverages -> food-drink`)
    // and a live L2 under `food-drink`. Keying the L2 map on the bare slug
    // rather than the (parent, slug) pair would emit a rule for the live page
    // and take it out of the index. `ceramics` is the same hazard from the
    // other side: gone as an L2, alive as a material value.
    expect(ruleFor(rules, "/categories/beverages")).toMatchObject({
      destination: "/categories/food-drink",
    });
    for (const path of [
      "/categories/food-drink/beverages",
      "/en/categories/food-drink/beverages",
      "/zh-TW/categories/food-drink/beverages",
    ]) {
      expect(ruleFor(rules, path)).toBeUndefined();
      expect(
        rules.filter((rule) => sourceMatcher(rule.source).test(path)),
      ).toEqual([]);
    }
  });
});

describe("deferred category page redirects", () => {
  it("deferred L1 category page redirects to /brands", () => {
    // The redirect is in the page component, not in next.config.ts.
    // This test validates the isVisibleCategory predicate matches the deferred set.
    expect(isVisibleCategory("pets")).toBe(false);
    expect(isVisibleCategory("kids")).toBe(false);
    expect(isVisibleCategory("stationery")).toBe(false);
    expect(isVisibleCategory("tech")).toBe(false);
    expect(isVisibleCategory("outdoor")).toBe(false);
    expect(isVisibleCategory("fitness")).toBe(false);
  });

  it("visible L1 category page renders normally", () => {
    expect(isVisibleCategory("home")).toBe(true);
    expect(isVisibleCategory("fashion")).toBe(true);
    expect(isVisibleCategory("beauty")).toBe(true);
    expect(isVisibleCategory("food-drink")).toBe(true);
    expect(isVisibleCategory("bags-accessories")).toBe(true);
    expect(isVisibleCategory("jewelry")).toBe(true);
  });

  it("deferred L1 subcategory page redirects to /brands", () => {
    // Subcategory pages under deferred L1s also redirect
    expect(isVisibleCategory("pets")).toBe(false);
    expect(isVisibleCategory("kids")).toBe(false);
  });
});
