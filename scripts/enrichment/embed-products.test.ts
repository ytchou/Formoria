import { describe, expect, it } from "vitest";

import { runEmbeddingBackfill } from "./data/embed-products";

const productResult = {
  stale: 2,
  embedded: 2,
  deleted: 0,
  failedBatches: [] as string[],
};

const centroidResult = { updated: 1, deleted: 0, skipped: 3 };

describe("embedding backfill operator", () => {
  it("refreshes brand centroids after an applied product refresh succeeds", async () => {
    const steps: string[] = [];

    const result = await runEmbeddingBackfill(
      { all: false, limit: 25, dryRun: false },
      {
        refreshProducts: async () => {
          steps.push("products");
          return productResult;
        },
        refreshCentroids: async () => {
          steps.push("centroids");
          return centroidResult;
        },
      },
    );

    expect(steps).toEqual(["products", "centroids"]);
    expect(result).toEqual({ products: productResult, centroids: centroidResult });
  });

  it("keeps a dry run read-only by skipping centroid refresh", async () => {
    const steps: string[] = [];

    const result = await runEmbeddingBackfill(
      { all: false, limit: 25, dryRun: true },
      {
        refreshProducts: async () => {
          steps.push("products");
          return { ...productResult, embedded: 0 };
        },
        refreshCentroids: async () => {
          steps.push("centroids");
          return centroidResult;
        },
      },
    );

    expect(steps).toEqual(["products"]);
    expect(result.centroids).toBeNull();
  });

  it("skips centroid refresh when a product batch fails", async () => {
    const steps: string[] = [];
    const failedProducts = {
      ...productResult,
      embedded: 0,
      failedBatches: ["embedding provider unavailable"],
    };

    const result = await runEmbeddingBackfill(
      { all: true, limit: 25, dryRun: false },
      {
        refreshProducts: async () => {
          steps.push("products");
          return failedProducts;
        },
        refreshCentroids: async () => {
          steps.push("centroids");
          return centroidResult;
        },
      },
    );

    expect(steps).toEqual(["products"]);
    expect(result).toEqual({ products: failedProducts, centroids: null });
  });

  it("fails the applied workflow when centroid refresh fails", async () => {
    await expect(
      runEmbeddingBackfill(
        { all: false, limit: 25, dryRun: false },
        {
          refreshProducts: async () => productResult,
          refreshCentroids: async () => {
            throw new Error("centroid write failed");
          },
        },
      ),
    ).rejects.toThrow("centroid write failed");
  });
});
