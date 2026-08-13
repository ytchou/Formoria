import { describe, expect, it } from "vitest";
import {
  assertBrandPrerenderBudget,
  findBrandPrerenderRoutes,
} from "./check-brand-prerender-budget.mjs";

describe("brand prerender budget guard", () => {
  it("reports concrete brand detail routes in a realistic build manifest", () => {
    // Bug: a successful build could silently emit the entire brand corpus as ISR entries.
    const manifest = {
      routes: {
        "/brands/木子日青": {
          srcRoute: "/brands/[slug]",
          initialRevalidateSeconds: 3600,
        },
        "/en/brands/木子日青": {
          srcRoute: "/[locale]/brands/[slug]",
          initialRevalidateSeconds: 3600,
        },
        "/zh-TW/brands/river-stone": {
          srcRoute: "/[locale]/brands/[slug]",
          initialRevalidateSeconds: 3600,
        },
        "/en/brands": {
          srcRoute: "/[locale]/brands",
          initialRevalidateSeconds: 3600,
        },
      },
    };

    expect(findBrandPrerenderRoutes(manifest)).toEqual([
      "/brands/木子日青",
      "/en/brands/木子日青",
      "/zh-TW/brands/river-stone",
    ]);
    expect(() => assertBrandPrerenderBudget(manifest)).toThrow(
      "Brand detail prerender budget exceeded",
    );
    expect(
      assertBrandPrerenderBudget({
        routes: { "/en/brands": manifest.routes["/en/brands"] },
      }),
    ).toEqual([]);
  });
});
