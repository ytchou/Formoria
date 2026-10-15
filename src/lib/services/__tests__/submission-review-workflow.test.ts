import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  approveSubmissionWorkflow,
  rejectSubmissionWorkflow,
} from "@/lib/services/submission-review-workflow";
import type { Brand, BrandSubmission } from "@/lib/types";
import {
  isGeneratedGuestSubmissionEmail,
  type ApproveSubmissionResult,
} from "@/lib/services/submissions";

/*
 * Every collaborator is injected through the workflow's `steps` seam.
 * `vi.mock` of `@/lib/services/*` is banned by
 * scripts/check-test-boundaries.mjs; the seam is the same pattern
 * `hideBrandWithReason` uses.
 */

type ApprovalSteps = NonNullable<
  Parameters<typeof approveSubmissionWorkflow>[2]["steps"]
>;
type RejectionSteps = NonNullable<
  Parameters<typeof rejectSubmissionWorkflow>[4]["steps"]
>;

const SUBMISSION_ID = "8d0a7c55-0f7e-4c4e-9d0b-3f1d2a6b9e10";
const REVIEWER_ID = "0b1c2d3e-4f50-4a61-8b72-9c83d4e5f601";
const BRAND_ID = "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b";
const REAL_EMAIL = "maker@shop.tw";
const GUEST_EMAIL = "guest-123@guest.formoria.invalid";

function submissionFixture(
  overrides: Partial<BrandSubmission> = {},
): BrandSubmission {
  return {
    id: SUBMISSION_ID,
    intent: "new",
    brandName: "山茶工房",
    submitterEmail: REAL_EMAIL,
    ...overrides,
  } as BrandSubmission;
}

function brandFixture(overrides: Partial<Brand> = {}): Brand {
  return {
    id: BRAND_ID,
    slug: "shan-cha-studio",
    name: "山茶工房",
    status: "approved",
    heroImageUrl: "https://cdn.example.tw/hero.jpg",
    ...overrides,
  } as Brand;
}

const PRODUCT_REVIEW = {
  products: [],
  keptProductKeys: ["tea-set"],
} as ApproveSubmissionResult["productReview"];

/** A recorder plus fakes for every step, each logging its name on call. */
function harness(
  options: {
    submission?: BrandSubmission;
    brand?: Brand;
    approval?: Partial<ApproveSubmissionResult>;
    overrides?: Partial<ApprovalSteps & RejectionSteps>;
  } = {},
) {
  const calls: string[] = [];
  const materializeArgs: unknown[][] = [];
  const updateArgs: unknown[][] = [];
  const sentEmails: unknown[] = [];
  const builtEmails: string[] = [];
  const captured: unknown[] = [];

  const steps = {
    getSubmission: async () => {
      calls.push("getSubmission");
      return options.submission ?? submissionFixture();
    },
    approveSubmission: async () => {
      calls.push("approveSubmission");
      return {
        brandId: BRAND_ID,
        submitterEmail: REAL_EMAIL,
        brandName: "山茶工房",
        submitterName: null,
        isBrandOwner: false,
        productReview: PRODUCT_REVIEW,
        ...options.approval,
      } as ApproveSubmissionResult;
    },
    applyBrandRefresh: async () => {
      calls.push("applyBrandRefresh");
      return { brandId: BRAND_ID, cleanupFailed: false };
    },
    getBrandById: async () => {
      calls.push("getBrandById");
      return options.brand ?? brandFixture();
    },
    updateBrand: async (...args: unknown[]) => {
      calls.push("updateBrand");
      updateArgs.push(args);
      return { skipped: [] };
    },
    markFlagsReviewed: async () => {
      calls.push("markFlagsReviewed");
    },
    materializeSubmissionCuratedProducts: async (...args: unknown[]) => {
      calls.push("materialize");
      materializeArgs.push(args);
      return { created: 1, visible: 1, hidden: 0 };
    },
    syncBrandImages: async () => {
      calls.push("syncBrandImages");
      return { synced: 1, failed: 0 };
    },
    getBrandTrailSlugs: async () => {
      calls.push("getBrandTrailSlugs");
      return ["tea-gifts"];
    },
    buildApprovalEmail: async () => {
      builtEmails.push("approval");
      return { to: REAL_EMAIL, from: "a", subject: "s", html: "h" };
    },
    buildRejectionEmail: async () => {
      builtEmails.push("rejection");
      return { to: REAL_EMAIL, from: "a", subject: "s", html: "h" };
    },
    sendEmail: async (message: unknown) => {
      calls.push("sendEmail");
      sentEmails.push(message);
      return { success: true };
    },
    rejectSubmission: async () => {
      calls.push("rejectSubmission");
      return options.submission ?? submissionFixture();
    },
    getSiteUrl: () => "https://formoria.com",
    ...options.overrides,
  } as unknown as ApprovalSteps & RejectionSteps;

  const captureEvent = (event: unknown) => {
    calls.push("captureEvent");
    captured.push(event);
  };

  return {
    steps,
    captureEvent,
    calls,
    materializeArgs,
    updateArgs,
    sentEmails,
    builtEmails,
    captured,
  };
}

