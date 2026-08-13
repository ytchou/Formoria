import { describe, expect, it } from "vitest";

import { GET } from "./route";
import { formatLlmsTxt } from "./llms-content";
import { buildAlternates } from "@/lib/seo/alternates";
import { PRODUCT_TYPE_CATEGORIES } from "@/lib/taxonomy/ontology";

describe("GET /llms.txt", () => {
  it("publishes the current taxonomy and public reference surfaces as UTF-8 text", async () => {
    const response = await GET();
    const body = await response.text();

    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );

    for (const category of PRODUCT_TYPE_CATEGORIES) {
      expect(body).toContain(
        buildAlternates(
          `/categories/${category.slug}`,
          "zh-TW",
        ).canonical,
      );
      expect(body).toContain(category.nameZh);
    }

    for (const path of ["/events", "/faq"]) {
      expect(body).toContain(buildAlternates(path, "zh-TW").canonical);
    }

    for (const path of ["/brands", "/stories", "/about"]) {
      expect(body).toContain(buildAlternates(path, "zh-TW").canonical);
    }
  });

  it("keeps a category URL when its optional description is missing", () => {
    const url = "https://formoria.com/categories/fashion";
    const body = formatLlmsTxt({
      links: [],
      categories: [{ name: "Fashion & Apparel", nameZh: "服飾鞋履", url }],
    });

    expect(body).toContain(`[Fashion & Apparel](${url})`);
  });

  it("states the approved mission without implying that Formoria processes purchases", async () => {
    const body = await (await GET()).text();

    expect(body).toContain(
      "Formoria reconnects the broken path from inspiration to purchase",
    );
    expect(body).toContain("Brands or retailers remain responsible");
    expect(body).not.toContain("discover, choose, and grow");
  });
});
