// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import zh from "../../../../messages/zh-TW.json";
import type { PublicBrandDetail } from "@/lib/brands/contracts";

// The stockist dialog's server action and the correction dialog's body action
// are the network edge; the viewer context is the auth edge.
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
  usePathname: () => "/brands/test-brand",
}));

vi.mock("@/lib/analytics", () => ({
  trackExternalLinkClicked: vi.fn(),
}));

import {
  BrandChannelCorrections,
  BrandOtherLinks,
  BrandPurchaseLinks,
  BrandSocialLinks,
} from "../brand-links";
import { BrandSection } from "../brand-section";
import { trackExternalLinkClicked } from "@/lib/analytics";
import { buildBrandChannelSlots } from "@/lib/services/brand-detail-view";

const LINKS = zh.brandDetail.links;

function buildBrand(
  overrides: Partial<PublicBrandDetail> = {},
): PublicBrandDetail {
  return {
    id: "0f2a2f6c-7a9e-4a7f-9d64-9f2b1c5f0a11",
    name: "Harbor Form",
    slug: "harbor-form",
    description: null,
    descriptionEn: null,
    blurb: null,
    blurbEn: null,
    heroImageUrl: null,
    status: "approved",
    categoryLabel: null,
    subcategories: [],
    subcategoriesEn: [],
    foundingYear: null,
    city: null,
    productPhotos: [],
    imageAlts: [],
    heroImageMetadata: null,
    purchaseWebsite: null,
    purchasePinkoi: null,
    purchaseShopee: null,
    purchaseMyship: null,
    socialInstagram: null,
    socialThreads: null,
    socialFacebook: null,
    otherUrls: [],
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

const TRACKED = {
  id: "0f2a2f6c-7a9e-4a7f-9d64-9f2b1c5f0a11",
  slug: "harbor-form",
};

/** The page's props for a brand: the same slots the view model builds. */
function purchaseProps(overrides: Partial<PublicBrandDetail> = {}) {
  return {
    brand: TRACKED,
    slots: buildBrandChannelSlots(buildBrand(overrides)).purchase,
  };
}

function socialProps(overrides: Partial<PublicBrandDetail> = {}) {
  return {
    brand: TRACKED,
    slots: buildBrandChannelSlots(buildBrand(overrides)).social,
  };
}

const EVERY_STORE = {
  purchaseWebsite: "https://harbor.example",
  purchasePinkoi: "https://www.pinkoi.com/store/harbor",
  purchaseShopee: "https://shopee.tw/harbor",
  purchaseMyship: "https://myship.7-11.com.tw/general/detail/GM1",
};

describe("BrandPurchaseLinks", () => {
  it("renders only known destinations, with no inert chips", () => {
    const { container } = renderZh(
      <BrandPurchaseLinks
        {...purchaseProps({ purchaseWebsite: "https://harbor.example" })}
      />,
    );

    expect(screen.getByRole("link", { name: /品牌官網/ })).toHaveAttribute(
      "href",
      "https://harbor.example",
    );
    for (const label of [LINKS.pinkoi, LINKS.shopee, LINKS.myship]) {
      expect(
        screen.queryByRole("link", { name: new RegExp(label) }),
      ).toBeNull();
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("[aria-disabled]")).toBeNull();
  });

  // BD-01 step 3: rows, not pills — name, host, out arrow, 44px tall.
  it("sets each store as a row with its host, in registry order", () => {
    renderZh(<BrandPurchaseLinks {...purchaseProps(EVERY_STORE)} />);

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      `${LINKS.website}harbor.example`,
      `${LINKS.pinkoi}pinkoi.com`,
      `${LINKS.shopee}shopee.tw`,
      `${LINKS.myship}myship.7-11.com.tw`,
    ]);
    for (const link of links) {
      expect(link).toHaveClass("min-h-11");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
    expect(screen.getByText("pinkoi.com")).toHaveClass("type-metadata");
    expect(links[0]!.closest("ul")).toHaveClass("divide-y", "divide-rule");
  });

  it("tracks a row click as the channel it goes to", () => {
    renderZh(
      <BrandPurchaseLinks
        {...purchaseProps({ purchaseWebsite: "https://shopee.tw/harbor" })}
      />,
    );

    fireEvent.click(screen.getByRole("link"));

    expect(trackExternalLinkClicked).toHaveBeenCalledWith(
      "harbor-form",
      "shopee",
      expect.any(String),
      "detail_page",
      TRACKED.id,
    );
  });

  it("is a sub-heading of the where-to-buy section", () => {
    const { container } = renderZh(<BrandPurchaseLinks {...purchaseProps()} />);

    expect(
      screen.getByRole("heading", { level: 3, name: LINKS.onlineStores }),
    ).toBeInTheDocument();
    // A block inside where-to-buy, never a nested section.
    expect(container.querySelector("section")).toBeNull();
  });

  // BD-COPY-03: a missing store is left out without an apology line.
  it("prints no muted line when some store is live", () => {
    const { container } = renderZh(
      <BrandPurchaseLinks
        {...purchaseProps({ purchaseWebsite: "https://harbor.example" })}
      />,
    );

    expect(screen.queryByText(LINKS.noChannels)).toBeNull();
    expect(container.querySelector("p")).toBeNull();
  });

  it("says no store is known when none is live", () => {
    renderZh(<BrandPurchaseLinks {...purchaseProps()} />);

    expect(screen.getByText(LINKS.noChannels)).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("link icons", () => {
  // DESIGN.md §2: the palette has no exceptions, brand marks included.
  it("carry no raw hex colour", () => {
    const { container } = renderZh(
      <>
        <BrandPurchaseLinks {...purchaseProps(EVERY_STORE)} />
        <BrandSocialLinks
          {...socialProps({
            socialInstagram: "https://www.instagram.com/harbor",
            socialThreads: "https://www.threads.net/@harbor",
            socialFacebook: "https://www.facebook.com/harbor",
          })}
        />
      </>,
    );

    expect(container.querySelector('[class*="text-[#"]')).toBeNull();
    expect(container.querySelector(".text-accent")).toBeNull();
  });
});

describe("BrandSocialLinks", () => {
  // The section nav always lists #social, so the section keeps rendering.
  // The page owns the shell (BrandSection); the body still renders its line.
  it("keeps its heading and a muted line when no social link is known", () => {
    const { container } = renderZh(
      <BrandSection
        id="social"
        rhythm="utility"
        heading={LINKS.socialPlatforms}
      >
        <BrandSocialLinks {...socialProps()} />
      </BrandSection>,
    );

    expect(container.querySelector("#social")).not.toBeNull();
    expect(
      screen.getByRole("heading", { level: 2, name: LINKS.socialPlatforms }),
    ).toBeInTheDocument();
    expect(container.querySelector("#social")).toHaveAttribute(
      "aria-labelledby",
      "social-heading",
    );
    expect(screen.getByText(LINKS.noSocialLinks)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("[aria-disabled]")).toBeNull();
  });

  it("keeps the pill links in the social section", () => {
    renderZh(
      <BrandSocialLinks {...socialProps({ socialInstagram: "@harbor" })} />,
    );

    expect(screen.getByRole("link", { name: LINKS.instagram })).toHaveAttribute(
      "href",
      "https://instagram.com/harbor",
    );
  });
});

describe("BrandOtherLinks", () => {
  it("renders nothing without links", () => {
    const { container } = renderZh(
      <BrandOtherLinks brand={buildBrand()} links={[]} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders each prepared link as a tracked external link", () => {
    renderZh(
      <BrandOtherLinks
        brand={buildBrand()}
        links={[{ label: "Studio blog", url: "https://blog.harbor.example" }]}
      />,
    );

    expect(screen.getByRole("link", { name: "Studio blog" })).toHaveAttribute(
      "href",
      "https://blog.harbor.example",
    );
  });
});

describe("BrandChannelCorrections", () => {
  it("is one muted line with a single menu trigger", () => {
    renderZh(<BrandChannelCorrections brand={buildBrand()} />);

    const prompt = screen.getByText(LINKS.correctionPrompt);
    expect(prompt.closest(".type-metadata")).not.toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: LINKS.correctionAction }),
    ).toBeInTheDocument();
    // The three old accent triggers are gone; their dialogs stay closed.
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
