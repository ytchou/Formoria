// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en.json";
import type {
  BrandSubmissionForReview,
  SubmissionReviewImage,
} from "@/lib/services/submissions";
import type { ExistingCuratedProduct } from "@/lib/services/curated-products/proposal-diff";
import type { CuratedProductProposal } from "@/lib/types/enriched-data";
import { SubmissionReviewDetails } from "../submission-review-details";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));
const reviewActions = vi.hoisted(() => ({
  save: vi.fn(),
  cleanup: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("../actions", () => ({
  saveSubmissionReviewAction: reviewActions.save,
  cleanupSubmissionDraftImagesAction: reviewActions.cleanup,
}));
vi.mock("@/components/upload/ImageUploader", () => ({
  ImageUploader: ({
    onUpload,
  }: {
    onUpload: (url: string, metadata: unknown) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onUpload("https://cdn.example.com/draft.webp", {
          id: "00000000-0000-4000-8000-000000000003",
          submissionId: "00000000-0000-4000-8000-000000000001",
          storagePath: "submissions/review/draft.webp",
          url: "https://cdn.example.com/draft.webp",
          source: "admin",
          status: "draft",
          sortOrder: 2,
          isLogo: false,
          width: 1200,
          height: 900,
        })
      }
    >
      Upload staged image
    </button>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  reviewActions.save.mockResolvedValue(undefined);
  reviewActions.cleanup.mockResolvedValue(undefined);
});

describe("SubmissionReviewDetails", () => {
  it("shows one narrative language at a time and defaults to Mandarin", async () => {
    const user = userEvent.setup();
    renderDetails(makeSubmission());

    expect(
      screen.getByRole("tablist", { name: "Narrative language" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Mandarin" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("完整中文介紹")).toBeInTheDocument();
    expect(screen.getByText("品牌摘要")).toBeInTheDocument();
    expect(
      screen.queryByText("Complete English description"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Brand summary")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "English" }));

    expect(screen.queryByText("完整中文介紹")).not.toBeInTheDocument();
    expect(screen.queryByText("品牌摘要")).not.toBeInTheDocument();
    expect(
      screen.getByText("Complete English description"),
    ).toBeInTheDocument();
    expect(screen.getByText("Brand summary")).toBeInTheDocument();
  });

  it("renders structured reputation prose and deduplicated hostname sources", async () => {
    const user = userEvent.setup();
    const reputationUrl = "https://www.example.com/reviews/formoria";
    renderDetails(
      makeSubmission({
        reviewData: {
          ...reviewData,
          reputationSummary: {
            text: "中文口碑摘要",
            text_en: "English reputation summary",
            sources: [
              { url: reputationUrl },
              { url: reputationUrl },
              { url: "http://press.example.org/article" },
              { url: "ftp://invalid.example.com/reputation" },
              { url: "not a URL" },
              "https://raw.example.com/source",
              null,
            ],
          },
        },
      }),
    );

    const summary = screen.getByText("中文口碑摘要");
    expect(summary.tagName).toBe("P");
    expect(summary.closest("li")).toBeNull();
    expect(
      screen.queryByText("English reputation summary"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Sources")).toBeInTheDocument();

    const reputationLinks = screen.getAllByRole("link", {
      name: "example.com",
    });
    expect(reputationLinks).toHaveLength(1);
    expect(reputationLinks[0]).toHaveAttribute("href", reputationUrl);
    expect(
      screen.getByRole("link", { name: "press.example.org" }),
    ).toHaveAttribute("href", "http://press.example.org/article");
    expect(screen.queryByText(reputationUrl)).not.toBeInTheDocument();
    expect(
      screen.queryByText("ftp://invalid.example.com/reputation"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("not a URL")).not.toBeInTheDocument();
    expect(
      screen.queryByText("https://raw.example.com/source"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "English" }));

    expect(screen.queryByText("中文口碑摘要")).not.toBeInTheDocument();
    expect(screen.getByText("English reputation summary")).toBeInTheDocument();
  });

  it("supports camel-case English reputation text", async () => {
    const user = userEvent.setup();
    renderDetails(
      makeSubmission({
        reviewData: {
          ...reviewData,
          descriptionEn: null,
          blurbEn: null,
          reputationSummary: {
            text: "中文口碑摘要",
            textEn: "Camel-case English reputation",
            sources: [],
          },
        },
      }),
    );

    await user.click(screen.getByRole("tab", { name: "English" }));

    expect(
      screen.getByText("Camel-case English reputation"),
    ).toBeInTheDocument();
  });

  it("falls back to Mandarin reputation in an otherwise-English narrative", async () => {
    const user = userEvent.setup();
    renderDetails(
      makeSubmission({
        reviewData: {
          ...reviewData,
          reputationSummary: {
            text: "中文備用口碑",
            sources: [],
          },
        },
      }),
    );

    await user.click(screen.getByRole("tab", { name: "English" }));

    expect(
      screen.getByText("Complete English description"),
    ).toBeInTheDocument();
    expect(screen.getByText("中文備用口碑")).toBeInTheDocument();
  });

  it("disables English when no English narrative exists", () => {
    renderDetails(
      makeSubmission({
        reviewData: {
          ...reviewData,
          descriptionEn: null,
          blurbEn: null,
          reputationSummary: {
            text: "只有中文口碑",
            sources: [],
          },
        },
      }),
    );

    expect(screen.getByRole("tab", { name: "English" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("renders the category as a Mandarin taxonomy label", () => {
    renderDetails(
      makeSubmission({
        reviewData: {
          ...reviewData,
          categorySlug: "beauty",
        },
      }),
    );

    expect(screen.getByText("美妝保養")).toBeInTheDocument();
    expect(screen.queryByText("beauty")).not.toBeInTheDocument();
  });

  it("shows per-section Edit links for pending submissions", () => {
    renderDetails(makeSubmission());
    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    expect(editButtons.length).toBeGreaterThanOrEqual(3);
  });

  it("hides Edit links for non-pending submissions", () => {
    renderDetails(makeSubmission({ status: "approved" }));
    expect(
      screen.queryByRole("button", { name: "Edit" }),
    ).not.toBeInTheDocument();
  });

  it("shows every missing required field", () => {
    renderDetails(
      makeSubmission({
        reviewCompleteness: {
          complete: false,
          missingFields: ["description", "website"],
        },
      }),
    );

    const missing = screen.getByText("Missing required fields").parentElement;
    expect(missing).not.toBeNull();
    expect(within(missing!).getByText("Description")).toBeInTheDocument();
    expect(
      within(missing!).getByText("Valid official website"),
    ).toBeInTheDocument();
  });

  it("hides stale missing-field warnings after review", () => {
    renderDetails(
      makeSubmission({
        status: "approved",
        reviewCompleteness: {
          complete: false,
          missingFields: ["description"],
        },
      }),
    );

    expect(
      screen.queryByText("Missing required fields"),
    ).not.toBeInTheDocument();
  });

  it("keeps image actions contained in drawer-safe gallery cards", async () => {
    const user = userEvent.setup();
    renderDetails(makeSubmission());

    const imagesSection = screen
      .getByText("Hero / Product Images")
      .closest("section")!;
    await user.click(
      within(imagesSection).getByRole("button", { name: "Edit" }),
    );

    expect(
      screen.getByRole("button", { name: "Set image 1 as hero" }),
    ).toBeInTheDocument();
    const removeButton = screen.getByRole("button", {
      name: "Remove image 1",
    });

    expect(removeButton).not.toHaveTextContent("Remove");
  });

  it("preserves referenced owner images while allowing enrichment images to retire", async () => {
    const user = userEvent.setup();
    const ownerImage = {
      ...reviewImage(
        "00000000-0000-4000-8000-000000000011",
        "https://cdn.example.com/hero.webp",
        0,
      ),
      source: "owner",
      originBrandImageId: "00000000-0000-4000-8000-000000000021",
    };
    const enrichmentImage = {
      ...reviewImage(
        "00000000-0000-4000-8000-000000000012",
        "https://cdn.example.com/detail.webp",
        1,
      ),
      source: "legacy",
      originBrandImageId: "00000000-0000-4000-8000-000000000022",
    };
    renderDetails(
      makeSubmission({
        intent: "refresh",
        reviewKind: "refresh",
        brandId: "00000000-0000-4000-8000-000000000031",
        reviewImages: [ownerImage, enrichmentImage],
      }),
    );

    const imagesSection = screen
      .getByText("Hero / Product Images")
      .closest("section")!;
    await user.click(
      within(imagesSection).getByRole("button", { name: "Edit" }),
    );

    expect(
      screen.getByRole("button", { name: "Remove image 1" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Remove image 2" }),
    ).toBeEnabled();
  });

  it("cleans up staged uploads and restores the active gallery on cancel", async () => {
    const user = userEvent.setup();
    renderDetails(makeSubmission());

    const imagesHeading = screen.getByText("Hero / Product Images");
    const imagesSection = imagesHeading.closest("section")!;
    await user.click(
      within(imagesSection).getByRole("button", { name: "Edit" }),
    );

    await user.click(
      screen.getByRole("button", { name: "Upload staged image" }),
    );
    expect(
      screen.getByRole("button", { name: "Set image 3 as hero" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(reviewActions.cleanup).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      ["00000000-0000-4000-8000-000000000003"],
    );
    expect(
      screen.queryByRole("button", { name: "Set image 3 as hero" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("完整中文介紹")).toBeInTheDocument();
  });
});

/**
 * Curated-product proposals (DEV-1469). The reviewer's job here is to TICK, not
 * to retype, so these cases are all about what the tick set defaults to, what a
 * rejection looks like when the run proposes it again, and what the save
 * carries.
 */
describe("SubmissionReviewDetails — curated product proposals", () => {
  it("renders_one_row_per_proposal — every proposal shows its name, category, material and description", () => {
    renderDetails(withProposals([mugProposal, trayProposal]));

    const section = productsSection();
    expect(within(section).getAllByRole("listitem")).toHaveLength(2);
    expect(
      within(section).getByText("柴燒手感馬克杯 (Wood-fired Mug)"),
    ).toBeInTheDocument();
    expect(
      within(section).getByText("竹編手織托盤 (Handwoven Bamboo Tray)"),
    ).toBeInTheDocument();
    expect(within(section).getAllByText("居家生活")).toHaveLength(2);
    expect(within(section).getByText("陶瓷")).toBeInTheDocument();
    expect(within(section).getByText("竹")).toBeInTheDocument();
    expect(
      within(section).getByText(mugProposal.productDescriptionZh),
    ).toBeInTheDocument();
    expect(
      within(section).getByText(trayProposal.productDescriptionZh),
    ).toBeInTheDocument();
  });

  it("keep_toggle_defaults_to_ticked_for_new_proposals — a previously rejected one starts unticked", async () => {
    const user = userEvent.setup();
    renderDetails(withProposals([mugProposal, trayProposal]), [
      rejectedRow(trayProposal),
    ]);

    await user.click(
      within(productsSection()).getByRole("button", { name: "Edit" }),
    );

    expect(
      screen.getByRole("checkbox", { name: "Keep 柴燒手感馬克杯" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Keep 柴燒手感馬克杯" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("checkbox", { name: "Keep 竹編手織托盤" }),
    ).not.toBeChecked();
  });

  it("marks_previously_rejected_proposals — rejection memory renders instead of a new-proposal state", () => {
    renderDetails(withProposals([mugProposal, trayProposal]), [
      rejectedRow(trayProposal),
    ]);

    const [mugRow, trayRow] =
      within(productsSection()).getAllByRole("listitem");
    expect(within(mugRow!).getByText("New proposal")).toBeInTheDocument();
    expect(
      within(trayRow!).getByText("Previously rejected"),
    ).toBeInTheDocument();
    expect(
      within(trayRow!).queryByText("New proposal"),
    ).not.toBeInTheDocument();
  });

  it("locks_a_proposal_the_catalog_already_holds — materialization is create-only, so the controls must not promise an edit", async () => {
    const user = userEvent.setup();
    renderDetails(withProposals([mugProposal, trayProposal]), [
      matchedRow(mugProposal),
      rejectedRow(trayProposal),
    ]);

    await user.click(
      within(productsSection()).getByRole("button", { name: "Edit" }),
    );

    // `materialize` inserts for `new` and does nothing for `matched` or
    // `previously-rejected`, so a tick or a retyped name on those rows is
    // accepted, saved, and then silently discarded at approval.
    expect(
      screen.getByRole("checkbox", { name: "Keep 柴燒手感馬克杯" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: "Keep 竹編手織托盤" }),
    ).toBeDisabled();
    for (const field of screen.getAllByLabelText("Product name (zh-TW)")) {
      expect(field).toBeDisabled();
    }
    for (const field of screen.getAllByLabelText(
      "Product description (zh-TW)",
    )) {
      expect(field).toBeDisabled();
    }
    // Said on screen, not only in a disabled attribute.
    expect(
      screen.getAllByText(/Approval creates products only from new proposals/),
    ).toHaveLength(2);
  });

  it("saves_the_ticked_subset — the payload carries exactly the ticked keys", async () => {
    const user = userEvent.setup();
    renderDetails(withProposals([mugProposal, trayProposal]));

    await user.click(
      within(productsSection()).getByRole("button", { name: "Edit" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Keep 柴燒手感馬克杯" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Save product selection and edits" }),
    );

    expect(reviewActions.save).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      expect.objectContaining({ keptProductKeys: [trayProposal.key] }),
    );
  });

  it("writes_no_kept_keys_when_nothing_was_ticked — an unedited save records no decision", async () => {
    const user = userEvent.setup();
    renderDetails(withProposals([mugProposal, trayProposal]));

    await user.click(
      within(productsSection()).getByRole("button", { name: "Edit" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Save product selection and edits" }),
    );

    // Seeding the computed default into the draft wrote a phantom
    // `review_overrides.kept_product_keys`. After a phase re-run those keys name
    // the OLD proposals, and because the value is defined, `materialize` skips
    // its "every new proposal is kept" default and files every fresh proposal as
    // permanent rejection memory for a decision the reviewer never made.
    expect(reviewActions.save).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      expect.not.objectContaining({ keptProductKeys: expect.anything() }),
    );
  });

  it("keep_toggle_has_an_accessible_name_naming_the_product — never a bare 'Keep'", async () => {
    const user = userEvent.setup();
    renderDetails(withProposals([mugProposal, trayProposal]));

    await user.click(
      within(productsSection()).getByRole("button", { name: "Edit" }),
    );

    expect(
      screen.getByRole("checkbox", { name: /柴燒手感馬克杯/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /竹編手織托盤/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "Keep" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the section out of the review entirely when the run proposed nothing", () => {
    renderDetails(makeSubmission());

    expect(
      screen.queryByText("Curated product proposals"),
    ).not.toBeInTheDocument();
  });

  it("carries an edited proposal in the save payload, so a fixed name is not lost", async () => {
    const user = userEvent.setup();
    renderDetails(withProposals([mugProposal]));

    await user.click(
      within(productsSection()).getByRole("button", { name: "Edit" }),
    );
    const nameField = screen.getByLabelText("Product name (zh-TW)");
    await user.clear(nameField);
    await user.type(nameField, "柴燒馬克杯");
    await user.click(
      screen.getByRole("button", { name: "Save product selection and edits" }),
    );

    expect(reviewActions.save).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      expect.objectContaining({
        products: [expect.objectContaining({ nameZh: "柴燒馬克杯" })],
      }),
    );
  });
});

function productsSection() {
  return screen.getByText("Curated product proposals").closest("section")!;
}

const mugProposal: CuratedProductProposal = {
  key: "chai-shao-shou-kan-ma-ko-pei",
  nameZh: "柴燒手感馬克杯",
  nameEn: "Wood-fired Mug",
  category: "home",
  subcategories: ["tableware"],
  material: ["ceramic"],
  officialUrl: "https://taoqi.com.tw/products/wood-fired-mug",
  productDescriptionZh:
    "南投柴燒窯場燒製的馬克杯，杯身留有落灰痕跡，每一只的顏色都不一樣。",
  sources: [
    {
      url: "https://taoqi.com.tw/products/wood-fired-mug",
      sourceType: "official",
    },
  ],
};

const trayProposal: CuratedProductProposal = {
  key: "chu-pien-shou-chih-to-pan",
  nameZh: "竹編手織托盤",
  nameEn: "Handwoven Bamboo Tray",
  category: "home",
  subcategories: ["storage"],
  material: ["bamboo"],
  officialUrl: "https://taoqi.com.tw/products/bamboo-tray",
  productDescriptionZh: "南投竹山的桂竹，師傅手工編成的方形托盤，可以水洗。",
  sources: [
    {
      url: "https://taoqi.com.tw/products/bamboo-tray",
      sourceType: "official",
    },
  ],
};

/**
 * The proposals ride `enriched_data`, and the service seeds `reviewData.products`
 * from it — the same relationship `channels` has. Both are set here so the
 * fixture stays readable as the real thing rather than as UI-only state.
 */
function withProposals(
  products: CuratedProductProposal[],
): BrandSubmissionForReview {
  return makeSubmission({
    enriched_data: { products },
    reviewData: { ...reviewData, products },
  });
}

/** The brand already publishes this product, so a re-proposal is not new. */
function matchedRow(proposal: CuratedProductProposal): ExistingCuratedProduct {
  return {
    key: proposal.key,
    officialUrl: proposal.officialUrl,
    visible: true,
  };
}

/** A rejected proposal materializes as a hidden row, never as a delete. */
function rejectedRow(proposal: CuratedProductProposal): ExistingCuratedProduct {
  return {
    key: proposal.key,
    officialUrl: proposal.officialUrl,
    visible: false,
  };
}

const reviewData = {
  name: "Test Brand",
  description: "完整中文介紹",
  descriptionEn: "Complete English description",
  blurb: "品牌摘要",
  blurbEn: "Brand summary",
  city: "台中",
  reputationSummary: null,
  mitEvidence: null,
  siteContent: null,
  foundingYear: 2018,
  heroImageUrl: "https://cdn.example.com/hero.webp",
  categorySlug: "home",
  subcategories: ["家具"],
  subcategoriesEn: ["Furniture"],
  websiteUrl: "https://brand.example.com",
  socialInstagram: null,
  socialThreads: null,
  socialFacebook: null,
  purchaseWebsite: "https://brand.example.com",
  purchasePinkoi: null,
  purchaseShopee: null,
  purchaseMyship: null,
  otherUrls: [],
};

function makeSubmission(
  overrides: Partial<BrandSubmissionForReview> = {},
): BrandSubmissionForReview {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    brandId: null,
    brandName: "Test Brand",
    submitterEmail: "submitter@example.com",
    submitterName: "Submitter",
    description: reviewData.description,
    websiteUrl: reviewData.websiteUrl,
    heroImageUrl: reviewData.heroImageUrl,
    socialInstagram: null,
    socialThreads: null,
    socialFacebook: null,
    purchaseWebsite: reviewData.purchaseWebsite,
    purchasePinkoi: null,
    purchaseShopee: null,
    purchaseMyship: null,
    otherUrls: [],
    suggestedSubcategories: [],
    status: "pending",
    reviewerNotes: null,
    submittedAt: "2026-07-18T00:00:00.000Z",
    reviewedAt: null,
    reviewedBy: null,
    pdpaConsentAt: null,
    validationStatus: null,
    validationErrors: null,
    notifiedAt: null,
    isBrandOwner: false,
    sourceAttribution: "found_online",
    intent: "recommend",
    categoryNote: null,
    reviewKind: "new",
    duplicateWarning: null,
    baseBrandData: null,
    baseBrandUpdatedAt: null,
    reviewOverrides: {},
    enriched_data: null,
    latestCurationTargetStatus: "succeeded",
    latestCurationJobId: null,
    latestCurationPhase: null,
    latestCurationError: null,
    latestCurationJobStatus: "completed",
    latestCurationDispatchStatus: "dispatched",
    reviewStage: "ready",
    reviewData,
    reviewImages: [
      reviewImage(
        "00000000-0000-4000-8000-000000000011",
        "https://cdn.example.com/hero.webp",
        0,
      ),
      reviewImage(
        "00000000-0000-4000-8000-000000000012",
        "https://cdn.example.com/detail.webp",
        1,
      ),
    ],
    reviewCompleteness: { complete: true, missingFields: [] },
    ...overrides,
  };
}

function reviewImage(
  id: string,
  url: string,
  sortOrder: number,
): SubmissionReviewImage {
  return {
    id,
    submissionId: "00000000-0000-4000-8000-000000000001",
    storagePath: `submissions/review/${id}.webp`,
    url,
    source: "admin",
    status: "active",
    sortOrder,
    isLogo: false,
    width: 1200,
    height: 900,
    originBrandImageId: null,
  };
}

function renderDetails(
  submission: BrandSubmissionForReview,
  existingProducts: ExistingCuratedProduct[] = [],
) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SubmissionReviewDetails
        submission={submission}
        existingProducts={existingProducts}
      />
    </NextIntlClientProvider>,
  );
}
