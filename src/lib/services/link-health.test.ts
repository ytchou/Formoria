import { describe, expect, it, vi } from "vitest";
import { checkUrl } from "./link-health";

describe("link health HTTP classification", () => {
  it.each([
    [200, "ok"],
    [301, "ok"],
    [403, "blocked"],
    [429, "blocked"],
    [404, "broken"],
    [410, "broken"],
    [500, "broken"],
  ] as const)(
    "classifies an HTTP %s response as %s",
    async (statusCode, status) => {
      const fetchBoundary = vi.fn().mockResolvedValue({ status: statusCode });

      await expect(
        checkUrl(
          "https://shop.mu-guang.tw/products/ceramic-cup",
          fetchBoundary,
        ),
      ).resolves.toEqual({ status, statusCode });
    },
  );

  it("returns broken when the network boundary fails", async () => {
    const fetchBoundary = vi
      .fn()
      .mockRejectedValue(new TypeError("connection failed"));

    await expect(
      checkUrl("https://shop.mu-guang.tw/products/ceramic-cup", fetchBoundary),
    ).resolves.toEqual({ status: "broken", statusCode: null });
  });

  it("retries a rejected HEAD method with GET", async () => {
    const fetchBoundary = vi
      .fn()
      .mockResolvedValueOnce({ status: 405 })
      .mockResolvedValueOnce({ status: 200 });

    await expect(
      checkUrl("https://shop.mu-guang.tw/products/ceramic-cup", fetchBoundary),
    ).resolves.toEqual({ status: "ok", statusCode: 200 });
    expect(fetchBoundary.mock.calls[1]?.[1]).toMatchObject({ method: "GET" });
  });
});
