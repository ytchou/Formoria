// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "../../../../messages/en.json";
import zh from "../../../../messages/zh-TW.json";
import type { PublicBrandDetail } from "@/lib/brands/contracts";
import { buildBrandChannelSlots } from "@/lib/services/brand-detail-view";
import {
  BrandColophon,
  BrandHeader,
  BrandHeroFacts,
  hasBrandHeroFacts,
} from "../brand-header";

// The channel rows' dialogs and tracking pull in the network edges.
vi.mock("@/app/[locale]/(site)/brands/[slug]/actions", () => ({
  submitStockistInfoAction: vi.fn(),
}));
vi.mock("@/lib/actions/brand-corrections", () => ({
  submitCorrectionAction: vi.fn(),
}));
vi.mock("@/lib/auth/use-user", () => ({
  useUser: () => ({ user: null, loading: false }),
}));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/brands/harbor-form",
}));
vi.mock("@/lib/analytics", () => ({
  trackExternalLinkClicked: vi.fn(),
}));

const TRACKED = {
  id: "0f2a2f6c-7a9e-4a7f-9d64-9f2b1c5f0a11",
  slug: "harbor-form",
};

const T = zh.brandDetail;

function buildBrand(
  overrides: Partial<PublicBrandDetail> = {},
): PublicBrandDetail {
  return {
    id: "0f2a2f6c-7a9e-4a7f-9d64-9f2b1c5f0a11",
    name: "Harbor Form",
    slug: "harbor-form",
    categoryLabel: "生活用品",
    foundingYear: 2015,
    city: "taipei",
    ...overrides,
  } as unknown as PublicBrandDetail;
}

function renderZh(node: ReactNode) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zh}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe("BrandHeader", () => {
  it("puts city and founding year in the metadata line by default", () => {
    renderZh(<BrandHeader brand={buildBrand()} cityLabel="台北" />);

    expect(
      screen.getByText("生活用品 · 台北 · 2015 年創立"),
    ).toBeInTheDocument();
  });

  it("leaves city and year out of the metadata line when the colophon carries them", () => {
    renderZh(
      <BrandHeader brand={buildBrand()} cityLabel="台北" omitProvenance />,
    );

    expect(screen.getByText("生活用品")).toHaveClass("type-metadata");
    expect(screen.queryByText(/台北/)).toBeNull();
    expect(screen.queryByText(/2015/)).toBeNull();
  });

  it("names what the brand makes under the metadata line", () => {
    const { container } = renderZh(
      <BrandHeader
        brand={buildBrand()}
        makesLabels={["托特包", "後背包"]}
        omitProvenance
      />,
    );

    const makes = screen.getByText("托特包・後背包");
    expect(makes).toHaveClass("type-label", "text-ink-soft");
    // Same reveal step as the metadata line: no new animation.
    expect(makes.parentElement).toBe(
      screen.getByText("生活用品").parentElement,
    );
    expect(container.querySelectorAll(".animate-reveal-up")).toHaveLength(2);
  });

  it("joins the makes labels with a spaced dot in en", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <BrandHeader
          brand={buildBrand()}
          makesLabels={["Tote Bags", "Backpacks"]}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText("Tote Bags · Backpacks")).toBeInTheDocument();
  });

  it("omits the makes line when nothing is known", () => {
    const { container } = renderZh(<BrandHeader brand={buildBrand()} />);

    expect(container.querySelector("[data-brand-makes]")).toBeNull();
  });
});

