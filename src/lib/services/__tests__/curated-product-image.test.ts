import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareCuratedProductImage } from "../curated-product-image";

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
