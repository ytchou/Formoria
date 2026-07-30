import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { checkSoftRateLimit } from "@/lib/security/rate-limiter";

describe("soft rate limiting for internal router traffic", () => {
  it.each([
    ["a non-document response", { accept: "*/*" }, "198.51.100.42"],
    ["the surviving router URL", { "next-url": "/brands" }, "198.51.100.43"],
  ])(
    "does not challenge a user when Next.js identifies a prefetch through %s",
    async (_signal, routerHeaders, clientIp) => {
      let reachedLimit = false;
      for (let requestNumber = 0; requestNumber < 31; requestNumber += 1) {
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
});
