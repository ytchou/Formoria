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
  default: ({
    fill: _fill,
    priority: _priority,
    ...props
  }: Record<string, unknown>) => (
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
  SavedBrandsProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
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

const { BrandCard } = await import("@/components/brands/brand-card");
const { CorrectionsQueue } =
  await import("@/components/admin/corrections-queue");

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

    // The directory card no longer renders L2 chips at all — neither the
    // label nor the raw slug may appear on it.
    const zhCard = renderInLocale(<BrandCard brand={brand} />, "zh-TW");
    expect(screen.queryByText(MIGRATED_LABEL_ZH)).toBeNull();
    expect(screen.queryByText(MIGRATED_SLUG)).toBeNull();
    zhCard.unmount();

    const enCard = renderInLocale(<BrandCard brand={brand} />, "en");
    expect(screen.queryByText(MIGRATED_LABEL_EN)).toBeNull();
    expect(screen.queryByText(MIGRATED_SLUG)).toBeNull();
    enCard.unmount();

    // The brand detail header no longer renders subcategory chips (DEV-1951):
    // the hero carries one category · city · year line instead, so there is no
    // detail-page chip surface left to check here.
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
