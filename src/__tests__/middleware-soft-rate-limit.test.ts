import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import {
  checkRateLimit,
  checkSoftRateLimit,
} from "@/lib/security/rate-limiter";

// DEV-1551 reverses the DEV-1269 fix that these cases used to encode.
//
// DEV-1269 added `accept === '*/*'` to `isRouterRequest`, treating it as a
// router signal in its own right. That gave any client sending
// `Accept: */*` -- one curl flag -- a permanent exemption from BOTH the hard
// document budget and the Turnstile challenge.
//
// The reversal is safe because of the capture recorded in
// docs/evidence/2026-08-22-router-headers.md: across 28 requests to `/brands*`
// from a real browser journey, ZERO carried `accept: */*` without also
// carrying at least one of `RSC` / `next-url` / `next-router-prefetch` /
// `next-action`. Genuine router traffic is still exempt through those four
// signals; only the bare-client bypass is gone. The `next-url` rows below are
// the regression guard for that -- they must keep asserting NO challenge.
const configuredSoftLimit = Number(process.env.SOFT_LIMIT_BRANDS_PER_MIN);
const softLimitRequests =
  Number.isFinite(configuredSoftLimit) && configuredSoftLimit > 0
    ? configuredSoftLimit
    : 150;

async function exhaustSoftLimit(clientIp: string): Promise<void> {
  let reachedLimit = false;
  for (
    let requestNumber = 0;
    requestNumber <= softLimitRequests;
    requestNumber += 1
  ) {
    reachedLimit = await checkSoftRateLimit(
      new NextRequest("https://formoria.com/brands/maison-de-taiwan", {
        headers: { "cf-connecting-ip": clientIp },
      }),
    );
  }
  expect(reachedLimit).toBe(true);
}

describe("soft rate limiting for internal router traffic", () => {
  it("does not challenge a user when Next.js identifies a prefetch through the surviving router URL", async () => {
    const clientIp = "198.51.100.43";
    await exhaustSoftLimit(clientIp);

    const response = await proxy(
      new NextRequest("https://formoria.com/brands/%E0%A4", {
        headers: {
          host: "formoria.com",
          "cf-connecting-ip": clientIp,
          "next-url": "/brands",
        },
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
  });

  it("checkSoftRateLimit challenges a bare curl", async () => {
    const clientIp = "198.51.100.45";
    await exhaustSoftLimit(clientIp);

    // `accept: */*` and nothing else -- exactly what curl sends by default.
    // Before DEV-1551 `isRouterRequest` read this as a prefetch, so `proxy()`
    // skipped the soft-limit branch entirely and no challenge was ever issued.
    const response = await proxy(
      new NextRequest("https://formoria.com/brands/%E0%A4", {
        headers: {
          host: "formoria.com",
          "cf-connecting-ip": clientIp,
          accept: "*/*",
        },
      }),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/challenge");
  });

  it("checkRateLimit consumes the document budget for a bare curl", async () => {
    const request = () =>
      new NextRequest("https://formoria.com/brands/maison-de-taiwan", {
        headers: {
          accept: "*/*",
          "cf-connecting-ip": "198.51.100.44",
        },
      });

    let blocked: Response | null = null;
    for (let requestNumber = 0; requestNumber < 201; requestNumber += 1) {
      blocked = await checkRateLimit(request());
      if (blocked) break;
    }

    // Non-null: the budget was consumed and eventually exhausted. Before
    // DEV-1551 all 201 returned null because the request looked like a router
    // prefetch.
    expect(blocked).not.toBeNull();
    expect(blocked?.status).toBe(429);
  });
});
