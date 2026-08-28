// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
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

describe("StoryCard", () => {
  it("renders image from frontmatter", async () => {
    const { StoryCard } = await import("../story-card");
    render(
      <StoryCard story={mockStory} locale="zh-TW" position={0} />,
    );

    const img = screen.getByTestId("story-image");
    expect(img).toHaveAttribute("src", "/images/stories/test.webp");
  });

  it("renders title and excerpt", async () => {
    const { StoryCard } = await import("../story-card");
    render(
      <StoryCard story={mockStory} locale="zh-TW" position={0} />,
    );

    expect(screen.getByText("Test Story Title")).toBeInTheDocument();
    expect(
      screen.getByText("A short excerpt about Taiwanese craft."),
    ).toBeInTheDocument();
  });

  it("shows fallback when no image", async () => {
    const { StoryCard } = await import("../story-card");
    const { container } = render(
      <StoryCard story={mockStoryNoImage} locale="zh-TW" position={0} />,
    );

    expect(screen.queryByTestId("story-image")).toBeNull();
    // A fallback bg element should exist
    const fallback = container.querySelector("[data-fallback]");
    expect(fallback).toBeInTheDocument();
  });
});
