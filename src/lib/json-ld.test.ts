import { afterEach, describe, it, expect, vi } from "vitest";
import {
  buildArticleJsonLd,
  buildBrandJsonLd,
  buildBreadcrumbJsonLd,
  buildCategoryItemListJsonLd,
  buildBrandsItemListJsonLd,
  buildOrganizationJsonLd,
  buildWebSiteJsonLd,
  safeJsonLdStringify,
  type JsonLdObject,
} from "@/lib/json-ld";
import type { Brand } from "@/lib/types";
import enMessages from "../../messages/en.json";
import zhMessages from "../../messages/zh-TW.json";
import { getSiteUrl } from "@/lib/site-url";
import type { Stockist } from "@/lib/types/stockist";

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function makeBrand(overrides: Partial<Brand> = {}): Brand {
  return {
    id: "123",
    name: "茶籽堂 Chatzutang",
    slug: "chatzutang",
    description: "Natural body care with camellia seed oil",
    heroImageUrl: "https://example.com/hero.jpg",
    status: "approved",
    isDemo: false,
    categorySlug: "food-drink",
    categoryLabel: "Food & Beverage",
    foundingYear: 2004,
    city: null,
    purchaseWebsite: "https://chatzutang.com",
    purchasePinkoi: "https://pinkoi.com/chatzutang",
    purchaseShopee: null,
    purchaseMyship: null,
    socialInstagram: "https://instagram.com/chatzutang",
    socialThreads: null,
    socialFacebook: "https://facebook.com/chatzutang",
    otherUrls: [],
    productPhotos: [],
    siteContent: null,
    subcategories: [],
    subcategoriesEn: [],
    descriptionEn: null,
    blurb: null,
    blurbEn: null,
    imageAlts: [],
    contactEmail: "hello@chatzutang.com",
    submittedAt: "2026-01-01T00:00:00Z",
    approvedAt: "2026-01-02T00:00:00Z",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    onboardingDismissedAt: null,
    ...overrides,
  };
}

