import { describe, expect, it } from "vitest";

import { storyDocumentTitle } from "../[slug]/page";

// The `stories.titleInChinese` en message, as next-intl would format it.
const titleInChinese = (title: string) => `${title} (in Chinese)`;

describe("story document title", () => {
  // DS2-08: /en serves the zh-TW story, so the English tab title says so.
  it("marks a zh-TW story's title as Chinese when the content language differs", () => {
    expect(storyDocumentTitle("文博會攻略", "zh-Hant-TW", titleInChinese)).toBe(
      "文博會攻略 (in Chinese)",
    );
  });

  it("keeps the bare title when the story is in the page's language", () => {
    expect(storyDocumentTitle("文博會攻略", undefined, titleInChinese)).toBe(
      "文博會攻略",
    );
  });
});
