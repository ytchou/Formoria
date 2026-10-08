import { describe, expect, it } from "vitest";

import type { StoryEntry } from "@/lib/services/stories";
import { toStoryCard } from "../story-card";

function story(overrides: Partial<StoryEntry["frontmatter"]> = {}): StoryEntry {
  return {
    slug: "expo-2026",
    frontmatter: {
      title: "走進 2026 文博會",
      description: "我們在展場遇到的品牌。",
      slug: "expo-2026",
      tags: ["event", "craft"],
      locale: "zh-TW",
      publishedAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      draft: false,
      series: "events",
      seriesTitle: "活動",
      seriesOrder: 1,
      author: "Formoria 編輯部",
      heroImage: "https://images.example.com/expo.webp",
      heroImageAlt: "展場入口",
      sources: ["https://example.com/source"],
      faq: [{ q: "在哪裡？", a: "松山文創園區。" }],
      brands: ["brand-a", "brand-b"],
      voiceCanonical: true,
      ...overrides,
    },
  };
}

describe("toStoryCard", () => {
  it("keeps exactly the fields a story card renders", () => {
    expect(toStoryCard(story())).toStrictEqual({
      slug: "expo-2026",
      frontmatter: {
        title: "走進 2026 文博會",
        description: "我們在展場遇到的品牌。",
        heroImage: "https://images.example.com/expo.webp",
        heroImageAlt: "展場入口",
        publishedAt: "2026-08-01T00:00:00.000Z",
        tags: ["event", "craft"],
      },
    });
  });

  it("drops faq, sources, brands, and editorial metadata", () => {
    const serialized = JSON.stringify(toStoryCard(story()));
    for (const heavy of [
      "faq",
      "sources",
      "brands",
      "voiceCanonical",
      "seriesTitle",
      "updatedAt",
      "松山文創園區",
    ]) {
      expect(serialized).not.toContain(heavy);
    }
  });

  it("omits optional fields that are undefined instead of emitting the key", () => {
    const card = toStoryCard(
      story({
        description: undefined,
        heroImage: undefined,
        heroImageAlt: undefined,
      }),
    );
    expect(card).toStrictEqual({
      slug: "expo-2026",
      frontmatter: {
        title: "走進 2026 文博會",
        publishedAt: "2026-08-01T00:00:00.000Z",
        tags: ["event", "craft"],
      },
    });
    expect("description" in card.frontmatter).toBe(false);
    expect("heroImage" in card.frontmatter).toBe(false);
    expect("heroImageAlt" in card.frontmatter).toBe(false);
  });
});
