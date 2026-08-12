import { beforeEach, describe, expect, it, vi } from "vitest";

const { revalidatePath, revalidateTag } = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath, revalidateTag }));

import { POST } from "./route";
import { PUBLIC_BRAND_DATA_TAG } from "@/lib/cache/public-brand-cache";

const url = "https://formoria.com/api/internal/revalidate-brands";
const secret = "mch_2026_08_7f4c3b29a1e6d8f0c2b5a9e4";

function request(body: unknown, authorized = true): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorized ? { "x-origin-verify": secret } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/internal/revalidate-brands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ORIGIN_SECRET", secret);
  });

  it("bounds a 200-brand batch to one shared tag and 609 path invalidations", async () => {
    const slugs = Array.from({ length: 200 }, (_, index) => `brand-${index}`);

    const response = await POST(request({ slugs }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revalidated: 200 });
    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(revalidateTag).toHaveBeenCalledWith(PUBLIC_BRAND_DATA_TAG, "max");
    expect(revalidatePath).toHaveBeenCalledTimes(609);

    expect(revalidatePath).toHaveBeenCalledWith(
      "/[locale]/events/[slug]",
      "page",
    );
    expect(revalidatePath).toHaveBeenCalledWith(
      "/[locale]/stories/[slug]",
      "page",
    );
    expect(revalidatePath).toHaveBeenCalledWith("/sitemap.xml");
    expect(revalidatePath).toHaveBeenCalledWith("/zh-TW");
    expect(revalidatePath).toHaveBeenCalledWith("/en");
    expect(revalidatePath).toHaveBeenCalledWith("/zh-TW/about");
    expect(revalidatePath).toHaveBeenCalledWith("/en/about");
    expect(revalidatePath).toHaveBeenCalledWith("/zh-TW/events");
    expect(revalidatePath).toHaveBeenCalledWith("/en/events");
    expect(revalidatePath).toHaveBeenCalledWith("/site/brand-0");
    expect(revalidatePath).toHaveBeenCalledWith("/zh-TW/brands/brand-0");
    expect(revalidatePath).toHaveBeenCalledWith("/en/brands/brand-0");

    expect(
      revalidatePath.mock.calls.some(([path]) => path === "/zh-TW/brands"),
    ).toBe(false);
    expect(
      revalidatePath.mock.calls.some(
        ([path]) => typeof path === "string" && path.startsWith("/categories/"),
      ),
    ).toBe(false);
  });

  it("deduplicates brand slugs before invalidating entity pages", async () => {
    const response = await POST(
      request({ slugs: ["niizo", " niizo ", "kiln"] }),
    );

    expect(response.status).toBe(200);
    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(
      revalidatePath.mock.calls.filter(([path]) =>
        ["/zh-TW/brands/niizo", "/en/brands/niizo", "/site/niizo"].includes(
          path as string,
        ),
      ),
    ).toHaveLength(3);
  });

  it("returns 401 without invoking any cache operation", async () => {
    const response = await POST(request({ slugs: ["niizo"] }, false));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("revalidates the event hub and sitemap once for an empty event list", async () => {
    const response = await POST(request({ events: [] }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revalidated: 0 });
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledTimes(3);
    expect(revalidatePath).toHaveBeenCalledWith("/zh-TW/events");
    expect(revalidatePath).toHaveBeenCalledWith("/en/events");
    expect(revalidatePath).toHaveBeenCalledWith("/sitemap.xml");
  });
});
