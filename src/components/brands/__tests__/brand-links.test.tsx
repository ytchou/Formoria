// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
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

describe("BrandPurchaseLinks", () => {
  it("renders only known destinations, with no inert chips", () => {
    const { container } = renderZh(
      <BrandPurchaseLinks
        brand={buildBrand({ purchaseWebsite: "https://harbor.example" })}
      />,
    );

    expect(screen.getByRole("link", { name: LINKS.website })).toHaveAttribute(
      "href",
      "https://harbor.example",
    );
    for (const label of [LINKS.pinkoi, LINKS.shopee, LINKS.myship]) {
      expect(screen.queryByRole("link", { name: label })).toBeNull();
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("[aria-disabled]")).toBeNull();
  });

  it("is a sub-heading of the where-to-buy section", () => {
    renderZh(<BrandPurchaseLinks brand={buildBrand()} />);

    expect(
      screen.getByRole("heading", { level: 3, name: LINKS.onlineStores }),
    ).toBeInTheDocument();
  });

  it("names the missing channels in one muted line when some are live", () => {
    renderZh(
      <BrandPurchaseLinks
        brand={buildBrand({ purchaseWebsite: "https://harbor.example" })}
      />,
    );

    expect(screen.getByText(LINKS.missingChannels)).toHaveClass(
      "type-metadata",
    );
    expect(screen.queryByText(LINKS.noChannels)).toBeNull();
  });

  it("says no store is known when none is live", () => {
    renderZh(<BrandPurchaseLinks brand={buildBrand()} />);

    expect(screen.getByText(LINKS.noChannels)).toBeInTheDocument();
    expect(screen.queryByText(LINKS.missingChannels)).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("prints no muted line when every channel is live", () => {
    renderZh(
      <BrandPurchaseLinks
        brand={buildBrand({
          purchaseWebsite: "https://harbor.example",
          purchasePinkoi: "https://www.pinkoi.com/store/harbor",
          purchaseShopee: "https://shopee.tw/harbor",
          purchaseMyship: "https://myship.7-11.com.tw/general/detail/GM1",
        })}
      />,
    );

    expect(screen.queryByText(LINKS.missingChannels)).toBeNull();
    expect(screen.queryByText(LINKS.noChannels)).toBeNull();
  });
});

describe("link icons", () => {
  // DESIGN.md §2: the palette has no exceptions, brand marks included.
  it("carry no raw hex colour", () => {
    const { container } = renderZh(
      <>
        <BrandPurchaseLinks
          brand={buildBrand({
            purchaseWebsite: "https://harbor.example",
            purchasePinkoi: "https://www.pinkoi.com/store/harbor",
            purchaseShopee: "https://shopee.tw/harbor",
            purchaseMyship: "https://myship.7-11.com.tw/general/detail/GM1",
          })}
        />
        <BrandSocialLinks
          brand={buildBrand({
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
  it("keeps its heading and a muted line when no social link is known", () => {
    const { container } = renderZh(
      <BrandSocialLinks
        brand={buildBrand()}
        sectionIds={{ social: "social" }}
      />,
    );

    expect(container.querySelector("#social")).not.toBeNull();
    expect(
      screen.getByRole("heading", { level: 2, name: LINKS.socialPlatforms }),
    ).toBeInTheDocument();
    expect(screen.getByText(LINKS.noSocialLinks)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("[aria-disabled]")).toBeNull();
  });
});

describe("BrandOtherLinks", () => {
  it("renders nothing without links", () => {
    const { container } = renderZh(<BrandOtherLinks brand={buildBrand()} />);

    expect(container).toBeEmptyDOMElement();
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