describe("approveSubmissionWorkflow — new brand", () => {
  it("runs RPC -> flags -> materialize -> images -> email -> telemetry, materializing the RPC's product review", async () => {
    const h = harness();

    const result = await approveSubmissionWorkflow(SUBMISSION_ID, REVIEWER_ID, {
      notify: "send",
      captureEvent: h.captureEvent,
      steps: h.steps,
    });

    expect(h.calls).toEqual([
      "getSubmission",
      "approveSubmission",
      "getBrandById",
      "markFlagsReviewed",
      "materialize",
      "syncBrandImages",
      "sendEmail",
      "captureEvent",
    ]);
    expect(h.materializeArgs).toEqual([
      [SUBMISSION_ID, BRAND_ID, { review: PRODUCT_REVIEW }],
    ]);
    expect(h.captured).toHaveLength(1);
    expect(result).toEqual({
      brandSlug: "shan-cha-studio",
      refresh: false,
      trailSlugs: [],
    });
  });

  it("never fails an approval that committed when materialization throws", async () => {
    const h = harness({
      overrides: {
        materializeSubmissionCuratedProducts: async () => {
          throw new Error("materialize exploded");
        },
      },
    });

    const result = await approveSubmissionWorkflow(SUBMISSION_ID, REVIEWER_ID, {
      notify: "send",
      captureEvent: h.captureEvent,
      steps: h.steps,
    });

    expect(result.brandSlug).toBe("shan-cha-studio");
    // Everything after the swallowed step still ran.
    expect(h.calls).toContain("syncBrandImages");
    expect(h.calls).toContain("captureEvent");
  });

  it("reports an image sync warning instead of failing", async () => {
    const h = harness({
      overrides: {
        syncBrandImages: async () => {
          throw new Error("storage down");
        },
      },
    });

    const result = await approveSubmissionWorkflow(SUBMISSION_ID, REVIEWER_ID, {
      notify: "send",
      captureEvent: h.captureEvent,
      steps: h.steps,
    });

    expect(result.imageSyncWarning).toEqual({ synced: 0, failed: 1 });
  });

  it("sends no email under notify 'skip' but still emits telemetry", async () => {
    const h = harness();

    await approveSubmissionWorkflow(SUBMISSION_ID, REVIEWER_ID, {
      notify: "skip",
      captureEvent: h.captureEvent,
      steps: h.steps,
    });

    expect(h.builtEmails).toEqual([]);
    expect(h.sentEmails).toEqual([]);
    expect(h.calls).toContain("materialize");
    expect(h.calls).toContain("captureEvent");
  });

  it("sends no email to a generated guest address under notify 'send'", async () => {
    // Guard the fixture: the generated-guest domain must be recognised, or this
    // test passes for the wrong reason.
    expect(isGeneratedGuestSubmissionEmail(GUEST_EMAIL)).toBe(true);
    const h = harness({ approval: { submitterEmail: GUEST_EMAIL } });

    await approveSubmissionWorkflow(SUBMISSION_ID, REVIEWER_ID, {
      notify: "send",
      captureEvent: h.captureEvent,
      steps: h.steps,
    });

    expect(h.builtEmails).toEqual([]);
    expect(h.sentEmails).toEqual([]);
  });
});

