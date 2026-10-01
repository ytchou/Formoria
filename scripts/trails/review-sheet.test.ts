import { describe, expect, it } from "vitest";

import type { ShortlistCandidates } from "./lib";
import { renderReviewSheet } from "./review-sheet";

function sheet(): ShortlistCandidates {
  return {
    trail: "quiet-evening",
    target: "staging",
    projectRef: "abc123",
    generatedAt: "2026-10-01T00:00:00.000Z",
    sections: [
      {
        key: "light",
        title: "燈 & 光",
        query: "柔和的床頭燈",
        subcategories: ["lamps"],
        candidates: [
          {
            sectionKey: "light",
            rank: 1,
            productId: "p1",
            productKey: "lamp-a",
            brandSlug: "kiln",
            brandName: "Kiln",
            name: "<script>alert(1)</script>",
            subcategory: "lamps",
            imageUrl: "https://cdn.example.com/a.jpg",
            officialUrl: "https://kiln.example.com/a",
            note: '"><img src=x onerror=alert(2)>',
          },
          {
            sectionKey: "light",
            rank: 2,
            productId: "p2",
            productKey: "lamp-b",
            brandSlug: "niizo",
            brandName: "Niizo",
            name: "夜燈",
            subcategory: "lamps",
            imageUrl: "javascript:alert(3)",
            officialUrl: null,
          },
        ],
      },
    ],
  };
}

describe("renderReviewSheet", () => {
  it("renderReviewSheet escapes product names and notes", () => {
    const html = renderReviewSheet(sheet());

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&quot;&gt;&lt;img src=x onerror=alert(2)&gt;");
    expect(html).not.toContain("<img src=x");
    // Only http(s) URLs reach an attribute.
    expect(html).not.toContain("javascript:alert(3)");
    expect(html).toContain("燈 &amp; 光");
  });

  it("renderReviewSheet embeds the same-brand-per-section guard", () => {
    const html = renderReviewSheet(sheet());

    expect(html).toContain("function sameBrandPickedInSection(");
    expect(html).toContain('data-brand="kiln"');
    expect(html).toContain('data-brand="niizo"');
    expect(html.match(/data-brand="/g)).toHaveLength(2);
    expect(html).toContain('data-trail="quiet-evening"');
  });
});