describe("buildBrandJsonLd", () => {
  function channel(
    overrides: Partial<Stockist> & Pick<Stockist, "name">,
  ): Stockist {
    const { name, ...rest } = overrides;
    return {
      id: `channel-${name}`,
      name,
      regionLabel: "臺北市",
      address: null,
      url: null,
      ownerStatus: "none",
      source: "import",
      status: "confirmed",
      confirmedBy: "evidence",
      ...rest,
    };
  }

  it("returns Organization schema with required fields", () => {
    const jsonLd = buildBrandJsonLd(makeBrand());
    expect(jsonLd["@context"]).toBe("https://schema.org");
    expect(jsonLd["@type"]).toBe("Organization");
    expect(jsonLd.name).toBe("茶籽堂 Chatzutang");
    expect(jsonLd.url).toBe("https://chatzutang.com");
    expect(jsonLd.logo).toBe("https://example.com/hero.jpg");
    expect(jsonLd.foundingDate).toBe("2004");
  });

  it("includes sameAs array from social links", () => {
    const jsonLd = buildBrandJsonLd(makeBrand());
    expect(jsonLd.sameAs).toContain("https://instagram.com/chatzutang");
    expect(jsonLd.sameAs).toContain("https://facebook.com/chatzutang");
  });

  it("omits keywords field", () => {
    const jsonLd = buildBrandJsonLd(makeBrand());
    expect(jsonLd.keywords).toBeUndefined();
  });

  it("includes purchase link URLs in sameAs alongside social links", () => {
    const jsonLd = buildBrandJsonLd(
      makeBrand({
        purchasePinkoi: "https://pinkoi.com/chatzutang",
        purchaseShopee: "https://shopee.tw/chatzutang",
      }),
    );
    expect(jsonLd.sameAs).toContain("https://instagram.com/chatzutang");
    expect(jsonLd.sameAs).toContain("https://facebook.com/chatzutang");
    expect(jsonLd.sameAs).toContain("https://pinkoi.com/chatzutang");
    expect(jsonLd.sameAs).toContain("https://shopee.tw/chatzutang");
  });

  describe("buildBrandJsonLd audit", () => {
    it("never exposes contactEmail as email in the output", () => {
      const withEmail = buildBrandJsonLd(
        makeBrand({ contactEmail: "hello@chatzutang.com" }),
      );
      expect(withEmail.email).toBeUndefined();

      const withoutEmail = buildBrandJsonLd(makeBrand({ contactEmail: null }));
      expect(withoutEmail.email).toBeUndefined();
    });

    it("maps heroImageUrl to logo and omits it when null", () => {
      const withHero = buildBrandJsonLd(
        makeBrand({ heroImageUrl: "https://example.com/hero.jpg" }),
      );
      expect(withHero.logo).toBe("https://example.com/hero.jpg");

      const withoutHero = buildBrandJsonLd(makeBrand({ heroImageUrl: null }));
      expect(withoutHero.logo).toBeUndefined();
    });

    it("includes all non-null social and purchase URLs in sameAs", () => {
      const jsonLd = buildBrandJsonLd(
        makeBrand({
          socialInstagram: "https://instagram.com/chatzutang",
          socialThreads: "https://threads.net/@chatzutang",
          socialFacebook: "https://facebook.com/chatzutang",
          purchaseWebsite: "https://chatzutang.com",
          purchasePinkoi: "https://pinkoi.com/chatzutang",
          purchaseShopee: "https://shopee.tw/chatzutang",
          otherUrls: [{ label: "Blog", url: "https://example.com/brand" }],
        }),
      );

      expect(jsonLd.sameAs).toEqual([
        "https://instagram.com/chatzutang",
        "https://threads.net/@chatzutang",
        "https://facebook.com/chatzutang",
        "https://chatzutang.com",
        "https://pinkoi.com/chatzutang",
        "https://shopee.tw/chatzutang",
        "https://example.com/brand",
      ]);
    });

    it("excludes null and undefined values from sameAs", () => {
      const jsonLd = buildBrandJsonLd(
        makeBrand({
          socialInstagram: null,
          socialThreads: undefined,
          socialFacebook: null,
          purchaseWebsite: null,
          purchasePinkoi: undefined,
          purchaseShopee: null,
          otherUrls: [
            { label: "Blog", url: "" },
            { label: "Docs", url: "https://docs.example.com" },
          ],
        } as unknown as Partial<Brand>),
      );

      expect(jsonLd.sameAs).toEqual(["https://docs.example.com"]);
    });
  });

  it("omits optional fields when null", () => {
    const jsonLd = buildBrandJsonLd(
      makeBrand({
        contactEmail: null,
        socialInstagram: null,
        socialThreads: null,
        socialFacebook: null,
        purchaseWebsite: null,
        purchasePinkoi: null,
        purchaseShopee: null,
        otherUrls: [],
        heroImageUrl: null,
        foundingYear: null,
      }),
    );
    expect(jsonLd.logo).toBeUndefined();
    expect(jsonLd.foundingDate).toBeUndefined();
    expect(jsonLd.sameAs).toBeUndefined();
  });

  it("emits Place entries only for direct stores and showrooms", () => {
    const jsonLd = buildBrandJsonLd(makeBrand(), "zh-TW", undefined, [
      channel({
        name: "茶籽堂大稻埕門市",
        locationType: "direct_store",
        address: "臺北市大同區迪化街一段94號",
      }),
      channel({
        name: "合作選品店",
        locationType: "stockist",
        address: "臺中市西區公益路68號",
      }),
    ]);

    expect(jsonLd.location).toEqual([
      {
        "@type": "Place",
        name: "茶籽堂大稻埕門市",
        address: "臺北市大同區迪化街一段94號",
      },
    ]);
  });

  it("omits location entirely when there are no own places", () => {
    const jsonLd = buildBrandJsonLd(makeBrand(), "zh-TW", undefined, [
      channel({ name: "合作選品店", locationType: "stockist" }),
    ]);

    expect(jsonLd.location).toBeUndefined();
  });

  it("omits null address fields from a Place", () => {
    const jsonLd = buildBrandJsonLd(makeBrand(), "zh-TW", undefined, [
      channel({ name: "茶籽堂預約展示間", locationType: "showroom_studio" }),
    ]);

    expect(jsonLd.location).toEqual([
      { "@type": "Place", name: "茶籽堂預約展示間" },
    ]);
  });

  it("emits ImageObject with description when heroImageAlt provided", () => {
    const jsonLd = buildBrandJsonLd(
      makeBrand({ heroImageAlt: "手工皂禮盒" } as Partial<Brand>),
    );
    expect(jsonLd.logo).toEqual({
      "@type": "ImageObject",
      url: "https://example.com/hero.jpg",
      description: "手工皂禮盒",
    });
  });

  it("emits bare URL when heroImageAlt is null", () => {
    const jsonLd = buildBrandJsonLd(
      makeBrand({ heroImageAlt: null } as Partial<Brand>),
    );
    expect(jsonLd.logo).toBe("https://example.com/hero.jpg");
  });

  it("emits bare URL when heroImageAlt is omitted", () => {
    const jsonLd = buildBrandJsonLd(makeBrand());
    expect(jsonLd.logo).toBe("https://example.com/hero.jpg");
  });

  describe("page-scoped identity", () => {
    const canonicalZh = `${getSiteUrl()}/brands/chatzutang`;
    const canonicalEn = `${getSiteUrl()}/en/brands/chatzutang`;

    it("scopes @id and mainEntityOfPage to the page's own canonical", () => {
      const jsonLd = buildBrandJsonLd(makeBrand(), "en", canonicalEn);

      expect(jsonLd["@id"]).toBe(`${canonicalEn}#organization`);
      expect(jsonLd.mainEntityOfPage).toBe(canonicalEn);
    });

    // The whole point of the field: without it the two editions are
    // indistinguishable descriptions of one entity, which is a canonical
    // consolidation signal on a pair Search Console already flags.
    it("gives the two locale editions different identities", () => {
      const zh = buildBrandJsonLd(makeBrand(), "zh-TW", canonicalZh);
      const en = buildBrandJsonLd(makeBrand(), "en", canonicalEn);

      expect(zh["@id"]).not.toBe(en["@id"]);
      expect(zh.mainEntityOfPage).not.toBe(en.mainEntityOfPage);
    });

    // Both editions describe the same real company; only the documents differ.
    it("keeps the shared external url on both editions", () => {
      const zh = buildBrandJsonLd(makeBrand(), "zh-TW", canonicalZh);
      const en = buildBrandJsonLd(makeBrand(), "en", canonicalEn);

      expect(en.url).toBe(zh.url);
    });

    it("emits neither field when no canonical is supplied", () => {
      const jsonLd = buildBrandJsonLd(makeBrand(), "en");

      expect(jsonLd["@id"]).toBeUndefined();
      expect(jsonLd.mainEntityOfPage).toBeUndefined();
    });
  });
});

