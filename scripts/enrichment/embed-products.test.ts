import { describe, expect, it } from "vitest";

import { shouldRefreshBrandCentroids } from "./data/embed-products";

describe("embedding backfill operator", () => {
  it("refreshes centroids after a successful applied product refresh", () => {
    expect(
      shouldRefreshBrandCentroids({ dryRun: false }, { failedBatches: [] }),
    ).toBe(true);
  });

  it("keeps dry runs read-only", () => {
    expect(
      shouldRefreshBrandCentroids({ dryRun: true }, { failedBatches: [] }),
    ).toBe(false);
  });

  it("does not refresh centroids after a failed product batch", () => {
    expect(
      shouldRefreshBrandCentroids(
        { dryRun: false },
        { failedBatches: ["embedding provider unavailable"] },
      ),
    ).toBe(false);
  });
});
