// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../messages/en.json";
import type { Brand } from "@/lib/types";
import { BrandList } from "../brand-list";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/app/admin/actions", () => ({
  hideBrandAction: vi.fn(),
  unhideBrandAction: vi.fn(),
  deleteBrandAction: vi.fn(),
  requestBrandRefreshAction: vi.fn(),
  resendClaimInviteAction: vi.fn(),
}));
vi.mock("@/app/admin/brands/actions", () => ({
  saveAdminBrandReviewAction: vi.fn(),
  cleanupAdminBrandReviewImagesAction: vi.fn(),
}));
vi.mock("@/components/upload/ImageUploader", () => ({
  ImageUploader: () => null,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BrandList detail sheet", () => {
  it("re-renders the open sheet with fresh link values when the brands prop changes", async () => {
    const user = userEvent.setup();
    const brand = makeBrand();
    const { rerender } = renderList([brand]);

    await user.click(
      screen.getByRole("button", { name: "Open details for Memedo" }),
    );

    expect(
      screen.queryByRole("link", { name: "Pinkoi" }),
    ).not.toBeInTheDocument();

    // Simulates the server sending a fresh `brands` prop after router.refresh()
    // following a successful admin save.
    rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <BrandList
          brands={[
            {
              ...brand,
              purchasePinkoi: "https://www.pinkoi.com/store/memedo",
            },
          ]}
        />
      </NextIntlClientProvider>,
    );

    expect(await screen.findByRole("link", { name: "Pinkoi" })).toHaveAttribute(
      "href",
      "https://www.pinkoi.com/store/memedo",
    );
  });

  it("closes the sheet when the selected brand leaves the brands prop", async () => {
    const user = userEvent.setup();
    const brand = makeBrand();
    const { rerender } = renderList([brand]);

    await user.click(
      screen.getByRole("button", { name: "Open details for Memedo" }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <BrandList brands={[]} />
      </NextIntlClientProvider>,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the sheet closed when a departed brand returns in a later refresh", async () => {
    const user = userEvent.setup();
    const brand = makeBrand();
    const { rerender } = renderList([brand]);

    await user.click(
      screen.getByRole("button", { name: "Open details for Memedo" }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <BrandList brands={[]} />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // The brand comes back (re-fetch, status change, undo). The sheet must stay
    // shut — silently springing back open would be its own bug.
    rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <BrandList brands={[brand]} />
      </NextIntlClientProvider>,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open details for Memedo" }),
    ).toHaveAttribute("aria-expanded", "false");
  });
});

function renderList(brands: Brand[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <BrandList brands={brands} />
    </NextIntlClientProvider>,
  );
}

function makeBrand(overrides: Partial<Brand> = {}): Brand {
  return {
    id: "c971ea1a-8fa9-4b4e-a0b8-f57db47bc55b",
    name: "Memedo",
    slug: "memedo",
    description: "中文介紹",
    descriptionEn: null,
    blurb: null,
    blurbEn: null,
    heroImageUrl: null,
    status: "approved",
    productType: "crafts",
    city: "台北",
    category: "crafts",
    isVerified: false,
    mitStatus: "unverified",
    isDemo: false,
    foundingYear: 2018,
    socialInstagram: null,
    socialThreads: null,
    socialFacebook: null,
    purchaseWebsite: null,
    purchasePinkoi: null,
    purchaseShopee: null,
    purchaseMyship: null,
    otherUrls: [],
    productPhotos: [],
    imageAlts: [],
    contactEmail: null,
    priceRange: 2,
    productTags: [],
    productTagsEn: [],
    siteContent: null,
    submittedAt: "2026-01-01T00:00:00.000Z",
    approvedAt: "2026-01-02T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    onboardingDismissedAt: null,
    ...overrides,
  };
}
