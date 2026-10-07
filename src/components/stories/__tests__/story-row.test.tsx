// @vitest-environment jsdom
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import enMessages from "../../../../messages/en.json";
import type { StoryEntry } from "@/lib/services/stories";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/lib/analytics", () => ({
  trackStoryCardClicked: vi.fn(),
  trackTrailCardClicked: vi.fn(),
}));

import { StoryRow } from "../story-row";

const story = {
  slug: "expo-guide",
  frontmatter: {
    title: "Expo Guide Title",
    description: "Expo guide description.",
    slug: "expo-guide",
    tags: [],
    locale: "zh-TW",
    publishedAt: "2026-08-20",
    draft: false,
  },
} as unknown as StoryEntry;

describe("StoryRow", () => {
  // DEV-1963: /en lists zh-TW stories. The "In Chinese" badge is English text,
  // so it must sit outside the element that declares zh-TW.
  it("marks the foreign title, not the page-locale badge", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <StoryRow story={story} locale="en" headingLevel={2} />
      </NextIntlClientProvider>,
    );

    const title = screen.getByText("Expo Guide Title");
    expect(title).toHaveAttribute("lang", "zh-TW");

    const badge = screen.getByText("In Chinese");
    expect(badge.closest('[lang="zh-TW"]')).toBeNull();
    expect(screen.getByRole("heading", { level: 2 })).not.toHaveAttribute(
      "lang",
    );
  });

  it("adds no lang attribute when the story matches the page locale", () => {
    render(
      <NextIntlClientProvider locale="zh-TW" messages={enMessages}>
        <StoryRow story={story} locale="zh-TW" headingLevel={2} />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText("Expo Guide Title")).not.toHaveAttribute("lang");
    expect(screen.queryByText("In Chinese")).toBeNull();
  });
});
