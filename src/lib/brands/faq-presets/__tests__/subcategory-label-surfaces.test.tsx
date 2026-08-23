/**
 * @vitest-environment jsdom
 */
/**
 * The non-FAQ half of DEV-1510 Task 14: every surface that renders a stored
 * `brands.subcategories` value. Storage is English slugs since the backfill, so
 * a chip that renders the raw value shows Latin text inside zh-TW copy, and the
 * corrections queue — which decides "novel" by looking the value up as a label —
 * flags every migrated row.
 *
 * Placement note: these cases live beside the FAQ preset suite because Task 14's
 * verification runs one command over `src/lib/brands/faq-presets` plus the
 * enrichment FAQ suite, and all four named cases have to appear in it.
 */
import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import enMessages from "../../../../../messages/en.json";
import zhMessages from "../../../../../messages/zh-TW.json";
import type { PublicBrandDetail } from "@/lib/brands/contracts";
import type { CorrectionQueueItem } from "@/components/admin/corrections-queue";

const MIGRATED_SLUG = "backpacks";
const MIGRATED_LABEL_ZH = "後背包";
const MIGRATED_LABEL_EN = "Backpacks";
const NOVEL_TAG = "手工皂磨具";
const NOVEL_MARKER = enMessages.admin.corrections.novelSubcategory;

vi.mock("next/image", () => ({
  default: ({ fill: _fill, priority: _priority, ...props }: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element -- this IS the mock of next/image
    <img alt="" {...props} />
  ),
}));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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
  trackBrandCardClicked: vi.fn(),
  trackBrandSaved: vi.fn(),
  trackBrandUnsaved: vi.fn(),
  trackRecommendationBrandClicked: vi.fn(),
  trackSavedBrandRevisited: vi.fn(),
}));

vi.mock("@/hooks/use-saved-brands", () => ({
  SavedBrandsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useSavedBrands: () => ({
    savedIds: new Set<string>(),
    toggle: vi.fn(),
    loading: false,
  }),
}));

vi.mock("@/lib/auth/use-user", () => ({
  useUser: () => ({
    user: null,
    loading: false,
    viewer: { isAdmin: false },
    viewerLoading: false,
    viewerError: false,
    refreshViewer: vi.fn(),
  }),
}));

// The correction dialog reaches a server action and is not what this file is
// about; the header's chip row is. Stubbing it keeps the render to the chips.
vi.mock("@/components/brands/correction-dialog", () => ({
  CorrectionDialog: () => null,
}));

const { BrandCard } = await import("@/components/brands/brand-card");
const { BrandHeader } = await import("@/components/brands/brand-header");
const { CorrectionsQueue } = await import(
  "@/components/admin/corrections-queue"
);

function buildBrand(
  overrides: Partial<PublicBrandDetail> = {},
): PublicBrandDetail {
  return {
    id: "0f2a2f6c-7a9e-4a7f-9d64-9f2b1c5f0a11",
    name: "Harbor Form",
    slug: "harbor-form",
    description: "A maker of quiet things.",
    descriptionEn: "A maker of quiet things.",
    blurb: null,
    blurbEn: null,
    heroImageUrl: null,
    status: "approved",
    categorySlug: "bags-accessories",
    categoryLabel: "包袋配件",
    city: null,
    mitStatus: "unverified",
    mitStory: null,
    mitCertificateNumber: null,
    priceRange: null,
    subcategories: [MIGRATED_SLUG],
    subcategoriesEn: [MIGRATED_LABEL_EN],
    foundingYear: null,
    productPhotos: [],
    imageAlts: [],
    heroImageMetadata: null,
    socialInstagram: null,
    socialThreads: null,
    socialFacebook: null,
    otherUrls: [],
    ...overrides,
  } as unknown as PublicBrandDetail;
}

function renderInLocale(node: ReactNode, locale: "zh-TW" | "en") {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? enMessages : zhMessages}
    >
      {node}
    </NextIntlClientProvider>,
  );
}