describe("approveSubmissionWorkflow — refresh", () => {
  it("unhides a hidden brand with hiddenReason cleared, materializes, and returns trail slugs read after materialize", async () => {
    const h = harness({
      submission: submissionFixture({ intent: "refresh" }),
      brand: brandFixture({ status: "hidden" }),
    });

    const result = await approveSubmissionWorkflow(SUBMISSION_ID, REVIEWER_ID, {
      notify: "send",
      captureEvent: h.captureEvent,
      steps: h.steps,
    });

    expect(h.updateArgs).toEqual([
      [BRAND_ID, { status: "approved", hiddenReason: null }],
    ]);
    expect(h.calls).toEqual([
      "getSubmission",
      "applyBrandRefresh",
      "getBrandById",
      "updateBrand",
      "materialize",
      "getBrandTrailSlugs",
    ]);
    expect(h.materializeArgs).toEqual([[SUBMISSION_ID, BRAND_ID, {}]]);
    expect(h.sentEmails).toEqual([]);
    expect(result).toEqual({
      brandSlug: "shan-cha-studio",
      refresh: true,
      trailSlugs: ["tea-gifts"],
    });
  });

  it("leaves a visible brand's status alone and treats a failed trail read as no trails", async () => {
    const h = harness({
      submission: submissionFixture({ intent: "refresh" }),
      overrides: {
        applyBrandRefresh: async () => ({ brandId: BRAND_ID, cleanupFailed: true }),
        getBrandTrailSlugs: async () => {
          throw new Error("schema lag");
        },
      },
    });

    const result = await approveSubmissionWorkflow(SUBMISSION_ID, REVIEWER_ID, {
      notify: "send",
      captureEvent: h.captureEvent,
      steps: h.steps,
    });

    expect(h.updateArgs).toEqual([]);
    expect(result).toEqual({
      brandSlug: "shan-cha-studio",
      refresh: true,
      trailSlugs: [],
      storageCleanupWarning: true,
    });
  });
});

describe("rejectSubmissionWorkflow", () => {
  it("commits the rejection and never builds or sends an email under notify 'skip'", async () => {
    const h = harness();

    await rejectSubmissionWorkflow(
      SUBMISSION_ID,
      REVIEWER_ID,
      "other",
      "not a brand",
      { notify: "skip", steps: h.steps },
    );

    expect(h.calls).toEqual(["getSubmission", "rejectSubmission"]);
    expect(h.builtEmails).toEqual([]);
    expect(h.sentEmails).toEqual([]);
  });

  it("never emails for a refresh-intent rejection under notify 'send'", async () => {
    const h = harness({ submission: submissionFixture({ intent: "refresh" }) });

    await rejectSubmissionWorkflow(SUBMISSION_ID, REVIEWER_ID, "other", "x", {
      notify: "send",
      steps: h.steps,
    });

    expect(h.builtEmails).toEqual([]);
    expect(h.sentEmails).toEqual([]);
  });

  it("emails a real submitter of a new-brand rejection under notify 'send'", async () => {
    const h = harness();

    await rejectSubmissionWorkflow(SUBMISSION_ID, REVIEWER_ID, "other", "x", {
      notify: "send",
      steps: h.steps,
    });

    expect(h.builtEmails).toEqual(["rejection"]);
    expect(h.sentEmails).toHaveLength(1);
  });
});

describe("one approval path for the admin UI and the operator script", () => {
  it("both callers import approveSubmissionWorkflow from the shared service", () => {
    const importPattern =
      /import\s*\{[^}]*\bapproveSubmissionWorkflow\b[^}]*\}\s*from\s*["']@\/lib\/services\/submission-review-workflow["']/;
    for (const file of [
      "src/app/admin/actions.ts",
      "scripts/enrichment/ops/approve-ready-submissions.ts",
    ]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source, file).toMatch(importPattern);
    }
  });
});
