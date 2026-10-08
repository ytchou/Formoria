// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CuratedProduct } from "@/lib/services/curated-products";
import type { TrailEntry } from "@/lib/services/trails";
import { HubTagChipRow } from "@/components/trails/hub-tag-chip-row";
import { HubTrailGrid } from "@/components/trails/hub-trail-grid";
import {
  filterTrailsByTag,
  hubTagChips,
  readHubPeeks,
  selectHubView,
  shouldIndexTrailHub,
} from "../page";

vi.mock("next/image", () => ({
  default: ({
    fill: _fill,
    priority: _priority,
    ...props
    // eslint-disable-next-line @next/next/no-img-element -- this is the next/image boundary
  }: Record<string, unknown>) => <img alt="" {...props} />,
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    prefetch: _prefetch,
    children,
    ...rest
  }: {
    href: string;
    prefetch?: boolean;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/analytics", () => ({
  trackTrailCardClicked: vi.fn(),
}));

// TrailTile reads the page locale to mark zh content on /en; these renders
// have no NextIntlClientProvider.
vi.mock("next-intl", () => ({ useLocale: () => "zh-TW" }));

const trail = (slug: string, tags: string[]): TrailEntry => ({
  slug,
  frontmatter: {
    title: slug,
    description: "A trail",
    slug,
    tags,
    locale: "zh-TW",
    publishedAt: "2026-08-15T00:00:00.000Z",
    draft: false,
    sources: [],
    faq: [],
    sections: [],
    relatedCategories: [],
    relatedStories: [],
    relatedTrails: [],
  },
});

const labels = { eyebrow: "風格", cta: "探索這個風格 →" };

