// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import zhMessages from "../../../../messages/zh-TW.json";
import type { StoryEntry } from "@/lib/services/stories";

vi.mock("@/components/ui/image", () => ({
  SurfaceImage: (props: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element -- test mock
    <img
      src={props.src as string}
      alt={(props.alt as string) || ""}
      data-testid="story-image"
    />
  ),
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/images/allowed-image-hosts", () => ({
  safeImageSrc: (url: string | null | undefined) => url ?? null,
}));

vi.mock("@/lib/analytics", () => ({
  trackStoryCardClicked: vi.fn(),
}));

const mockStory = {
  slug: "test-story",
  frontmatter: {
    title: "Test Story Title",
    description: "A short excerpt about Taiwanese craft.",
    heroImage: "/images/stories/test.webp",
    publishedAt: "2026-08-20",
    locale: "zh-TW",
    draft: false,
    tags: [],
    slug: "test-story",
    sources: [],
    faq: [],
  },
} as unknown as StoryEntry;

const mockStoryNoImage = {
  ...mockStory,
  frontmatter: {
    ...mockStory.frontmatter,
    heroImage: null,
  },
} as unknown as StoryEntry;

// The card reads `stories.tags.*` through `useTranslations`, so it needs the
// real message catalogue in context.
function renderWithIntl(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zhMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function withTags(tags: string[]): StoryEntry {
  return {
    ...mockStory,
    frontmatter: { ...mockStory.frontmatter, tags },
  } as unknown as StoryEntry;
}

describe("StoryCard", () => {
  it("renders image from frontmatter", async () => {
    const { StoryCard } = await import("../story-card");
    renderWithIntl(
      <StoryCard story={mockStory} locale="zh-TW" position={0} />,
    );

    const img = screen.getByTestId("story-image");
    expect(img).toHaveAttribute("src", "/images/stories/test.webp");
  });

  it("renders title and excerpt", async () => {
    const { StoryCard } = await import("../story-card");
    renderWithIntl(
      <StoryCard story={mockStory} locale="zh-TW" position={0} />,
    );

    expect(screen.getByText("Test Story Title")).toBeInTheDocument();
    expect(
      screen.getByText("A short excerpt about Taiwanese craft."),
    ).toBeInTheDocument();
  });

  it("shows fallback when no image", async () => {
    const { StoryCard } = await import("../story-card");
    const { container } = renderWithIntl(
      <StoryCard story={mockStoryNoImage} locale="zh-TW" position={0} />,
    );

    expect(screen.queryByTestId("story-image")).toBeNull();
    // A fallback bg element should exist
    const fallback = container.querySelector("[data-fallback]");
    expect(fallback).toBeInTheDocument();
  });

  // DEV-1963: the homepage printed the raw key ("EVENT" after CSS uppercase).
  it("renders the translated label for a known tag", async () => {
    const { StoryCard } = await import("../story-card");
    renderWithIntl(
      <StoryCard story={withTags(["event"])} locale="zh-TW" position={0} />,
    );

    expect(screen.getByText(/^展會 · /)).toBeInTheDocument();
    expect(screen.queryByText(/event/)).toBeNull();
  });

  it("omits a tag with no label and keeps the date", async () => {
    const { StoryCard } = await import("../story-card");
    const { container } = renderWithIntl(
      <StoryCard
        story={withTags(["not-a-known-tag"])}
        locale="zh-TW"
        position={0}
      />,
    );

    const eyebrow = container.querySelector(".type-eyebrow");
    expect(eyebrow?.textContent).not.toContain("not-a-known-tag");
    expect(eyebrow?.textContent).not.toContain(" · ");
    expect(eyebrow?.textContent).not.toBe("");
  });

  // DEV-1992: on /en the hub shows zh-TW stories; their title and excerpt must
  // be marked, while the eyebrow (page-locale tag + date) must not.
  it("marks title and excerpt with contentLang, never the eyebrow", async () => {
    const { StoryCard } = await import("../story-card");
    const { container } = renderWithIntl(
      <StoryCard
        story={mockStory}
        locale="en"
        position={0}
        contentLang="zh-Hant-TW"
      />,
    );

    expect(screen.getByRole("heading", { level: 3 })).toHaveAttribute(
      "lang",
      "zh-Hant-TW",
    );
    expect(
      screen.getByText("A short excerpt about Taiwanese craft."),
    ).toHaveAttribute("lang", "zh-Hant-TW");
    expect(container.querySelector(".type-eyebrow")).not.toHaveAttribute(
      "lang",
    );
  });

  it("sets no lang attribute without contentLang", async () => {
    const { StoryCard } = await import("../story-card");
    const { container } = renderWithIntl(
      <StoryCard story={mockStory} locale="zh-TW" position={0} />,
    );

    expect(container.querySelector("[lang]")).toBeNull();
  });
});