describe("BrandColophon", () => {
  it("sets the founding city and year as one fact", () => {
    renderZh(<BrandColophon cityLabel="嘉義市" foundingYear={2018} />);

    expect(screen.getByText("2018 年創立於嘉義市")).toHaveClass(
      "type-card-title",
    );
  });

  it("renders only the facts that exist", () => {
    const { rerender } = renderZh(
      <BrandColophon cityLabel="嘉義市" foundingYear={null} />,
    );
    expect(screen.getByText("創立於嘉義市")).toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="zh-TW" messages={zh}>
        <BrandColophon cityLabel={null} foundingYear={1967} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("1967 年創立")).toBeInTheDocument();
  });

  it("renders nothing without a fact", () => {
    const { container } = renderZh(
      <BrandColophon cityLabel={null} foundingYear={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("reads as one fact in en", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <BrandColophon cityLabel="Chiayi City" foundingYear={2018} />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByText("Founded in Chiayi City in 2018"),
    ).toBeInTheDocument();
  });
});

describe("BrandHeroFacts", () => {
  it("links to the sections with counts, and only those", () => {
    renderZh(
      <BrandHeroFacts
        selectedCount={3}
        stockistCount={0}
      />,
    );

    const nav = screen.getByRole("navigation", { name: T.tabNav.overview });
    expect(nav).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "精選商品 · 3 件" }),
    ).toHaveAttribute("href", "#selected-products");
    expect(screen.queryByRole("link", { name: /實體通路/ })).toBeNull();
  });

  it("pluralizes the EN jump rows", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <BrandHeroFacts
          selectedCount={1}
          stockistCount={4}
        />
      </NextIntlClientProvider>,
    );

    expect(
      screen.getByRole("link", { name: "1 featured product" }),
    ).toHaveAttribute("href", "#selected-products");
    expect(screen.getByRole("link", { name: "4 stockists" })).toHaveAttribute(
      "href",
      "#where-to-buy",
    );
  });

  it("renders nothing, and reports nothing, when there are no facts", () => {
    const props = {
      selectedCount: 0,
      stockistCount: 0,
    };
    const { container } = renderZh(<BrandHeroFacts {...props} />);

    expect(container).toBeEmptyDOMElement();
    expect(hasBrandHeroFacts(props)).toBe(false);
    expect(hasBrandHeroFacts({ ...props, stockistCount: 1 })).toBe(true);
  });

  it("renders for a brand with only channels, md-only", () => {
    const channels = buildBrandChannelSlots({
      purchaseWebsite: "https://harbor.example",
      purchasePinkoi: null,
      purchaseShopee: null,
      purchaseMyship: null,
      socialInstagram: null,
      socialThreads: null,
      socialFacebook: null,
    }).purchase;
    const props = {
      selectedCount: 0,
      stockistCount: 0,
      channels,
    };
    const { container } = renderZh(
      <BrandHeroFacts {...props} trackedBrand={TRACKED} />,
    );

    expect(hasBrandHeroFacts(props)).toBe(true);
    expect(container.firstElementChild).toHaveClass("max-md:hidden");
  });
});

describe("BrandHeroFacts route rows", () => {
  const channels = (() => {
    const slots = buildBrandChannelSlots({
      purchaseWebsite: "https://www.harbor.example",
      purchasePinkoi: "https://www.pinkoi.com/store/harbor",
      purchaseShopee: null,
      purchaseMyship: null,
      socialInstagram: "@harbor",
      socialThreads: null,
      socialFacebook: null,
    });
    return [...slots.purchase, ...slots.social];
  })();

  it("lists every live channel with its host, purchase stores first", () => {
    renderZh(
      <BrandHeroFacts
        selectedCount={0}
        stockistCount={0}
        channels={channels}
        trackedBrand={TRACKED}
      />,
    );

    const list = screen.getByRole("list", { name: T.heroJump.channels });
    const links = Array.from(list.querySelectorAll("a"));
    expect(links.map((link) => link.textContent)).toEqual([
      `${T.links.website}harbor.example`,
      `${T.links.pinkoi}pinkoi.com`,
      `${T.links.instagram}instagram.com`,
    ]);
    expect(links[2]).toHaveAttribute("href", "https://instagram.com/harbor");
    expect(links[0]).toHaveAttribute("target", "_blank");
  });

  it("summarises stockists by city, with see-all only when cities leave some out", () => {
    renderZh(
      <BrandHeroFacts
        selectedCount={0}
        stockistCount={24}
        stockistCities={[
          { citySlug: "taichung", count: 5 },
          { citySlug: "taipei", count: 5 },
        ]}
      />,
    );

    expect(
      screen.getByRole("link", {
        name: "台中市 5 家・台北市 5 家・看全部 24 家",
      }),
    ).toHaveAttribute("href", "#where-to-buy");
  });

  it("drops see-all when the cities shown hold every stockist", () => {
    renderZh(
      <BrandHeroFacts
        selectedCount={0}
        stockistCount={3}
        stockistCities={[{ citySlug: "tainan", count: 3 }]}
      />,
    );

    expect(
      screen.getByRole("link", { name: "台南市 3 家" }),
    ).toBeInTheDocument();
  });

  it("pluralizes the EN see-all", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <BrandHeroFacts
          selectedCount={0}
          stockistCount={9}
          stockistCities={[
            { citySlug: "taichung", count: 5 },
            { citySlug: "taipei", count: 3 },
          ]}
        />
      </NextIntlClientProvider>,
    );

    expect(
      screen.getByRole("link", {
        name: `${en.cities.taichung} 5 · ${en.cities.taipei} 3 · See all 9 stockists`,
      }),
    ).toBeInTheDocument();
  });
});
