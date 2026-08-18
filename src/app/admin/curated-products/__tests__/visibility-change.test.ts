import { describe, expect, it } from "vitest";

import { planVisibilityChange } from "../visibility-change";

/**
 * The action itself cannot be unit-tested: it reads the stored row through
 * `@/lib/services/curated-products`, and `scripts/check-test-boundaries.mjs`
 * forbids mocking a service. This pins the decision the action delegates.
 */
describe("planVisibilityChange", () => {
  it("revalidates the brand path when a hidden product becomes visible", () => {
    // The regression: the action asked the PRE-update row whether to purge
    // /brands/[slug], so a publish purged nothing and the product stayed
    // missing from the brand page for the whole ISR window.
    expect(planVisibilityChange({ before: false, after: true })).toEqual({
      changed: true,
      isVisibleAfter: true,
      revalidateBrand: true,
    });
  });

  it("revalidates the brand path when a visible product is hidden", () => {
    // The mirror case: without the purge the brand page keeps rendering a
    // product an editor just withdrew.
    expect(planVisibilityChange({ before: true, after: false })).toEqual({
      changed: true,
      isVisibleAfter: false,
      revalidateBrand: true,
    });
  });

  it("still revalidates an ordinary edit to a visible product", () => {
    expect(planVisibilityChange({ before: true, after: undefined })).toEqual({
      changed: false,
      isVisibleAfter: true,
      revalidateBrand: true,
    });
  });

  it("leaves a hidden product's brand page alone when nothing was published", () => {
    expect(planVisibilityChange({ before: false, after: undefined })).toEqual({
      changed: false,
      isVisibleAfter: false,
      revalidateBrand: false,
    });
  });

  it("reports no transition when the posted value matches the stored one", () => {
    // Re-saving an already-visible product is an edit, not a publication
    // decision — auditing it would fill the log with non-decisions.
    expect(planVisibilityChange({ before: true, after: true }).changed).toBe(
      false,
    );
    expect(planVisibilityChange({ before: false, after: false }).changed).toBe(
      false,
    );
  });
});
