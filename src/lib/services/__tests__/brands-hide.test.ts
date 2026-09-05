import { describe, it, expect } from "vitest";
import {
  BRAND_COLUMN_LIST,
  DIRECTORY_BRAND_COLUMN_LIST,
  hideBrandWithReason,
} from "@/lib/services/brands";
import type { Brand } from "@/lib/types";
import type { BrandWriteInput } from "@/lib/services/brands";
import type {
  BrandWriteActor,
  SkippedBrandField,
} from "@/lib/services/brand-write-policy";

/*
 * The collaborators are injected through `hideBrandWithReason`'s `deps` seam.
 * `vi.mock` of `@/lib/services/*` is banned by
 * scripts/check-test-boundaries.mjs, and the seam is the same pattern
 * `reviewCorrections` uses.
 */
function brandFixture(overrides: Partial<Brand> = {}): Brand {
  return {
    id: "brand-1",
    slug: "test-brand",
    status: "approved",
    ...overrides,
  } as Brand;
}

type UpdateCall = {
  id: string;
  data: BrandWriteInput;
  actor: BrandWriteActor;
};

function makeDeps(options: {
  brand: Brand;
  skipped?: SkippedBrandField[];
  calls: UpdateCall[];
}) {
  return {
    getBrandById: async () => options.brand,
    updateBrand: async (
      id: string,
      data: BrandWriteInput,
      actor: BrandWriteActor,
    ) => {
      options.calls.push({ id, data, actor });
      return { skipped: options.skipped ?? [] };
    },
  };
}

describe("hideBrandWithReason", () => {
  it("hide_brand_with_reason_sets_status_and_reason_when_approved", async () => {
    const calls: UpdateCall[] = [];
    const actor: BrandWriteActor = { source: "enriched", jobId: "job-1" };

    const result = await hideBrandWithReason(
      "brand-1",
      "no_purchase_channel",
      actor,
      makeDeps({ brand: brandFixture(), calls }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.id).toBe("brand-1");
    expect(calls[0]?.data).toEqual({
      status: "hidden",
      hiddenReason: "no_purchase_channel",
    });
    expect(calls[0]?.actor).toEqual({ source: "enriched", jobId: "job-1" });
    expect(result).toEqual({ ok: true, changed: true, slug: "test-brand" });
  });

  it("hide_brand_with_reason_preserves_existing_reason_when_already_hidden", async () => {
    const calls: UpdateCall[] = [];

    const result = await hideBrandWithReason(
      "brand-1",
      "no_purchase_channel",
      { source: "enriched", jobId: "job-1" },
      makeDeps({
        brand: brandFixture({
          status: "hidden",
          hiddenReason: "deferred_l1",
        }),
        calls,
      }),
    );

    expect(calls).toEqual([]);
    expect(result.changed).toBe(false);
    expect(result.ok).toBe(true);
  });

  it("hide_brand_with_reason_reports_failure_when_status_write_skipped", async () => {
    const calls: UpdateCall[] = [];

    const result = await hideBrandWithReason(
      "brand-1",
      "no_purchase_channel",
      { source: "enriched", jobId: "job-1" },
      makeDeps({
        brand: brandFixture(),
        skipped: [{ field: "status", reason: "protected:owner" }],
        calls,
      }),
    );

    expect(calls).toHaveLength(1);
    expect(result.ok).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.reason).toBe("status_write_skipped");
  });
});

describe("hidden_reason projection", () => {
  it("get_brand_by_id_projection_selects_hidden_reason", () => {
    // brandToDomain coerces a missing column to null, so a hidden brand read
    // through a projection without this column reports hiddenReason: null and
    // the domain object lies about why it left the directory.
    expect([...BRAND_COLUMN_LIST]).toContain("hidden_reason");
    expect(DIRECTORY_BRAND_COLUMN_LIST).not.toContain("hidden_reason");
  });
});
