// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { trackTrailCardClicked } from "@/lib/analytics";
import type { CuratedProduct } from "@/lib/services/curated-products";
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

const intl = vi.hoisted(() => ({ locale: "en" }));
vi.mock("next-intl", () => ({ useLocale: () => intl.locale }));

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

function buildPeekProduct(index: number): CuratedProduct {
  return {
    id: `product-${index}`,
    brandId: `brand-${index}`,
    key: `product-${index}`,
    nameZh: `商品 ${index}`,
    nameEn: null,
    category: "home",
    subcategory: null,
    officialUrl: "https://example.com/product",
    imageUrl: `/i/curated-products/p/${index}.jpg`,
    imageSourceUrl: null,
    visible: true,
    linkState: "ok",
    linkCheckedAt: null,
    sourceCheckedAt: null,
    reviewDueAt: null,
    productDescriptionZh: "描述",
    productDescriptionEn: null,
    productPosition: null,
    createdAt: "2026-01-01T00:00:00Z",
    trailSlug: "small-space-reading-corner",
    sectionKey: null,
    position: index,
    mitQualified: false,
  };
}

function renderTile(
  trail = buildTrail(),
  props: Partial<Parameters<typeof TrailTile>[0]> = {},
) {
  return render(
    <ul>
      <TrailTile
        trail={trail}
        labels={labels}
        position={0}
        trailSurface="homepage_trails"
        singleColumn
        {...props}
      />
    </ul>,
  );
}

function peekList(container: HTMLElement): HTMLUListElement | null {
  return container.querySelector<HTMLUListElement>(
    'ul[aria-hidden="true"]',
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

  it("renders up to 4 peek thumbnails with empty alt", () => {
    const peek = Array.from({ length: 5 }, (_, index) =>
      buildPeekProduct(index),
    );

    const { container } = renderTile(buildTrail(), { peek });

    const list = peekList(container);
    expect(list).not.toBeNull();
    const thumbnails = list!.querySelectorAll("img");
    expect(thumbnails).toHaveLength(4);
    for (const thumbnail of thumbnails) {
      expect(thumbnail).toHaveAttribute("alt", "");
    }
    // Thumbnails are decorative and never their own links: the card keeps one.
    expect(list!.querySelector("a")).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    // The peek sits outside the dark band but inside the same list item.
    const link = screen.getByRole("link");
    expect(link.contains(list)).toBe(false);
    expect(list!.closest("li")).toBe(link.closest("li"));
  });

  it("keeps an empty square for a peek product with no safe image, within the cap", () => {
    const peek = [
      { ...buildPeekProduct(0), imageUrl: null },
      { ...buildPeekProduct(1), imageUrl: "//evil.example/p.jpg" },
      ...Array.from({ length: 4 }, (_, index) => buildPeekProduct(index + 2)),
    ];

    const { container } = renderTile(buildTrail(), { peek });

    const list = peekList(container);
    expect(list).not.toBeNull();
    const items = list!.querySelectorAll(":scope > li");
    // The imageless products still take their slots, so the cap holds at 4.
    expect(items).toHaveLength(4);
    for (const item of [...items].slice(0, 2)) {
      expect(item.className).toContain("aspect-square");
      expect(item.querySelector("img")).toBeNull();
    }
    expect(list!.querySelectorAll("img")).toHaveLength(2);
  });

  it("renders no peek list when peek is empty or undefined", () => {
    const empty = renderTile(buildTrail(), { peek: [] });
    expect(empty.container.querySelectorAll("ul")).toHaveLength(1);
    empty.unmount();

    const missing = renderTile();
    expect(missing.container.querySelectorAll("ul")).toHaveLength(1);
  });

  it("tracks clicks with the given trailSurface", () => {
    renderTile(buildTrail(), { trailSurface: "style_hub", position: 2 });

    fireEvent.click(screen.getByRole("link"));

    expect(trackTrailCardClicked).toHaveBeenCalledWith(
      "small-space-reading-corner",
      2,
      "style_hub",
    );
  });

  it("uses the requested heading level", () => {
    renderTile(buildTrail(), { headingLevel: "h2" });

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "A reading corner for a small flat",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
  });

  it("keeps the scrim light at the top so the photograph shows", () => {
    const { container } = renderTile();

    const scrim = container.querySelector('a > span[aria-hidden="true"]');
    expect(scrim).not.toBeNull();
    expect(scrim!.className).toContain("from-ink/90");
    expect(scrim!.className).toContain("via-ink/55");
    expect(scrim!.className).toContain("via-35%");
    expect(scrim!.className).toContain("to-transparent");
  });

  describe("content language", () => {
    afterEach(() => {
      intl.locale = "en";
    });

    it("marks a zh-TW trail's copy zh-Hant-TW on an English page", () => {
      const trail = buildTrail();
      trail.frontmatter.locale = "zh-TW";
      intl.locale = "en";

      renderTile(trail);

      const heading = screen.getByRole("heading", { level: 3 });
      expect(heading.closest('[lang="zh-Hant-TW"]')).not.toBeNull();
      expect(
        screen
          .getByText("Three objects that make a corner feel finished.")
          .closest('[lang="zh-Hant-TW"]'),
      ).not.toBeNull();
    });

    it("sets no lang when the trail is in the page's language", () => {
      const trail = buildTrail();
      trail.frontmatter.locale = "zh-TW";
      intl.locale = "zh-TW";

      const { container } = renderTile(trail);

      expect(container.querySelector("[lang]")).toBeNull();
    });
  });
});
