// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en.json";
import type { ReviewSubmission, TabValue } from "../submissions-review-list";
import { SubmissionsReviewList } from "../submissions-review-list";

const navigation = vi.hoisted(() => ({
  refresh: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
}));
const actions = vi.hoisted(() => ({
  approve: vi.fn(),
  reject: vi.fn(),
  enrich: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => "/admin/submissions",
}));
vi.mock("@/app/admin/actions", () => ({
  approveSubmissionAction: actions.approve,
  rejectSubmissionAction: actions.reject,
}));
vi.mock("@/app/admin/operations/actions", () => ({
  startCurationJobAction: actions.enrich,
}));
vi.mock("../submission-review-details", () => ({
  SubmissionReviewDetails: ({
    submission,
    initiallyEditing,
  }: {
    submission: ReviewSubmission;
    initiallyEditing?: boolean;
  }) => (
    <div>{`${initiallyEditing ? "editing" : "details"}-${submission.id}`}</div>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  actions.approve.mockResolvedValue(undefined);
  actions.reject.mockResolvedValue(undefined);
});

describe("SubmissionsReviewList", () => {
  it("filters by complete or incomplete persisted review state", async () => {
    const user = userEvent.setup();
    renderList(
      [
        makeSubmission({ id: "complete", brandName: "Complete Brand" }),
        makeSubmission({
          id: "incomplete",
          brandName: "Incomplete Brand",
          reviewStage: "needs_data",
          reviewCompleteness: {
            complete: false,
            missingFields: ["priceRange"],
          },
        }),
      ],
      "all",
    );

    await user.click(
      screen.getByRole("combobox", { name: /enrichment completeness/i }),
    );
    await user.click(await screen.findByRole("option", { name: "Complete" }));
    expect(screen.getByText("Complete Brand")).toBeInTheDocument();
    expect(screen.queryByText("Incomplete Brand")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("combobox", { name: /enrichment completeness/i }),
    );
    await user.click(await screen.findByRole("option", { name: "Incomplete" }));
    expect(screen.queryByText("Complete Brand")).not.toBeInTheDocument();
    expect(screen.getByText("Incomplete Brand")).toBeInTheDocument();
  });

  it("searches brand, submitter, email, and website before pagination", async () => {
    const user = userEvent.setup();
    renderList(
      [
        makeSubmission({ id: "one", brandName: "Wood Studio" }),
        makeSubmission({
          id: "two",
          brandName: "Tea House",
          submitterName: "Mei Lin",
          submitterEmail: "mei@example.com",
          reviewData: {
            ...baseReviewData,
            name: "Tea House",
            websiteUrl: "https://tea.example.com",
          },
        }),
      ],
      "all",
    );

    const search = screen.getByRole("textbox", { name: "Search submissions" });
    await user.type(search, "tea.example.com");

    expect(screen.getByText("Tea House")).toBeInTheDocument();
    expect(screen.queryByText("Wood Studio")).not.toBeInTheDocument();
  });

  it("paginates needs-data selection by ten and selects only the visible page", async () => {
    const user = userEvent.setup();
    renderList(
      Array.from({ length: 11 }, (_, index) =>
        makeSubmission({
          id: `submission-${index + 1}`,
          brandName: `Brand ${index + 1}`,
          reviewStage: "needs_data",
          reviewData: { ...baseReviewData, name: `Brand ${index + 1}` },
        }),
      ),
      "needs_data",
    );

    expect(screen.getByText("Brand 10")).toBeInTheDocument();
    expect(screen.queryByText("Brand 11")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("checkbox", { name: "Select submissions on this page" }),
    );

    const visibleSelection = screen
      .getAllByRole<HTMLInputElement>("checkbox")
      .filter((checkbox) => checkbox.checked);
    expect(visibleSelection).toHaveLength(11);

    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Brand 11")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Select Brand 11" }),
    ).not.toBeChecked();
  });

  it("bulk approves exactly the selected ready submissions", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderList(
      Array.from({ length: 5 }, (_, index) =>
        makeSubmission({
          id: `ready-${index + 1}`,
          brandName: `Ready Brand ${index + 1}`,
          reviewData: { ...baseReviewData, name: `Ready Brand ${index + 1}` },
        }),
      ),
      "ready",
    );

    for (const name of ["Ready Brand 1", "Ready Brand 3", "Ready Brand 5"]) {
      await user.click(
        screen.getByRole("checkbox", { name: `Select ${name}` }),
      );
    }
    await user.click(
      screen.getByRole("button", { name: "Approve 3 selected" }),
    );

    expect(actions.approve).toHaveBeenCalledTimes(3);
    expect(actions.approve.mock.calls.map(([id]) => id)).toEqual([
      "ready-1",
      "ready-3",
      "ready-5",
    ]);
  });

  it("shows only the actions owned by the active review stage", () => {
    const readyView = renderList([makeSubmission()], "ready");

    expect(
      screen.queryByRole("button", { name: "Fetch Data" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Approve 0 selected" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Reject 0 selected" }),
    ).toBeDisabled();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: /^Approve$/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Reject$/ }),
    ).toBeInTheDocument();

    readyView.unmount();
    renderList(
      [
        makeSubmission({
          reviewStage: "needs_data",
          latestCurationTargetStatus: null,
          reviewCompleteness: {
            complete: false,
            missingFields: ["successfulEnrichment"],
          },
        }),
      ],
      "needs_data",
    );

    expect(
      screen.getByRole("button", { name: "Fetch Data" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Approve \d+ selected/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Reject \d+ selected/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Approve$/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Reject$/ }),
    ).not.toBeInTheDocument();
  });

  it("opens one accessible review disclosure and ignores row action clicks", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderList(
      [
        makeSubmission({ id: "one", brandName: "First Brand" }),
        makeSubmission({ id: "two", brandName: "Second Brand" }),
      ],
      "all",
    );

    const firstChevron = screen.getByRole("button", {
      name: "Expand review for First Brand",
    });
    expect(firstChevron).toHaveAttribute("aria-expanded", "false");
    await user.click(firstChevron);
    expect(screen.getByText("details-one")).toBeInTheDocument();
    expect(firstChevron).toHaveAttribute("aria-expanded", "true");

    await user.click(
      screen.getByRole("button", { name: "Expand review for Second Brand" }),
    );
    expect(screen.queryByText("details-one")).not.toBeInTheDocument();
    expect(screen.getByText("details-two")).toBeInTheDocument();

    const secondRow = screen.getByText("Second Brand").closest("tr");
    expect(secondRow).not.toBeNull();
    await user.click(
      within(secondRow!).getByRole("button", { name: "Approve" }),
    );
    expect(actions.approve).toHaveBeenCalledTimes(1);
    expect(actions.approve).toHaveBeenCalledWith("two");
    expect(screen.getByText("details-two")).toBeInTheDocument();

    const firstRow = screen.getByText("First Brand").closest("tr");
    expect(firstRow).not.toBeNull();
    await user.click(within(firstRow!).getByRole("button", { name: "Reject" }));
    expect(actions.reject).toHaveBeenCalledTimes(1);
    expect(actions.reject).toHaveBeenCalledWith("one", "admin_reject", "");
  });

  it("opens Edit from the row beside Reject", async () => {
    const user = userEvent.setup();
    renderList(
      [makeSubmission({ id: "one", brandName: "First Brand" })],
      "all",
    );

    const row = screen.getByText("First Brand").closest("tr");
    expect(row).not.toBeNull();
    const reject = within(row!).getByRole("button", { name: "Reject" });
    const edit = within(row!).getByRole("button", { name: "Edit" });
    expect(reject.nextElementSibling).toBe(edit);

    await user.click(edit);
    expect(screen.getByText("editing-one")).toBeInTheDocument();
  });

  it("keeps row approval disabled when review data is incomplete", () => {
    renderList(
      [
        makeSubmission({
          reviewCompleteness: {
            complete: false,
            missingFields: ["description"],
          },
        }),
      ],
      "ready",
    );

    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  });
});

