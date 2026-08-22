import { afterEach, describe, it, expect, vi } from "vitest";
import {
  buildArticleJsonLd,
  buildBrandJsonLd,
  buildBreadcrumbJsonLd,
  buildCategoryItemListJsonLd,
  buildBrandsItemListJsonLd,
  buildEventJsonLd,
  buildStockistItemListJsonLd,
  buildFaqPageJsonLd,
  buildOrganizationJsonLd,
  buildWebSiteJsonLd,
  safeJsonLdStringify,
  type EventJsonLdInput,
  type JsonLdObject,
} from "@/lib/json-ld";
import type { Brand } from "@/lib/types";
import { getSiteUrl } from "@/lib/site-url";
import { faqItemsToQuestions, getBrandFaq } from "@/lib/services/brand-faq";
import type { FaqSupabase } from "@/lib/services/brand-faq";
import type { Stockist } from "@/lib/types/stockist";

function makeBrand(overrides: Partial<Brand> = {}): Brand {
  return {
    id: "123",
    name: "茶籽堂 Chatzutang",
    slug: "chatzutang",
    description: "Natural body care with camellia seed oil",
    heroImageUrl: "https://example.com/hero.jpg",
    status: "approved",
    isVerified: false,
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
    priceRange: null,
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
    expect(jsonLd.alternateName).toBe("Formoria 台灣品牌探索與選物平台");
    expect(jsonLd.url).toBeDefined();
    expect(jsonLd.url).toContain("localhost:3000");
    expect(jsonLd.url).not.toContain("mitmap");
  });

  it("includes SearchAction with search URL template", () => {
    const jsonLd = buildWebSiteJsonLd();
    expect(jsonLd.potentialAction["@type"]).toBe("SearchAction");
    expect(jsonLd.potentialAction.target.urlTemplate).toContain("search=");
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

  it("SearchAction targets /brands?search= not /?search=", () => {
    const jsonLd = buildWebSiteJsonLd();
    const urlTemplate = jsonLd.potentialAction.target.urlTemplate;
    expect(urlTemplate).toContain("/brands?search=");
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
    expect(zh.description).toContain(
      "Formoria 把相遇之後的路接起來",
    );
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
      title: "About",
      description: "desc",
      path: "/about",
      locale: "zh-TW",
    }) as JsonLdObject;
    expect(ld["@type"]).toBe("Article");
    expect(ld.headline).toBe("About");
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
    // Omitted rather than stubbed, exactly like `buildEventJsonLd`: an empty
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
  // `heroImageUrl` and the event hero are relative `/i/<key>` proxy paths since
  // DEV-1551, and `metadataBase` only absolutises openGraph/twitter metadata —
  // never the raw JSON inside the ld+json script tag. A relative IRI makes
  // Google drop `Organization.logo` and `Event.image`.
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

  it("absolutises an event image served through the /i/ proxy", () => {
    stubSite();
    const ld = buildEventJsonLd({
      name: "台灣文博會 2026",
      path: "/events/creative-expo-2026",
      startDate: "2026-08-06",
      imageUrl: "/i/event-exhibitors/expo/hero.webp",
    });

    expect(ld.image).toBe(`${SITE}/i/event-exhibitors/expo/hero.webp`);
    expect(String(ld.image).startsWith("https://")).toBe(true);
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
      buildEventJsonLd({
        name: "Expo",
        path: "/events/expo",
        startDate: "2026-08-06",
        imageUrl: legacy,
      }).image,
    ).toBe(legacy);
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

describe("buildEventJsonLd", () => {
  function makeEventInput(
    overrides: Partial<EventJsonLdInput> = {},
  ): EventJsonLdInput {
    return {
      name: "台灣文博會 2026",
      description: "為期五天的台灣設計與品牌展會。",
      path: "/events/creative-expo-2026",
      locale: "zh-TW",
      startDate: "2026-08-06",
      endDate: "2026-08-10",
      venueName: "松山文創園區",
      venueAddress: "光復南路 133 號",
      city: "台北市",
      organizerName: "文化內容策進院",
      imageUrl: "https://example.com/expo.jpg",
      isFree: null,
      ticketUrl: null,
      ...overrides,
    };
  }

  it("emits an Event with the shared schema.org envelope", () => {
    const ld = buildEventJsonLd(makeEventInput());
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("Event");
    expect(ld.name).toBe("台灣文博會 2026");
    expect(ld.inLanguage).toBe("zh-TW");
    expect(ld.url).toContain("/events/creative-expo-2026");
    expect(ld.eventAttendanceMode).toBe(
      "https://schema.org/OfflineEventAttendanceMode",
    );
  });

  it("keeps eventStatus scheduled even for a finished event", () => {
    const ld = buildEventJsonLd(
      makeEventInput({ startDate: "2020-01-01", endDate: "2020-01-03" }),
    );
    expect(ld.eventStatus).toBe("https://schema.org/EventScheduled");
  });

  it("emits calendar dates verbatim, with no time or zone appended", () => {
    const ld = buildEventJsonLd(
      makeEventInput({ startDate: "2026-08-06", endDate: "2026-08-10" }),
    );

    expect(ld.startDate).toBe("2026-08-06");
    expect(ld.endDate).toBe("2026-08-10");
    for (const value of [ld.startDate, ld.endDate]) {
      expect(value).not.toContain("T");
      expect(value).not.toContain("Z");
      expect(value).not.toMatch(/[+-]\d{2}:\d{2}$/);
    }
  });

  it("omits endDate for a single-day event", () => {
    const ld = buildEventJsonLd(makeEventInput({ endDate: null }));
    expect(ld.startDate).toBe("2026-08-06");
    expect("endDate" in ld).toBe(false);
  });

  // `venue_name`, `venue_address` and `city` are independently nullable, and
  // `location` is a required property of Google's Event rich result while
  // schema.org does NOT require `Place.name`. Every combination therefore has
  // its own answer: a curator who filled only the address must still get a
  // Place, and a name with nothing to address must not get an address stub
  // carrying only `addressCountry`.
  it.each([
    [
      "no venue at all",
      { venueName: null, venueAddress: null, city: null },
      undefined,
    ],
    [
      "venue name, address and city",
      {},
      {
        "@type": "Place",
        name: "松山文創園區",
        address: {
          "@type": "PostalAddress",
          streetAddress: "光復南路 133 號",
          addressLocality: "台北市",
          addressCountry: "TW",
        },
      },
    ],
    [
      "an address and city but no venue name",
      { venueName: null },
      {
        "@type": "Place",
        address: {
          "@type": "PostalAddress",
          streetAddress: "光復南路 133 號",
          addressLocality: "台北市",
          addressCountry: "TW",
        },
      },
    ],
    [
      "a city alone",
      { venueName: null, venueAddress: null },
      {
        "@type": "Place",
        address: {
          "@type": "PostalAddress",
          addressLocality: "台北市",
          addressCountry: "TW",
        },
      },
    ],
    [
      "a venue name alone",
      { venueAddress: null, city: null },
      { "@type": "Place", name: "松山文創園區" },
    ],
  ] as const)("builds the location from %s", (_label, overrides, expected) => {
    const ld = buildEventJsonLd(makeEventInput(overrides));
    if (expected === undefined) {
      expect("location" in ld).toBe(false);
    } else {
      expect(ld.location).toEqual(expected);
    }
  });

  it("omits organizer and image entirely when null", () => {
    const ld = buildEventJsonLd(
      makeEventInput({ organizerName: null, imageUrl: null }),
    );
    expect("organizer" in ld).toBe(false);
    expect("image" in ld).toBe(false);
  });

  // `isFree: null` means "ticketing unknown", which is not the same as free and
  // must not be published as a price of any kind.
  it.each([
    ["ticketing is unknown", { isFree: null, ticketUrl: null }, undefined],
    [
      "the event is free",
      { isFree: true, ticketUrl: null },
      { "@type": "Offer", price: "0", priceCurrency: "TWD" },
    ],
    [
      // Formoria never stores a price, so a ticketed event links out instead.
      "the event is ticketed and links out",
      { isFree: false, ticketUrl: "https://tickets.example.com/expo" },
      { "@type": "Offer", url: "https://tickets.example.com/expo" },
    ],
    ["the event is ticketed with no ticket URL", { isFree: false, ticketUrl: null }, undefined],
  ] as const)("emits the right offers when %s", (_label, overrides, expected) => {
    const ld = buildEventJsonLd(makeEventInput(overrides));
    if (expected === undefined) {
      expect("offers" in ld).toBe(false);
    } else {
      expect(ld.offers).toEqual(expected);
    }
  });
});

describe("buildFaqPageJsonLd", () => {
  const storyFaq = [
    {
      q: "如何確認品牌真的是台灣製造？",
      a: "Formoria 的三階段驗證會比對品牌自述、公開資料與製造夥伴的回覆。",
    },
    {
      q: "Where can I buy from these brands directly?",
      a: "Each brand page lists the official website plus Pinkoi and Shopee storefronts when the brand has them.",
    },
  ];

  it("buildFaqPageJsonLd emits a FAQPage with one Question per entry", () => {
    const ld = buildFaqPageJsonLd(storyFaq, "zh-TW") as JsonLdObject;
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("FAQPage");
    expect(ld.inLanguage).toBe("zh-TW");
    expect(ld.mainEntity).toHaveLength(storyFaq.length);
    expect(ld.mainEntity.map((entry: JsonLdObject) => entry["@type"])).toEqual([
      "Question",
      "Question",
    ]);
    expect(ld.mainEntity[0].name).toBe(storyFaq[0].q);
    expect(ld.mainEntity[1].name).toBe(storyFaq[1].q);
  });

  it("each Question carries an acceptedAnswer of type Answer", () => {
    const ld = buildFaqPageJsonLd(storyFaq, "en") as JsonLdObject;
    for (const [index, question] of ld.mainEntity.entries()) {
      expect(question.acceptedAnswer).toEqual({
        "@type": "Answer",
        text: storyFaq[index].a,
      });
    }
  });

  it("buildFaqPageJsonLd returns null for an empty question list", () => {
    expect(buildFaqPageJsonLd([], "zh-TW")).toBeNull();
    expect(buildFaqPageJsonLd(null)).toBeNull();
    expect(buildFaqPageJsonLd(undefined)).toBeNull();
  });

  it("scopes @id and mainEntityOfPage to the supplied canonical", () => {
    const canonical = `${getSiteUrl()}/en/brands/chatzutang`;
    const ld = buildFaqPageJsonLd(storyFaq, "en", canonical) as JsonLdObject;

    expect(ld["@id"]).toBe(`${canonical}#faq`);
    expect(ld.mainEntityOfPage).toBe(canonical);
  });

  it("stays unidentified when callers omit the canonical", () => {
    const ld = buildFaqPageJsonLd(storyFaq, "en") as JsonLdObject;

    expect(ld["@id"]).toBeUndefined();
    expect(ld.mainEntityOfPage).toBeUndefined();
  });

  it("escapes values safely via safeJsonLdStringify", () => {
    const ld = buildFaqPageJsonLd(
      [
        {
          q: "Does </script><script>alert(1)</script> break the page?",
          a: "No — the payload is escaped before it reaches the document.",
        },
      ],
      "en",
    ) as JsonLdObject;

    const serialized = safeJsonLdStringify(ld);
    expect(serialized).not.toContain("</script>");
    expect(serialized).toContain("\\u003c");
    expect(JSON.parse(serialized)).toEqual(ld);
  });

  it("emits FAQPage JSON-LD matching the rendered items", async () => {
    const client = {
      from(table: string) {
        if (table !== "brand_faq_entries")
          throw new Error(`unexpected table: ${table}`);
        const builder = {
          select: () => builder,
          eq: () => builder,
          then: (
            resolve: (result: { data: never[]; error: null }) => unknown,
          ) => Promise.resolve({ data: [], error: null }).then(resolve),
        };
        return builder;
      },
    };
    const translate = (key: string, params?: Record<string, unknown>) =>
      `${key}|${JSON.stringify(params ?? {})}`;
    const items = await getBrandFaq(
      "123",
      makeBrand({ subcategories: ["陶瓷"] }),
      translate,
      "zh-TW",
      null,
      client as unknown as FaqSupabase,
    );
    const ld = buildFaqPageJsonLd(
      faqItemsToQuestions(items),
      "zh-TW",
    ) as JsonLdObject;

    expect(ld.mainEntity.map((entry: JsonLdObject) => entry.name)).toEqual(
      items.map((item) => item.question),
    );
    expect(
      ld.mainEntity.map((entry: JsonLdObject) => entry.acceptedAnswer.text),
    ).toEqual(items.map((item) => item.answer));
  });
});

describe("buildStockistItemListJsonLd", () => {
  const location = (address: string | null) => ({
    id: "8a8b35c9-6168-4899-87b4-24a48d647d1c",
    name: "María García & Sons <Flagship>",
    address,
    url: null,
    country: "TW",
    city: "taipei" as const,
    district: "中山區",
    brandSlug: "maria-garcia-ceramics",
    brandName: "María García Ceramics",
    categorySlug: "home",
    subcategories: [],
  });

  it("builds a Place with a PostalAddress for a location with an address", () => {
    const result = buildStockistItemListJsonLd({
      locations: [location("臺北市中山區樂群二路199號")],
      cityName: "臺北市",
      canonicalUrl: "https://formoria.com/where-to-buy/taipei",
    });

    expect(result.itemListElement[0].item).toMatchObject({
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        streetAddress: "臺北市中山區樂群二路199號",
        addressLocality: "臺北市",
        addressCountry: "TW",
      },
    });
  });

  it("omits the Place entirely when the location has no address", () => {
    const result = buildStockistItemListJsonLd({
      locations: [location(null)],
      cityName: "臺北市",
      canonicalUrl: "https://formoria.com/where-to-buy/taipei",
    });
    expect(result.itemListElement).toEqual([]);
  });

  it("builds an ItemList of the city's locations in order", () => {
    const result = buildStockistItemListJsonLd({
      locations: [location("第一個地址"), { ...location("第二個地址"), id: "second" }],
      cityName: "臺北市",
      canonicalUrl: "https://formoria.com/where-to-buy/taipei",
    });
    expect(result.numberOfItems).toBe(2);
    expect(result.itemListElement.map((item: { position: number }) => item.position)).toEqual([1, 2]);
  });

  it("escapes safely", () => {
    const result = buildStockistItemListJsonLd({
      locations: [location("臺北市</script><script>alert(1)</script>")],
      cityName: "臺北市",
      canonicalUrl: "https://formoria.com/where-to-buy/taipei",
    });
    expect(safeJsonLdStringify(result)).not.toContain("</script>");
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
