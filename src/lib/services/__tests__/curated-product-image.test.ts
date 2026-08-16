import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  prepareCuratedProductImage,
  storeCuratedProductImage,
} from "../curated-product-image";
import {
  createCuratedProduct,
  updateCuratedProduct,
  type CuratedProductSupabase,
} from "../curated-products";

/**
 * The download half of curated-product image storage (DEV-1465).
 *
 * Only `prepareCuratedProductImage` is exercised: it is the half that talks to
 * the network and it writes nothing, so the guards can be tested with no
 * Supabase client and no storage bucket. `global.fetch` is stubbed rather than
 * the module mocked — `scripts/check-test-boundaries.mjs` forbids vi.mock of
 * `@/lib/services/`.
 */

const PRODUCT_ID = "6d5f1b0c-2a44-4f13-8c9e-5b7a1d3e9f20";
const BRAND_ID = "8f2c4a11-9d3e-4a26-b7f5-0c1e2d3a4b56";

/**
 * A real PNG, because `processImage` decodes with sharp: only genuine bytes can
 * prove the dimensions that reach the row are the POST-resize ones. 2400x1200
 * is deliberately over the 1200px processor cap, so the source and the stored
 * object cannot be confused for each other.
 */
async function sourceImage(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 210, g: 190, b: 170 },
    },
  })
    .png()
    .toBuffer();
}

type WritePayloads = { insert: Record<string, unknown>[]; update: Record<string, unknown>[] };

/**
 * Chainable stand-in passed as an argument, never a module mock:
 * `scripts/check-test-boundaries.mjs` forbids vi.mock of `@/lib/services/` and
 * `@/lib/supabase/`, and both writers take their client as a parameter for
 * exactly this reason. It records the payload; it does not evaluate filters.
 */
function stubWriteClient(): {
  client: CuratedProductSupabase;
  payloads: WritePayloads;
} {
  const payloads: WritePayloads = { insert: [], update: [] };
  const chain = {
    insert(payload: Record<string, unknown>) {
      payloads.insert.push(payload);
      return chain;
    },
    update(payload: Record<string, unknown>) {
      payloads.update.push(payload);
      return chain;
    },
    select() {
      return chain;
    },
    eq() {
      return chain;
    },
    async single() {
      return { data: { id: PRODUCT_ID, key: "pick" }, error: null };
    },
    then<TResult>(
      resolve: (value: { data: unknown; error: unknown }) => TResult,
      reject?: (reason: unknown) => TResult,
    ) {
      return Promise.resolve({ data: null, error: null }).then(resolve, reject);
    },
  };

  return {
    client: {
      from() {
        return chain;
      },
    } as unknown as CuratedProductSupabase,
    payloads,
  };
}

