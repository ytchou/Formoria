/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TrailEntry } from "@/lib/services/trails";

vi.mock("embla-carousel-react", () => ({
  default: () => [vi.fn(), null],
}));

vi.mock("@/components/ui/image", () => ({
  SurfaceImage: (props: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element -- mock
    <img alt={props.alt as string} data-testid="surface-image" />
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

vi.mock("@/lib/analytics", () => ({
  trackTrailCardClicked: vi.fn(),
}));

const { default: TrailCarousel } = await import("../trail-carousel");

const mockTrails = [
  {
    slug: "minimalist-living",
    frontmatter: {
      title: "Minimalist Living",
      promise: "A promise",
      heroImage: "/images/trail1.webp",
      description: "desc",
      slug: "minimalist-living",
      tags: [],
      locale: "zh-TW",
      publishedAt: "2026-01-01",
      draft: false,
      sources: [],
      faq: [],
      sections: [],
      relatedCategories: [],
      relatedStories: [],
      relatedTrails: [],
    },
  },
  {
    slug: "cozy-home",
    frontmatter: {
      title: "Cozy Home",
      promise: "Another promise",
      heroImage: "/images/trail2.webp",
      description: "desc2",
      slug: "cozy-home",
      tags: [],
      locale: "zh-TW",
      publishedAt: "2026-01-01",
      draft: false,
      sources: [],
      faq: [],
      sections: [],
      relatedCategories: [],
      relatedStories: [],
      relatedTrails: [],
    },
  },
  {
    slug: "outdoor-life",
    frontmatter: {
      title: "Outdoor Life",
      promise: "Third promise",
      heroImage: "/images/trail3.webp",
      description: "desc3",
      slug: "outdoor-life",
      tags: [],
      locale: "zh-TW",
      publishedAt: "2026-01-01",
      draft: false,
      sources: [],
      faq: [],
      sections: [],
      relatedCategories: [],
      relatedStories: [],
      relatedTrails: [],
    },
  },
] satisfies TrailEntry[];

const defaultLabels = { eyebrow: "探索路線", cta: "查看全部" };

describe("TrailCarousel", () => {
  it("renders a carousel region with the correct aria attributes", () => {
    render(<TrailCarousel trails={[...mockTrails]} labels={defaultLabels} />);

    const region = screen.getByRole("region");
    expect(region).toHaveAttribute("aria-roledescription", "carousel");
  });

  it("renders prev/next navigation buttons", () => {
    render(<TrailCarousel trails={[...mockTrails]} labels={defaultLabels} />);

    const buttons = screen.getAllByRole("button");
    const prevButton = buttons.find(
      (b) => b.getAttribute("aria-label")?.includes("上一") ?? false,
    );
    const nextButton = buttons.find(
      (b) => b.getAttribute("aria-label")?.includes("下一") ?? false,
    );

    expect(prevButton).toBeDefined();
    expect(nextButton).toBeDefined();
  });

  it("renders pagination dots matching the trail count", () => {
    const { container } = render(
      <TrailCarousel trails={[...mockTrails]} labels={defaultLabels} />,
    );

    const dots = container.querySelectorAll("[data-dot]");
    expect(dots).toHaveLength(3);
  });
});
