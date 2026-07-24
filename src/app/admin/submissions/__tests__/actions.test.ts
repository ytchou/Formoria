import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminAction: vi.fn(),
  saveSubmissionReview: vi.fn(),
  cleanupSubmissionDraftImages: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/require-admin", () => ({
  requireAdminAction: mocks.requireAdminAction,
}));
vi.mock("@/lib/services/submissions", () => ({
  saveSubmissionReview: mocks.saveSubmissionReview,
  cleanupSubmissionDraftImages: mocks.cleanupSubmissionDraftImages,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
  cleanupSubmissionDraftImagesAction,
  saveSubmissionReviewAction,
} from "../actions";

const validInput = {
  name: "品牌",
  description: "介紹",
  descriptionEn: null,
  blurb: null,
  blurbEn: null,
  city: null,
  categoryAttributes: null,
  reputationSummary: null,
  mitEvidence: null,
  siteContent: null,
  foundingYear: null,
  heroImageUrl: "https://cdn.example.com/hero.webp",
  productType: "crafts",
  priceRange: 2,
  productTags: ["木工"],
  productTagsEn: [],
  websiteUrl: "https://brand.example.com",
  socialInstagram: null,
  socialThreads: null,
  socialFacebook: null,
  purchaseWebsite: "https://brand.example.com",
  purchasePinkoi: null,
  purchaseShopee: null,
  otherUrls: [],
  images: [
    {
      id: "00000000-0000-4000-8000-000000000020",
      isHero: true,
      sortOrder: 0,
    },
  ],
};

describe("submission review actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminAction.mockResolvedValue({
      user: { id: "admin-1", email: "admin@example.com" },
    });
  });

  it("authenticates and saves a validated review", async () => {
    const result = await saveSubmissionReviewAction(
      "00000000-0000-4000-8000-000000000010",
      validInput,
    );

    expect(result).toBeUndefined();
    expect(mocks.saveSubmissionReview).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000010",
      validInput,
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/submissions");
  });

  it("rejects malformed review input at the action boundary", async () => {
    const result = await saveSubmissionReviewAction("not-a-uuid", {
      ...validInput,
      images: [],
    });

    expect(result).toEqual({ error: "Invalid submission review" });
    expect(mocks.saveSubmissionReview).not.toHaveBeenCalled();
  });

  it("cleans up only validated draft image ids", async () => {
    const result = await cleanupSubmissionDraftImagesAction(
      "00000000-0000-4000-8000-000000000010",
      ["00000000-0000-4000-8000-000000000020"],
    );

    expect(result).toBeUndefined();
    expect(mocks.cleanupSubmissionDraftImages).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000010",
      ["00000000-0000-4000-8000-000000000020"],
    );
  });
});