describe("buildCategoryItemListJsonLd", () => {
  const mockBrands = [
    { name: "茶籽堂", slug: "cha-zi-tang" },
    { name: "DAYLILY", slug: "daylily" },
    { name: "印花樂", slug: "inblooom" },
  ];

  it("returns valid ItemList JSON-LD", () => {
    const canonical = "https://formoria.com/categories/beauty";
    const result = buildCategoryItemListJsonLd("美妝", canonical, mockBrands);

    expect(result["@context"]).toBe("https://schema.org");
    expect(result["@type"]).toBe("ItemList");
    expect(result.url).toBe(canonical);
    expect(result.name).toContain("美妝");
    expect(result.numberOfItems).toBe(3);
  });

  it("generates ListItem entries with correct positions", () => {
    const result = buildCategoryItemListJsonLd(
      "美妝",
      "https://formoria.com/categories/beauty",
      mockBrands,
    );
    const items = result.itemListElement;

    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      "@type": "ListItem",
      position: 1,
      name: "茶籽堂",
    });
    expect(items[0].url).toContain("/cha-zi-tang");
    expect(items[2].position).toBe(3);
  });

  it("handles empty brands array", () => {
    const result = buildCategoryItemListJsonLd(
      "食品",
      "https://formoria.com/categories/food",
      [],
    );

    expect(result.numberOfItems).toBe(0);
    expect(result.itemListElement).toEqual([]);
  });

  it("uses /brands/:slug for brand item URLs", () => {
    const result = buildCategoryItemListJsonLd(
      "美妝",
      "https://formoria.com/categories/beauty",
      [{ name: "Test", slug: "test-brand" }],
    );
    expect(result.itemListElement[0].url).toContain("/brands/test-brand");
    expect(result.itemListElement[0].url).not.toMatch(
      /^https?:\/\/[^/]+\/test-brand$/,
    );
  });
});