function peekProduct(trailSlug: string, index: number): CuratedProduct {
  return {
    id: `${trailSlug}-${index}`,
    brandId: `brand-${index}`,
    key: `product-${index}`,
    nameZh: `商品 ${index}`,
    nameEn: null,
    category: "home",
    subcategory: null,
    officialUrl: "https://example.com/product",
    imageUrl: `/i/curated-products/p/${index}.jpg`,
    imageSourceUrl: null,
    visible: true,
    linkState: "ok",
    linkCheckedAt: null,
    sourceCheckedAt: null,
    reviewDueAt: null,
    productDescriptionZh: "描述",
    productDescriptionEn: null,
    productPosition: null,
    createdAt: "2026-01-01T00:00:00Z",
    trailSlug,
    sectionKey: null,
    position: index,
    mitQualified: false,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("style trail hub", () => {
  it("filters by a known tag and ignores an unknown tag", () => {
    const trails = [trail("home-trail", ["home"]), trail("craft-trail", ["crafts"])];

    expect(filterTrailsByTag(trails, "home").map((item) => item.slug)).toEqual([
      "home-trail",
    ]);
    expect(filterTrailsByTag(trails, "not-a-category")).toEqual(trails);
  });

  it("keeps the hub noindex only when no trail is published", () => {
    expect(shouldIndexTrailHub([])).toBe(false);
    expect(shouldIndexTrailHub([trail("home-trail", ["home"])])).toBe(true);
  });

  it("lists every published trail", () => {
    const homeTrail = trail("home-trail", ["home"]);
    const craftTrail = trail("craft-trail", ["crafts"]);
    const trails = [homeTrail, craftTrail];

    // No supply filtering: publication is the only gate the hub applies.
    expect(
      selectHubView({ result: { ok: true, trails }, activeTag: null }),
    ).toEqual({ kind: "list", trails });

    // The tag filter is the only thing left that can narrow the list.
    expect(
      selectHubView({ result: { ok: true, trails }, activeTag: "home" }),
    ).toEqual({ kind: "list", trails: [homeTrail] });

    expect(
      selectHubView({ result: { ok: true, trails: [] }, activeTag: null }),
    ).toEqual({ kind: "comingSoon" });

    // One card link per trail, each named by its level-2 title.
    render(
      <HubTrailGrid
        trails={trails}
        peeks={{ "home-trail": [peekProduct("home-trail", 1)] }}
        labels={labels}
      />,
    );

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    for (const item of trails) {
      const heading = screen.getByRole("heading", {
        level: 2,
        name: item.frontmatter.title,
      });
      const link = screen.getByRole("link", { name: item.frontmatter.title });
      expect(link).toContainElement(heading);
      expect(link).toHaveAttribute("href", `/style/${item.slug}`);
    }
  });

  it("renders a tag chip row linking to ?tag=<l1> for each tag in use, plus 全部, with the active chip marked aria-current", () => {
    const trails = [
      trail("stationery-trail", ["stationery"]),
      trail("home-trail", ["home", "not-a-category"]),
      trail("second-home-trail", ["home"]),
    ];
    const chips = hubTagChips(trails, "zh-TW", null);

    // Ontology order, one chip per tag in use, unknown tags dropped.
    expect(chips).toEqual([
      { slug: "home", label: "居家生活" },
      { slug: "stationery", label: "文具設計" },
    ]);

    const { unmount } = render(
      <HubTagChipRow chips={chips} activeTag="home" allLabel="全部" />,
    );

    const row = screen.getByRole("list");
    const links = within(row).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "全部",
      "居家生活",
      "文具設計",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/style",
      "/style?tag=home",
      "/style?tag=stationery",
    ]);
    expect(screen.getByRole("link", { name: "居家生活" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "全部" })).not.toHaveAttribute(
      "aria-current",
    );
    unmount();

    // No tag, or an unknown one, leaves 全部 current — matching the filter,
    // which ignores an unknown tag.
    for (const activeTag of [null, "not-a-category"]) {
      const view = render(
        <HubTagChipRow chips={chips} activeTag={activeTag} allLabel="全部" />,
      );
      expect(screen.getByRole("link", { name: "全部" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      expect(
        screen.getByRole("link", { name: "居家生活" }),
      ).not.toHaveAttribute("aria-current");
      view.unmount();
    }
  });

  it("keeps the active chip visible for a valid tag no published trail carries", () => {
    const trails = [trail("home-trail", ["home"])];

    // A valid visible L1 with no trail still gets its chip; an unknown or a
    // deferred tag does not.
    expect(hubTagChips(trails, "zh-TW", "jewelry")).toEqual([
      { slug: "jewelry", label: "飾品珠寶" },
      { slug: "home", label: "居家生活" },
    ]);
    expect(hubTagChips(trails, "zh-TW", "not-a-category")).toEqual([
      { slug: "home", label: "居家生活" },
    ]);
    expect(hubTagChips(trails, "zh-TW", "tech")).toEqual([
      { slug: "home", label: "居家生活" },
    ]);

    render(
      <HubTagChipRow
        chips={hubTagChips(trails, "zh-TW", "jewelry")}
        activeTag="jewelry"
        allLabel="全部"
      />,
    );

    expect(screen.getByRole("link", { name: "飾品珠寶" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "全部" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("renders cards without peeks when the peek read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const trails = [trail("home-trail", ["home"]), trail("craft-trail", ["crafts"])];

    const peeks = await readHubPeeks(
      trails,
      async () => {
        throw new Error("peek read failed");
      },
    );
    expect(peeks).toEqual({});

    const { container } = render(
      <HubTrailGrid trails={trails} peeks={peeks} labels={labels} />,
    );

    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(container.querySelector('ul[aria-hidden="true"]')).toBeNull();
  });

  it("surfaces a load error when the trail list read failed", () => {
    // The trail list is MDX on disk. It failing is a real outage, and the hub
    // says so rather than claiming there is nothing to read.
    expect(
      selectHubView({
        result: { ok: false, error: new Error("read failed") },
        activeTag: null,
      }),
    ).toEqual({ kind: "loadError" });
  });
});
