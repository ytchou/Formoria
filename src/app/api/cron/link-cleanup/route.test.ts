import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Rejection paths only, deliberately.
 *
 * Every case below is answered by `isAuthorizedMachineCaller` or by body
 * validation BEFORE the route calls `cleanupDeadLinks`, so nothing here reaches
 * Supabase. The 200 path needs a live database, and
 * `scripts/check-test-boundaries.mjs` forbids mocking `@/lib/services/*` to
 * fake it; it is verified against staging with the migration that schedules
 * this route.
 *
 * The allow-list cases matter beyond input hygiene: the pg_cron job posts
 * `{"triggered_by":"pg_cron","run_at":now()::text}`, and the retired pg_cron
 * link-health job died on exactly that mismatch (see
 * `supabase/migrations/20260807120000_cron_http_dispatch_capture.sql`).
 */
import { POST } from "./route";

const url = "https://formoria.com/api/cron/link-cleanup";
const secret = "mch_2026_09_5b1d7c04e9a2f836b4c7d1e0";

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "x-origin-verify": secret,
      ...headers,
    },
    method: "POST",
  });
}

describe("POST /api/cron/link-cleanup", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects a request with no origin header", async () => {
    vi.stubEnv("ORIGIN_SECRET", secret);

    const response = await POST(new Request(url, { method: "POST" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("rejects a request with the wrong origin header", async () => {
    vi.stubEnv("ORIGIN_SECRET", secret);

    const response = await POST(
      post({}, { "x-origin-verify": "mch_2026_09_0e1d3b7a9c4f2685d0a3b8c1" }),
    );

    expect(response.status).toBe(401);
  });

  it("rejects when ORIGIN_SECRET is blank", async () => {
    // A blank server-side secret must never authorize a caller that also sends
    // a blank header.
    vi.stubEnv("ORIGIN_SECRET", "");

    const response = await POST(post({}, { "x-origin-verify": "" }));

    expect(response.status).toBe(401);
  });

  it("rejects a non-json content type", async () => {
    vi.stubEnv("ORIGIN_SECRET", secret);

    const response = await POST(post({}, { "content-type": "text/plain" }));

    expect(response.status).toBe(415);
  });

  it("rejects an unknown body key", async () => {
    vi.stubEnv("ORIGIN_SECRET", secret);

    const response = await POST(post({ dry_run: true, apply: true }));

    expect(response.status).toBe(400);
  });

  it("rejects a non-boolean dry_run", async () => {
    vi.stubEnv("ORIGIN_SECRET", secret);

    const response = await POST(post({ dry_run: "true" }));

    expect(response.status).toBe(400);
  });

  it("rejects a non-string triggered_by", async () => {
    vi.stubEnv("ORIGIN_SECRET", secret);

    const response = await POST(post({ dry_run: true, triggered_by: 7 }));

    expect(response.status).toBe(400);
  });
});