describe("buildCategoryItemListJsonLd parentGroup", () => {
  it("adds an about Thing when a parent group is provided", () => {
    const result = buildCategoryItemListJsonLd(
      "服飾",
      "https://formoria.com/categories/fashion/tops-and-tshirts",
      [{ name: "oqLiq", slug: "oqliq" }],
      "zh-TW",
      "Taiwan clothing brands",
      "Fashion",
    );

    expect(result.about).toEqual({ "@type": "Thing", name: "Fashion" });
  });

  it("omits about when no parent group is provided", () => {
    const result = buildCategoryItemListJsonLd(
      "服飾",
      "https://formoria.com/categories/fashion/tops-and-tshirts",
      [{ name: "oqLiq", slug: "oqliq" }],
      "zh-TW",
      "Taiwan clothing brands",
      undefined,
    );

    expect("about" in result).toBe(false);
  });
});

describe("buildBreadcrumbJsonLd", () => {
  it("breadcrumb item URLs carry the locale prefix", () => {
    const jsonLd = buildBreadcrumbJsonLd(
      [{ label: "Brands", href: "/brands" }, { label: "Brand Name" }],
      "en",
    );

    expect(jsonLd.itemListElement[0].item).toBe(`${getSiteUrl()}/en/brands`);
  });

  it("builds BreadcrumbList with correct positions", () => {
    const items = [
      { label: "Brands", href: "/" },
      { label: "Food & Beverage", href: "/?category=Food+%26+Beverage" },
      { label: "茶籽堂 Chatzutang" },
    ];
    const jsonLd = buildBreadcrumbJsonLd(items);
    expect(jsonLd["@context"]).toBe("https://schema.org");
    expect(jsonLd["@type"]).toBe("BreadcrumbList");
    expect(jsonLd.itemListElement).toHaveLength(3);
    expect(jsonLd.itemListElement[0].position).toBe(1);
    expect(jsonLd.itemListElement[2].position).toBe(3);
  });

  it("omits item URL for the last breadcrumb (current page)", () => {
    const items = [{ label: "Brands", href: "/" }, { label: "Brand Name" }];
    const jsonLd = buildBreadcrumbJsonLd(items);
    expect(jsonLd.itemListElement[0].item).toBeDefined();
    expect(jsonLd.itemListElement[1].item).toBeUndefined();
  });
});

describe("buildBrandsItemListJsonLd", () => {
  it("returns valid ItemList schema with correct structure", () => {
    const brands = [
      { name: "Brand Alpha", slug: "brand-alpha" },
      { name: "Brand Beta", slug: "brand-beta" },
    ];
    const result = buildBrandsItemListJsonLd(brands);

    expect(result["@context"]).toBe("https://schema.org");
    expect(result["@type"]).toBe("ItemList");
    expect(result.itemListElement).toHaveLength(2);
    expect(result.numberOfItems).toBe(brands.length);
    expect(result.itemListElement[0]).toMatchObject({
      "@type": "ListItem",
      position: 1,
      name: "Brand Alpha",
    });
    expect(result.itemListElement[0].url).toContain("/brands/brand-alpha");
    expect(result.itemListElement[1].position).toBe(2);
  });

  it("returns empty itemListElement for empty brands array", () => {
    const result = buildBrandsItemListJsonLd([]);
    expect(result["@type"]).toBe("ItemList");
    expect(result.itemListElement).toHaveLength(0);
  });

  it("defaults to zh-TW locale", () => {
    const result = buildBrandsItemListJsonLd([{ name: "X", slug: "x" }]);
    expect(result.inLanguage).toBe("zh-TW");
  });

  it("respects explicit locale parameter", () => {
    const result = buildBrandsItemListJsonLd([{ name: "X", slug: "x" }], "en");
    expect(result.inLanguage).toBe("en");
  });

  it("generates correct URLs with locale prefix for en", () => {
    const result = buildBrandsItemListJsonLd([{ name: "X", slug: "x" }], "en");
    expect(result.itemListElement[0].url).toContain("/en/brands/x");
  });
});

