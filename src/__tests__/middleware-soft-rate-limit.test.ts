import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import {
  checkRateLimit,
  checkSoftRateLimit,
} from "@/lib/security/rate-limiter";

const configuredSoftLimit = Number(process.env.SOFT_LIMIT_BRANDS_PER_MIN);
const softLimitRequests =
  Number.isFinite(configuredSoftLimit) && configuredSoftLimit > 0
    ? configuredSoftLimit
    : 150;

describe("soft rate limiting for internal router traffic", () => {
  it.each([
    ["a non-document response", { accept: "*/*" }, "198.51.100.42"],
    ["the surviving router URL", { "next-url": "/brands" }, "198.51.100.43"],
  ])(
    "does not challenge a user when Next.js identifies a prefetch through %s",
    async (_signal, routerHeaders, clientIp) => {
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

      const response = await proxy(
        new NextRequest("https://formoria.com/brands/%E0%A4", {
          headers: {
            host: "formoria.com",
            "cf-connecting-ip": clientIp,
            ...routerHeaders,
          },
        }),
      );

      expect(response.status).toBe(404);
      expect(response.headers.get("location")).toBeNull();
    },
  );

  it("does not consume the hard document budget for router requests", async () => {
    const request = () =>
      new NextRequest("https://formoria.com/brands/maison-de-taiwan", {
        headers: {
          accept: "*/*",
          "cf-connecting-ip": "198.51.100.44",
        },
      });

    for (let requestNumber = 0; requestNumber < 201; requestNumber += 1) {
      expect(await checkRateLimit(request())).toBeNull();
    }
  });
});
