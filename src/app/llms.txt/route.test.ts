import { describe, expect, it } from "vitest";

import { GET } from "./route";
import { formatLlmsTxt } from "./llms-content";
import { buildAlternates } from "@/lib/seo/alternates";
import { VISIBLE_L1_CATEGORIES } from "@/lib/taxonomy/ontology";
import en from "../../../messages/en.json";
import zhTW from "../../../messages/zh-TW.json";

describe("GET /llms.txt", () => {
  it("publishes the current taxonomy and public reference surfaces as UTF-8 text", async () => {
    const response = await GET();
    const body = await response.text();

    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );

    for (const category of VISIBLE_L1_CATEGORIES) {
      expect(body).toContain(
        buildAlternates(
          `/brands?category=${category.slug}`,
          "zh-TW",
        ).canonical,
      );
      expect(body).toContain(category.nameZh);
    }

    for (const path of ["/faq", "/brands", "/stories", "/about"]) {
      expect(body).toContain(buildAlternates(path, "zh-TW").canonical);
    }
  });

  it("publishes a non-empty description for every visible category", async () => {
    const body = await (await GET()).text();

    // `formatLlmsTxt` *omits* a missing description rather than printing
    // "undefined", so a scan for a sentinel would pass while silently dropping
    // copy. Assert the description text is present instead.
    expect(VISIBLE_L1_CATEGORIES.length).toBeGreaterThan(0);

    for (const category of VISIBLE_L1_CATEGORIES) {
      const description =
        en.categories.descriptions[
          category.slug as keyof typeof en.categories.descriptions
        ] ??
        zhTW.categories.descriptions[
          category.slug as keyof typeof zhTW.categories.descriptions
        ];

      expect(description, `missing description for ${category.slug}`).toBeTruthy();
      expect(body).toContain(`(${category.nameZh}) — ${description}`);
    }
  });

  it("keeps a category URL when its optional description is missing", () => {
    const url = "https://formoria.com/brands?category=fashion";
    const body = formatLlmsTxt({
      links: [],
      categories: [{ name: "Fashion & Apparel", nameZh: "服飾鞋履", url }],
    });

    expect(body).toContain(`[Fashion & Apparel](${url})`);
  });

  it("states the approved mission without implying that Formoria processes purchases", async () => {
    const body = await (await GET()).text();

    expect(body).toContain(
      "Formoria reconnects the path after that moment",
    );
    expect(body).toContain("Brands or retailers remain responsible");
    expect(body).not.toContain("discover, choose, and grow");
  });
});