/**
 * The wrapper element holding one proposed-subcategory chip and its flags,
 * scoped to the queue row so the drawer copy of the same markup cannot match.
 */
function chipGroup(row: HTMLElement, text: string): HTMLElement {
  const badge = within(row).getByText(text);
  const group = badge.parentElement;
  if (!group) throw new Error(`No chip group renders "${text}"`);
  return group;
}

describe("subcategory label surfaces", () => {
  it("brand_chips_render_localised_labels", () => {
    const brand = buildBrand();

    const zhCard = renderInLocale(
      <BrandCard brand={brand} />,
      "zh-TW",
    );
    expect(screen.getByText(MIGRATED_LABEL_ZH)).toBeInTheDocument();
    expect(screen.queryByText(MIGRATED_SLUG)).toBeNull();
    zhCard.unmount();

    const enCard = renderInLocale(
      <BrandCard brand={brand} />,
      "en",
    );
    expect(screen.getByText(MIGRATED_LABEL_EN)).toBeInTheDocument();
    expect(screen.queryByText(MIGRATED_SLUG)).toBeNull();
    enCard.unmount();

    const zhDetail = renderInLocale(
      <BrandHeader brand={brand} locale="zh-TW" />,
      "zh-TW",
    );
    expect(screen.getByText(MIGRATED_LABEL_ZH)).toBeInTheDocument();
    expect(screen.queryByText(MIGRATED_SLUG)).toBeNull();
    zhDetail.unmount();

    const enDetail = renderInLocale(
      <BrandHeader brand={brand} locale="en" />,
      "en",
    );
    expect(screen.getByText(MIGRATED_LABEL_EN)).toBeInTheDocument();
    expect(screen.queryByText(MIGRATED_SLUG)).toBeNull();
    enDetail.unmount();

    // A tag the vocabulary has never known keeps the string it was authored
    // with, in both locales — the novel-tag escape hatch.
    const novelBrand = buildBrand({
      subcategories: ["手工燈籠"],
      subcategoriesEn: ["Handmade Lanterns"],
    });
    const zhNovel = renderInLocale(
      <BrandHeader brand={novelBrand} locale="zh-TW" />,
      "zh-TW",
    );
    expect(screen.getByText("手工燈籠")).toBeInTheDocument();
    zhNovel.unmount();

    renderInLocale(<BrandHeader brand={novelBrand} locale="en" />, "en");
    expect(screen.getByText("Handmade Lanterns")).toBeInTheDocument();
  });

  it("corrections_queue_does_not_flag_migrated_tags", () => {
    const correction: CorrectionQueueItem = {
      id: "3f6d0b4e-9c1f-4f2a-9a2e-2c6b8f4d1a07",
      brandName: "Harbor Form",
      field: "subcategories",
      currentValue: [],
      proposedValue: { add: [MIGRATED_SLUG, NOVEL_TAG], remove: [] },
      stale: false,
      createdAt: "2026-08-19T00:00:00.000Z",
    };

    renderInLocale(<CorrectionsQueue corrections={[correction]} />, "en");
    const row = screen.getByRole("row", { name: /Harbor Form/u });

    // The migrated value resolves through the ontology, so it reads as a label
    // and carries no novel flag.
    expect(within(row).queryByText(`+${MIGRATED_SLUG}`)).toBeNull();
    expect(
      within(chipGroup(row, `+${MIGRATED_LABEL_EN}`)).queryByText(NOVEL_MARKER),
    ).toBeNull();

    // The genuinely unknown tag is still flagged — the gap signal survives.
    expect(
      within(chipGroup(row, `+${NOVEL_TAG}`)).getByText(NOVEL_MARKER),
    ).toBeInTheDocument();
    expect(within(row).getAllByText(NOVEL_MARKER)).toHaveLength(1);
  });
});
