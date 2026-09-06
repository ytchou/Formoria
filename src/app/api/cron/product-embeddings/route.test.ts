import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const url = "https://formoria.com/api/cron/product-embeddings";
const secret = "mch_2026_09_embed_test_secret";

describe("POST /api/cron/product-embeddings", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects a request with no origin header", async () => {
    vi.stubEnv("ORIGIN_SECRET", secret);

    const response = await POST(new Request(url, { method: "POST" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("rejects the wrong origin header", async () => {
    vi.stubEnv("ORIGIN_SECRET", secret);

    const response = await POST(
      new Request(url, {
        method: "POST",
        headers: { "x-origin-verify": "wrong-secret" },
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("rejects when ORIGIN_SECRET is blank", async () => {
    vi.stubEnv("ORIGIN_SECRET", "");

    const response = await POST(
      new Request(url, {
        method: "POST",
        headers: { "x-origin-verify": "" },
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("rejects non-JSON content type", async () => {
    vi.stubEnv("ORIGIN_SECRET", secret);

    const response = await POST(
      new Request(url, {
        method: "POST",
        headers: {
          "x-origin-verify": secret,
          "content-type": "text/plain",
        },
        body: "not json",
      }),
    );

    expect(response.status).toBe(415);
  });

  it("rejects an unknown body key", async () => {
    vi.stubEnv("ORIGIN_SECRET", secret);

    const response = await POST(
      new Request(url, {
        method: "POST",
        headers: {
          "x-origin-verify": secret,
          "content-type": "application/json",
        },
        body: JSON.stringify({ unknown_key: true }),
      }),
    );

    expect(response.status).toBe(400);
  });
});
