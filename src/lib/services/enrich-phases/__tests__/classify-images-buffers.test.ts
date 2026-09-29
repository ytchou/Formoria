import { describe, expect, it } from "vitest";
import { classifyImageBuffers } from "../classify-images";
import type { GatedImage } from "../../image-download";

/**
 * `classifyImageBuffers` classifies in-memory buffers, skipping storage.
 * The property under test: vision data URIs are built from the held buffers
 * via `visionDataUri`, never via a storage download.
 */

describe("classifyImageBuffers", () => {
  it("encodes inline data URIs from buffers, not storage downloads", async () => {
    // Track what the vision client receives
    const receivedImages: string[] = [];

    const fakeClient = {
      chat: async (params: {
        images?: string[];
        [key: string]: unknown;
      }) => {
        if (params.images) receivedImages.push(...params.images);
        // Return a valid classification response for one image
        return {
          ok: true,
          content: JSON.stringify({
            classifications: [
              {
                id: "1",
                disposition: "keep",
                tag: "product",
                reasons: [],
                score: 85,
                caption: "A product photo",
              },
            ],
          }),
          status: 200,
          refusal: null,
        };
      },
    };

    const gatedImages: GatedImage[] = [
      {
        // A minimal valid webp-like buffer — visionDataUri will re-encode it
        buffer: Buffer.from(
          // 1x1 white PNG
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
          "base64",
        ),
        contentType: "image/webp",
        width: 600,
        height: 600,
        dominantColor: "#ffffff",
        phash: "0000000000000000",
        entropy: 6.0,
        sharpness: 10.0,
        source: "google_image",
        sourceUrl: "https://example.com/img.png",
        provider: { resolvedFetchUrl: "https://example.com/img.png" },
      },
    ];

    // The function should call visionDataUri(buffer) directly and NOT
    // loadVisionDataUri (which downloads from Supabase storage).
    // We verify by checking that the images sent to the client are
    // base64 data URIs (not fetched from storage).
    const results = await classifyImageBuffers(gatedImages, {
      brandContext: "Brand: Test. ",
      client: fakeClient as never,
    });

    // The client should have received base64 data URIs
    expect(receivedImages.length).toBeGreaterThan(0);
    for (const uri of receivedImages) {
      expect(uri).toMatch(/^data:image\/webp;base64,/);
    }

    // Results should carry buffer and verdict
    expect(results.length).toBe(1);
    expect(results[0].disposition).toBe("keep");
    expect(results[0].tag).toBe("product");
    expect(results[0].buffer).toBeInstanceOf(Buffer);
  });
});