describe("buildWebSiteJsonLd", () => {
  it("returns WebSite schema with correct structure", () => {
    const jsonLd = buildWebSiteJsonLd();
    expect(jsonLd["@context"]).toBe("https://schema.org");
    expect(jsonLd["@type"]).toBe("WebSite");
    expect(jsonLd.name).toBe("Formoria");
    expect(jsonLd.alternateName).toBe("Formoria 台灣好物選物平台");
    expect(jsonLd.url).toBeDefined();
    expect(jsonLd.url).toContain("localhost:3000");
    expect(jsonLd.url).not.toContain("mitmap");
  });

  it("includes SearchAction with search URL template", () => {
    const jsonLd = buildWebSiteJsonLd();
    expect(jsonLd.potentialAction["@type"]).toBe("SearchAction");
    expect(jsonLd.potentialAction.target.urlTemplate).toContain("/discover?q=");
    expect(jsonLd.potentialAction["query-input"]).toContain(
      "search_term_string",
    );
  });

  it("links WebSite to the Organization node by @id", () => {
    const jsonLd = buildWebSiteJsonLd();
    const organization = buildOrganizationJsonLd() as JsonLdObject;
    expect(jsonLd["@id"]).toMatch(/#website$/);
    expect(jsonLd.publisher["@id"]).toBe(organization["@id"]);
  });

  it("SearchAction targets product discovery", () => {
    const jsonLd = buildWebSiteJsonLd();
    const urlTemplate = jsonLd.potentialAction.target.urlTemplate;
    expect(urlTemplate).toContain("/discover?q={search_term_string}");
    expect(urlTemplate).not.toContain("/?search=");
  });
});

describe("buildOrganizationJsonLd", () => {
  it("describes the mission and commerce boundary in both public languages", () => {
    const zh = buildOrganizationJsonLd("zh-TW") as JsonLdObject;
    const en = buildOrganizationJsonLd("en") as JsonLdObject;

    expect(zh["@type"]).toBe("Organization");
    expect(zh.name).toBe("Formoria");
    expect(zh.url).toMatch(/^https?:\/\//);
    // The description opens with the homepage meta description, verbatim,
    // before the commerce boundary.
    expect(String(zh.description)).toMatch(
      new RegExp(`^${escapeRegExp(zhMessages.landing.metadata.description)}`),
    );
    expect(String(en.description)).toMatch(
      new RegExp(`^${escapeRegExp(enMessages.landing.metadata.description)}`),
    );
    expect(zh.description).toContain("Formoria 把相遇之後的路接起來");
    expect(zh.description).toContain("品牌或零售通路負責價格");
    expect(en.description).toContain(
      "Formoria reconnects the path after that moment",
    );
    expect(en.description).toContain("Brands or retailers remain responsible");
  });

  it("omits sameAs when no socials are configured", () => {
    const ld = buildOrganizationJsonLd("en") as JsonLdObject;
    expect("sameAs" in ld).toBe(false);
  });
});

describe("buildArticleJsonLd", () => {
  it("emits an Article with headline and publisher Organization", () => {
    const ld = buildArticleJsonLd({
      title: "A Test Story",
      description: "desc",
      path: "/stories/a-test-story",
      locale: "zh-TW",
    }) as JsonLdObject;
    expect(ld["@type"]).toBe("Article");
    expect(ld.headline).toBe("A Test Story");
    expect(ld.publisher["@type"]).toBe("Organization");
  });

  it("absolutises a repo-relative image against the site URL", () => {
    // Article `image` is what Google reads for the rich result. A leading-slash
    // repo path is valid on the page and meaningless in structured data, so it
    // is resolved here rather than at each caller.
    const ld = buildArticleJsonLd({
      title: "Story",
      description: "desc",
      path: "/stories/a-story",
      locale: "zh-TW",
      image: "/images/stories/hero.webp",
    }) as JsonLdObject;

    expect(ld.image).toMatch(/^https?:\/\//);
    expect(ld.image).toMatch(/\/images\/stories\/hero\.webp$/);
    expect(ld.image).not.toContain("//images/");
  });

  it("passes an absolute image URL through untouched", () => {
    const image = "https://cdn.example.com/t/a.jpg";
    const ld = buildArticleJsonLd({
      title: "Story",
      description: "desc",
      path: "/stories/a-story",
      image,
    }) as JsonLdObject;

    expect(ld.image).toBe(image);
  });

  it("omits image entirely when the entry declares none", () => {
    // Omitted rather than stubbed: an empty
    // string is reported by Google as an invalid value, which is worse than
    // no key at all.
    const ld = buildArticleJsonLd({
      title: "Story",
      description: "desc",
      path: "/stories/a-story",
      image: null,
    }) as JsonLdObject;

    expect("image" in ld).toBe(false);
  });
});

describe("image IRIs in structured data", () => {
  // Brand logos and story images use relative `/i/<key>` proxy paths since
  // DEV-1551, and `metadataBase` only absolutises openGraph/twitter metadata —
  // never the raw JSON inside the ld+json script tag. A relative IRI makes
  // Google drop the structured image reference.
  const SITE = "https://formoria.test";

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function stubSite(): void {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
  }

  it("absolutises a brand logo served through the /i/ proxy", () => {
    stubSite();
    const ld = buildBrandJsonLd(
      makeBrand({ heroImageUrl: "/i/brands/brand-1/hero.webp" }),
    );

    expect(ld.logo).toBe(`${SITE}/i/brands/brand-1/hero.webp`);
    expect(String(ld.logo).startsWith("https://")).toBe(true);
  });

  it("absolutises a story image served through the /i/ proxy", () => {
    stubSite();
    const ld = buildArticleJsonLd({
      title: "Story",
      description: "desc",
      path: "/stories/a-story",
      image: "/i/brands/brand-1/story.webp",
    });

    expect(ld.image).toBe(`${SITE}/i/brands/brand-1/story.webp`);
    expect(String(ld.image).startsWith("https://")).toBe(true);
  });

  it("leaves a legacy absolute image URL untouched, so the helper is idempotent", () => {
    stubSite();
    const legacy = "https://cdn.example.com/legacy/hero.jpg";

    expect(buildBrandJsonLd(makeBrand({ heroImageUrl: legacy })).logo).toBe(
      legacy,
    );
    expect(
      buildArticleJsonLd({
        title: "Story",
        description: "desc",
        path: "/stories/a-story",
        image: legacy,
      }).image,
    ).toBe(legacy);
  });
});

describe("safeJsonLdStringify", () => {
  it("produces valid JSON", () => {
    const data = { name: "Test Brand", description: "A brand" };
    const result = safeJsonLdStringify(data);
    expect(JSON.parse(result)).toEqual(data);
  });

  it("escapes script-closing sequences", () => {
    const data = { name: "</script><script>alert(1)</script>" };
    const result = safeJsonLdStringify(data);
    expect(result).not.toContain("</script>");
    expect(result).toContain("\\u003c");
    expect(JSON.parse(result)).toEqual(data);
  });

  it("preserves CJK characters and emoji", () => {
    const data = { name: "茶籽堂 🌿" };
    const result = safeJsonLdStringify(data);
    expect(JSON.parse(result)).toEqual(data);
  });
});
