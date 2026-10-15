// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { trackStoryCardClicked } from "@/lib/analytics";

import zhMessages from "../../../../messages/zh-TW.json";
import type { StoryEntry } from "@/lib/services/stories";

vi.mock("@/components/ui/image", () => ({
  SurfaceImage: (props: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element -- test mock
    <img
      src={props.src as string}
      alt={(props.alt as string) || ""}
      className={props.className as string | undefined}
      data-surface={props.surface as string | undefined}
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
  // EL-05: one hover grammar across cards. The image scales on the settle
  // curve; the title turns accent (interaction colour, DESIGN §2) over 150ms.
  it("uses the shared media-hover recipe on the image and title", async () => {
    const { StoryCard } = await import("../story-card");
    renderWithIntl(
      <StoryCard story={mockStory} locale="zh-TW" position={0} />,
    );

    const image = screen.getByTestId("story-image");
    expect(image).toHaveClass(
      "transition-[scale]",
      "duration-300",
      "ease-(--ease-settle)",
      "motion-safe:group-hover:scale-[1.03]",
    );
    expect(image).not.toHaveClass("transition-transform");
    expect(screen.getByRole("heading", { level: 3 })).toHaveClass(
      "transition-colors",
      "duration-150",
      "ease-(--ease-settle)",
      "group-hover:text-accent",
      "group-active:text-accent",
    );
  });

  it("renders the default card at 4:3 with a card title", async () => {
    const { StoryCard } = await import("../story-card");
    renderWithIntl(
      <StoryCard story={mockStory} locale="zh-TW" position={0} />,
    );

    const frame = screen.getByTestId("story-image").parentElement;
    expect(frame).toHaveClass("aspect-[4/3]");
    expect(frame).not.toHaveClass("md:aspect-[21/9]");
    expect(screen.getByTestId("story-image")).toHaveAttribute(
      "data-surface",
      "tile",
    );
    expect(screen.getByRole("heading", { level: 3 })).toHaveClass(
      "type-card-title",
    );
  });

  // EL-14: the /stories hub leads with one full-width story.
  it("renders the feature variant full-width at 21:9 from md with a section title and lede", async () => {
    const { StoryCard } = await import("../story-card");
    renderWithIntl(
      <StoryCard
        story={mockStory}
        locale="zh-TW"
        position={0}
        trackingSurface="stories_hub"
        variant="feature"
      />,
    );

    const image = screen.getByTestId("story-image");
    expect(image.parentElement).toHaveClass("aspect-[4/3]", "md:aspect-[21/9]");
    // A full-width image within the page measure, not a grid cell.
    expect(image).toHaveAttribute("data-surface", "banner");

    // Same heading level as the grid cards, so the hub outline stays valid.
    const title = screen.getByRole("heading", { level: 3 });
    expect(title).toHaveClass("type-section");
    expect(title).not.toHaveClass("type-card-title");
    expect(
      screen.getByText("A short excerpt about Taiwanese craft."),
    ).toHaveClass("type-lede");

    // Tracking is unchanged by the variant.
    fireEvent.click(screen.getByRole("link"));
    expect(trackStoryCardClicked).toHaveBeenCalledWith(
      "test-story",
      0,
      "stories_hub",
    );
  });
});