function stubFetch(response: Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** A body with no content-length, so only the streaming cap can stop it. */
function chunkedBody(totalBytes: number, chunkBytes = 64 * 1024): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(chunkBytes, totalBytes - sent);
      sent += size;
      controller.enqueue(new Uint8Array(size));
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("prepareCuratedProductImage", () => {
  it("refuses a private URL BEFORE any request is made", async () => {
    // The URL is typed into an admin form and fetched by the server, so without
    // this the action is a request forger against the deployment's own network.
    const fetchMock = stubFetch(new Response(new Uint8Array(0)));

    await expect(
      prepareCuratedProductImage("http://169.254.169.254/latest/meta-data/", PRODUCT_ID),
    ).rejects.toThrow(/not reachable/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a response whose content-type is not an allowed image", async () => {
    stubFetch(
      new Response("<html>login</html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );

    await expect(
      prepareCuratedProductImage("https://example.com/not-an-image", PRODUCT_ID),
    ).rejects.toThrow(/did not serve an image/i);
  });

  it("refuses a declared content-length over the processor's 5 MB cap", async () => {
    stubFetch(
      new Response(new Uint8Array(8), {
        status: 200,
        headers: {
          "content-type": "image/png",
          "content-length": String(6 * 1024 * 1024),
        },
      }),
    );

    await expect(
      prepareCuratedProductImage("https://example.com/huge.png", PRODUCT_ID),
    ).rejects.toThrow(/too large/i);
  });

  it("stops a chunked body at the cap instead of buffering it whole", async () => {
    // No content-length at all: the header check cannot fire, so the running
    // total is the only thing between a hostile origin and this process's heap.
    stubFetch(
      new Response(chunkedBody(6 * 1024 * 1024), {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );

    await expect(
      prepareCuratedProductImage("https://example.com/chunked.png", PRODUCT_ID),
    ).rejects.toThrow(/too large/i);
  });

  it("refuses a redirect that lands on a private address", async () => {
    // Redirects are followed by default, so checking the input URL says nothing
    // about where the bytes actually came from.
    const response = new Response(new Uint8Array(8), {
      status: 200,
      headers: { "content-type": "image/png" },
    });
    Object.defineProperty(response, "url", {
      value: "http://127.0.0.1:8000/secret.png",
    });
    stubFetch(response);

    await expect(
      prepareCuratedProductImage("https://example.com/redirects.png", PRODUCT_ID),
    ).rejects.toThrow(/unreachable/i);
  });
});

/**
 * Intrinsic dimensions on the write path (DEV-1479). The homepage wall renders
 * every tile at its native ratio, so the row has to carry the size of the
 * STORED object — the resized bytes are what a browser downloads.
 */
describe("storeCuratedProductImage dimensions", () => {
  it("returns intrinsic width and height alongside the stored url", async () => {
    stubFetch(
      new Response(new Uint8Array(await sourceImage(2400, 1200)), {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );

    const result = await storeCuratedProductImage(
      {
        brandId: BRAND_ID,
        productId: PRODUCT_ID,
        imageSourceUrl: "https://example.com/wide.png",
        previousImageUrl: null,
      },
      { upload: async () => ({ url: "https://cdn.example.com/stored.webp" }) },
    );

    // The processor caps at 1200px on the long edge, so 2400x1200 in must come
    // back out as 1200x600. Reporting the source dimensions would render every
    // over-cap tile at a ratio the stored object does not have.
    expect(result).toEqual({
      url: "https://cdn.example.com/stored.webp",
      width: 1200,
      height: 600,
    });
  });

  it("persists dimensions on create", async () => {
    const { client, payloads } = stubWriteClient();

    await createCuratedProduct(
      {
        brandId: BRAND_ID,
        nameZh: "Pick",
        l1: "home",
        imageUrl: "https://cdn.example.com/stored.webp",
        imageWidth: 1200,
        imageHeight: 600,
      },
      client,
    );

    expect(payloads.insert[0]).toMatchObject({
      image_width: 1200,
      image_height: 600,
    });
  });

  it("persists dimensions on update when the image changes", async () => {
    const { client, payloads } = stubWriteClient();

    await updateCuratedProduct(
      PRODUCT_ID,
      {
        imageUrl: "https://cdn.example.com/replacement.webp",
        imageWidth: 900,
        imageHeight: 1200,
      },
      client,
    );

    expect(payloads.update[0]).toMatchObject({
      image_url: "https://cdn.example.com/replacement.webp",
      image_width: 900,
      image_height: 1200,
    });
  });

  it("leaves dimensions untouched when no new image is supplied", async () => {
    const { client, payloads } = stubWriteClient();

    await updateCuratedProduct(PRODUCT_ID, { notesZh: "A typo fix" }, client);

    const payload = payloads.update[0] ?? {};
    expect(payload).toMatchObject({ notes_zh: "A typo fix" });
    // An absent key is the whole point: a payload carrying `image_width: null`
    // would null the measured size on every unrelated edit.
    expect(Object.keys(payload)).not.toContain("image_width");
    expect(Object.keys(payload)).not.toContain("image_height");
  });
});
