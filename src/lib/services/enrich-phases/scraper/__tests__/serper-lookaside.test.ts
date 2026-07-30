import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { batchSearchBrandImages } from "../search";

const MEDIA_FILE = "581931847_1239863991503773_2473058864979530074_n.jpg";
const CROPPED = `https://scontent-tpe1-1.cdninstagram.com/v/t39.30808-6/${MEDIA_FILE}?stp=c160.0.480.480a_dst-jpg_e35_s640x640_tt6&_nc_cat=101`;
const UNCROPPED = `https://scontent-tpe1-1.cdninstagram.com/v/t39.30808-6/${MEDIA_FILE}?stp=dst-jpg_e35_tt6&_nc_cat=101`;
const AVATAR =
  "https://scontent-tpe1-1.cdninstagram.com/v/t51.2885-19/39902791_1500267353450836_4606187042949300224_n.jpg?stp=dst-jpg_s150x150_tt6";

function lookasideUrl(mediaId: string): string {
  return `https://lookaside.instagram.com/seo/google_widget/crawler/?media_id=${mediaId}`;
}

/** Mirrors the real crawler page: og:image is cropped, an uncropped twin sits alongside. */
function crawlerHtml(): string {
  return [
    "<html><head>",
    `<meta property="og:image" content="${CROPPED.replace(/&/g, "&amp;")}" />`,
    "</head><body>",
    `<img src="${UNCROPPED.replace(/&/g, "&amp;")}" />`,
    `<img src="${AVATAR}" />`,
    "</body></html>",
  ].join("");
}

function htmlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function serperResponse(images: Array<Record<string, unknown>>): Response {
  return new Response(JSON.stringify({ images }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function lookasideImage(mediaId: string): Record<string, unknown> {
  return {
    imageUrl: lookasideUrl(mediaId),
    imageWidth: 800,
    imageHeight: 800,
    title: `post ${mediaId}`,
    link: `https://www.instagram.com/p/${mediaId}/`,
  };
}

describe("lookaside image resolution", () => {
  beforeEach(() => {
    process.env.SERPER_API_KEY = "secret-api-key";
  });

  afterEach(() => {
    delete process.env.SERPER_API_KEY;
    vi.unstubAllGlobals();
  });

  it("resolves a lookaside url to the uncropped photo rather than the cropped og:image", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("serper.dev"))
          return serperResponse([lookasideImage("111")]);
        if (url.includes("lookaside.instagram.com"))
          return htmlResponse(crawlerHtml());
        throw new Error(`Unexpected fetch ${url}`);
      }),
    );

    const outcomes = await batchSearchBrandImages(["Yogasana"], 1);
    const rows = outcomes.get("Yogasana")?.rows ?? [];

    expect(rows).toHaveLength(1);
    expect(rows[0]?.url).toBe(UNCROPPED);
    // The cropped render and the unrelated avatar must not be selected.
    expect(rows[0]?.url).not.toBe(CROPPED);
    expect(rows[0]?.url).not.toBe(AVATAR);
  });

  it("drops the candidate when the crawler page cannot be fetched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("serper.dev"))
          return serperResponse([lookasideImage("222")]);
        if (url.includes("lookaside.instagram.com"))
          return new Response("nope", { status: 500 });
        throw new Error(`Unexpected fetch ${url}`);
      }),
    );

    const outcomes = await batchSearchBrandImages(["Yogasana"], 1);

    expect(outcomes.get("Yogasana")?.rows ?? []).toHaveLength(0);
  });

  it("drops the candidate when the page has no og:image", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("serper.dev"))
          return serperResponse([lookasideImage("333")]);
        if (url.includes("lookaside.instagram.com"))
          return htmlResponse("<html><head></head></html>");
        throw new Error(`Unexpected fetch ${url}`);
      }),
    );

    const outcomes = await batchSearchBrandImages(["Yogasana"], 1);

    expect(outcomes.get("Yogasana")?.rows ?? []).toHaveLength(0);
  });

  it("caps resolutions per brand so a long result list cannot fan out", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("serper.dev")) {
        return serperResponse(["1", "2", "3", "4", "5"].map(lookasideImage));
      }
      if (url.includes("lookaside.instagram.com"))
        return htmlResponse(crawlerHtml());
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const outcomes = await batchSearchBrandImages(["Yogasana"], 1);
    const rows = outcomes.get("Yogasana")?.rows ?? [];
    const resolutionCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("lookaside.instagram.com"),
    );

    // All five resolve to the same media file, so one row survives dedupe —
    // the point is that only three HTML fetches were ever spent.
    expect(resolutionCalls).toHaveLength(3);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("still keeps ordinary non-lookaside images untouched", async () => {
    const direct = "https://s.yimg.com/photo-640x480.jpg";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("serper.dev")) {
          return serperResponse([
            { imageUrl: direct, imageWidth: 640, imageHeight: 480 },
          ]);
        }
        throw new Error(`Unexpected fetch ${url}`);
      }),
    );

    const outcomes = await batchSearchBrandImages(["Yogasana"], 1);

    expect(outcomes.get("Yogasana")?.rows.map((row) => row.url)).toEqual([
      direct,
    ]);
  });
});
