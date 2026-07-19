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
const adminActions = vi.hoisted(() => ({
  approve: vi.fn(),
  reject: vi.fn(),
}));
const reviewActions = vi.hoisted(() => ({
  save: vi.fn(),
  cleanup: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/app/admin/actions", () => ({
  approveSubmissionAction: adminActions.approve,
  rejectSubmissionAction: adminActions.reject,
}));
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
  adminActions.approve.mockResolvedValue(undefined);
  adminActions.reject.mockResolvedValue(undefined);
  reviewActions.save.mockResolvedValue(undefined);
  reviewActions.cleanup.mockResolvedValue(undefined);
});

describe("SubmissionReviewDetails", () => {
  it("renders Chinese content before English and omits empty optional groups", () => {
    renderDetails(makeSubmission());

    const chinese = screen.getByText("完整中文介紹");
    const english = screen.getByText("Complete English description");
    expect(
      chinese.compareDocumentPosition(english) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByText("MIT evidence")).not.toBeInTheDocument();
    expect(screen.queryByText("Reputation")).not.toBeInTheDocument();
    expect(screen.queryByText("Retail locations")).not.toBeInTheDocument();
  });

  it("shows every missing required field and disables approval", () => {
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
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
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

  it("saves edited persisted review data and ordered active images", async () => {
    const user = userEvent.setup();
    renderDetails(makeSubmission());

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const descriptions = screen.getAllByRole("textbox", {
      name: /description/i,
    });
    await user.clear(descriptions[0]!);
    await user.type(descriptions[0]!, "更新後的中文介紹");
    await user.click(
      screen.getByRole("button", { name: "Set image 2 as hero" }),
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(reviewActions.save).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      expect.objectContaining({
        description: "更新後的中文介紹",
        heroImageUrl: "https://cdn.example.com/detail.webp",
        images: [
          {
            id: "00000000-0000-4000-8000-000000000012",
            isHero: true,
            sortOrder: 0,
          },
          {
            id: "00000000-0000-4000-8000-000000000011",
            isHero: false,
            sortOrder: 1,
          },
        ],
      }),
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

    await user.click(screen.getByRole("button", { name: "Edit" }));
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

  it("cleans up staged uploads and restores the active gallery on cancel", async () => {
    const user = userEvent.setup();
    renderDetails(makeSubmission());

    await user.click(screen.getByRole("button", { name: "Edit" }));
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
