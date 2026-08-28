// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { TrailEntry } from "@/lib/services/trails";
import { TrailTile } from "../trail-tile";

vi.mock("next/image", () => ({
  default: ({
    fill: _fill,
    priority: _priority,
    ...props
    // eslint-disable-next-line @next/next/no-img-element -- this is the next/image boundary
  }: Record<string, unknown>) => <img alt="" {...props} />,
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    prefetch: _prefetch,
    children,
    ...rest
  }: {
    href: string;
    prefetch?: boolean;
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

const labels = { eyebrow: "Style", cta: "Explore this style" };

function buildTrail(): TrailEntry {
  return {
    slug: "small-space-reading-corner",
    frontmatter: {
      title: "A reading corner for a small flat",
      slug: "small-space-reading-corner",
      tags: [],
      locale: "en",
      publishedAt: "2026-01-01",
      draft: false,
      heroImage: "/i/brands/t/hero.jpg",
      heroImageAlt: "A lamp beside a low chair",
      sources: [],
      faq: [],
      sections: [],
      relatedCategories: [],
      relatedStories: [],
      relatedTrails: [],
      promise: "Three objects that make a corner feel finished.",
    },
  };
}

function renderTile(trail = buildTrail()) {
  return render(
    <ul>
      <TrailTile trail={trail} labels={labels} position={0} singleColumn />
    </ul>,
  );
}

describe("TrailTile", () => {
  it("renders a repo-local hero path, which safeImageSrc now keeps", () => {
    const trail = buildTrail();
    trail.frontmatter.heroImage =
      "/images/trails/small-space-reading-corner.webp";

    const { container } = renderTile(trail);

    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "/images/trails/small-space-reading-corner.webp",
    );
  });

  it("drops a protocol-relative hero rather than fetching it offsite", () => {
    const trail = buildTrail();
    trail.frontmatter.heroImage = "//evil.example/hero.webp";

    const { container } = renderTile(trail);

    expect(container.querySelector("img")).toBeNull();
  });

  it("still renders a remote hero on an allowed host", () => {
    const { container } = renderTile();

    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "/i/brands/t/hero.jpg",
    );
  });

  it("falls back to an empty alt rather than repeating the title", () => {
    const trail = buildTrail();
    delete trail.frontmatter.heroImageAlt;

    const { container } = renderTile(trail);

    expect(container.querySelector("img")).toHaveAttribute("alt", "");
  });

  it("renders no image rather than a broken box when the hero is absent", () => {
    const trail = buildTrail();
    delete trail.frontmatter.heroImage;

    const { container } = renderTile(trail);

    expect(container.querySelector("img")).toBeNull();
  });

  it("renders the trail title as a level-3 heading", () => {
    renderTile();

    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "A reading corner for a small flat",
      }),
    ).toBeInTheDocument();
  });

  it("links to the trail and is labelled by its title", () => {
    renderTile();

    expect(
      screen.getByRole("link", { name: "A reading corner for a small flat" }),
    ).toHaveAttribute("href", "/style/small-space-reading-corner");
  });
});