const baseReviewData = {
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
  overrides: Partial<ReviewSubmission> = {},
): ReviewSubmission {
  const effectiveReviewData =
    overrides.reviewData ??
    (overrides.brandName
      ? { ...baseReviewData, name: overrides.brandName }
      : baseReviewData);

  return {
    id: "submission-1",
    brandId: null,
    brandName: "Test Brand",
    submitterEmail: "submitter@example.com",
    submitterName: null,
    description: "完整中文介紹",
    websiteUrl: "https://brand.example.com",
    heroImageUrl: "https://cdn.example.com/hero.webp",
    socialInstagram: null,
    socialThreads: null,
    socialFacebook: null,
    purchaseWebsite: "https://brand.example.com",
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
    reviewData: effectiveReviewData,
    reviewImages: [
      image("hero", "https://cdn.example.com/hero.webp", 0),
      image("detail", "https://cdn.example.com/detail.webp", 1),
    ],
    reviewCompleteness: { complete: true, missingFields: [] },
    moderationRiskLevel: "clean",
    brandSlug: null,
    ...overrides,
  };
}

function image(id: string, url: string, sortOrder: number) {
  return {
    id,
    submissionId: "submission-1",
    storagePath: `submissions/submission-1/${id}.webp`,
    url,
    source: "admin",
    status: "active" as const,
    sortOrder,
    altZh: null,
    altEn: null,
    width: 1200,
    height: 900,
  };
}

function renderList(submissions: ReviewSubmission[], initialTab: TabValue) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SubmissionsReviewList
        submissions={submissions}
        initialTab={initialTab}
      />
    </NextIntlClientProvider>,
  );
}
