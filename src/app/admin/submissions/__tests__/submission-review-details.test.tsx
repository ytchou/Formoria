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
          altZh: null,
          altEn: null,
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

    const languageTabs = screen.getByRole("tablist", {
      name: "Narrative language",
    });
    expect(languageTabs).toHaveClass(
      "border-b",
      "border-border",
      "bg-transparent",
    );
    expect(languageTabs).not.toHaveClass("rounded-lg", "bg-muted");
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

  it("renders the product type as a Mandarin taxonomy label", () => {
    renderDetails(
      makeSubmission({
        reviewData: {
          ...reviewData,
          productType: "beauty",
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
          missingFields: ["description", "website", "additionalImage"],
        },
      }),
    );

    const missing = screen.getByText("Missing required fields").parentElement;
    expect(missing).not.toBeNull();
    expect(within(missing!).getByText("Description")).toBeInTheDocument();
    expect(
      within(missing!).getByText("Valid official website"),
    ).toBeInTheDocument();
    expect(
      within(missing!).getByText("At least one additional image"),
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

  it("saves edited content via inline section save", async () => {
    const user = userEvent.setup();
    renderDetails(makeSubmission());

    const contentHeading = screen.getByText("Content");
    const contentSection = contentHeading.closest("section")!;
    await user.click(within(contentSection).getByRole("button", { name: "Edit" }));

    const descriptions = screen.getAllByRole("textbox", {
      name: /description/i,
    });
    await user.clear(descriptions[0]!);
    await user.type(descriptions[0]!, "更新後的中文介紹");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(reviewActions.save).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      expect.objectContaining({ description: "更新後的中文介紹" }),
    );
  });

  it("keeps translated product tags paired when trimming an over-limit review", async () => {
    const user = userEvent.setup();
    renderDetails(
      makeSubmission({
        reviewData: {
          ...reviewData,
          productTags: ["一", "二", "三", "四", "五", "六", "七"],
          productTagsEn: ["1", "2", "3", "4", "5", "6", "7"],
        },
        reviewCompleteness: {
          complete: false,
          missingFields: ["productTags"],
        },
      }),
    );

    const catalogHeading = screen.getByText("Catalog classification");
    const catalogSection = catalogHeading.closest("section")!;
    await user.click(within(catalogSection).getByRole("button", { name: "Edit" }));

    const productTags = screen.getByRole("textbox", { name: "Product tags" });
    await user.clear(productTags);
    await user.type(productTags, "手工皂, 臉部保養, 身體保養, 洗沐清潔, 香水");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(reviewActions.save).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      expect.objectContaining({
        productTags: ["手工皂", "臉部保養", "身體保養", "洗沐清潔", "香水"],
        productTagsEn: [
          "Handmade Soap",
          "Skincare",
          "Body Care",
          "Bath & Shower",
          "Fragrance",
        ],
      }),
    );
  });

  it("keeps image actions contained in drawer-safe gallery cards", async () => {
    const user = userEvent.setup();
    renderDetails(makeSubmission());

    const imagesSection = screen
      .getByText("Hero / Product Images")
      .closest("section")!;
    await user.click(within(imagesSection).getByRole("button", { name: "Edit" }));

    const heroButton = screen.getByRole("button", {
      name: "Set image 1 as hero",
    });
    const removeButton = screen.getByRole("button", {
      name: "Remove image 1",
    });
    const gallery = heroButton.parentElement?.parentElement?.parentElement;

    expect(gallery).toHaveClass("sm:grid-cols-2");
    expect(gallery).not.toHaveClass("lg:grid-cols-3", "xl:grid-cols-4");
    expect(heroButton).toHaveClass("absolute", "left-2", "top-2");
    expect(removeButton.parentElement).toHaveClass("grid", "grid-cols-3");
    expect(removeButton).toHaveClass("h-12", "w-full");
    expect(removeButton).not.toHaveTextContent("Remove");
  });

  it("cleans up staged uploads and restores the active gallery on cancel", async () => {
    const user = userEvent.setup();
    renderDetails(makeSubmission());

    const imagesHeading = screen.getByText("Hero / Product Images");
    const imagesSection = imagesHeading.closest("section")!;
    await user.click(within(imagesSection).getByRole("button", { name: "Edit" }));

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

const reviewData = {
  name: "Test Brand",
  description: "完整中文介紹",
  descriptionEn: "Complete English description",
  blurb: "品牌摘要",
  blurbEn: "Brand summary",
  city: "台中",
  categoryAttributes: null,
  reputationSummary: null,
  retailLocations: null,
  mitEvidence: null,
  siteContent: null,
  foundingYear: 2018,
  heroImageUrl: "https://cdn.example.com/hero.webp",
  productType: "crafts",
  priceRange: 2,
  productTags: ["木工"],
  productTagsEn: ["Woodwork"],
  websiteUrl: "https://brand.example.com",
  socialInstagram: null,
  socialThreads: null,
  socialFacebook: null,
  purchaseWebsite: "https://brand.example.com",
  purchasePinkoi: null,
  purchaseShopee: null,
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
    otherUrls: [],
    suggestedTags: [],
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
    productTypeNote: null,
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
    altZh: null,
    altEn: null,
    width: 1200,
    height: 900,
  };
}

function renderDetails(submission: BrandSubmissionForReview) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SubmissionReviewDetails submission={submission} />
    </NextIntlClientProvider>,
  );
}
