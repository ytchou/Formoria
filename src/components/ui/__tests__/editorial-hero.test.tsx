// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  EditorialHero,
  editorialHeroSrc,
} from "@/components/ui/editorial-hero";

// `next/image` becomes a plain `img`, exactly as every other image spec in this
// repo does it. `priority` and `fetchPriority` leave no trace on a real
// `next/image` render that a DOM assertion could reach, so the mock forwards
// them as data attributes: the point of the assertion is that the hero asks for
// them at all, not how Next spells them.
vi.mock("next/image", () => ({
  default: ({
    fill: _fill,
    priority,
    fetchPriority,
    ...props
  }: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element -- this IS the mock of next/image
    <img
      alt=""
      data-priority={priority ? "true" : "false"}
      data-fetch-priority={String(fetchPriority ?? "")}
      {...props}
    />
  ),
}));

const REPO_PATH = "/images/stories/2026-taiwan-creative-expo-craft-brands.webp";
const ALLOWED_REMOTE =
  "/i/brands/story/hero.webp";
// Any host outside `ALLOWED_IMAGE_HOSTS`. The CSP in `next.config.ts` is built
// from that same list, so a hero here is one the browser refuses to load.
const BLOCKED_REMOTE = "https://images.example.com/hero.jpg";

describe("editorialHeroSrc", () => {
  it("keeps a repo path, which the host gate would otherwise drop", () => {
    // `safeImageSrc` used to parse with NO base, so every relative path threw
    // inside it and blanked the only heroes that exist. It now recognises a
    // same-origin path directly (DEV-1551).
    expect(editorialHeroSrc(REPO_PATH)).toBe(REPO_PATH);
  });

  it("drops a protocol-relative hero, which is an offsite fetch", () => {
    // The old caller-side `startsWith("/")` branch returned this unchanged.
    expect(editorialHeroSrc("//evil.example/hero.jpg")).toBeNull();
  });

  it("keeps a remote hero the page is allowed to load", () => {
    expect(editorialHeroSrc(ALLOWED_REMOTE)).toBe(ALLOWED_REMOTE);
  });

  it("drops a hero the CSP would block", () => {
    expect(editorialHeroSrc(BLOCKED_REMOTE)).toBeNull();
  });

  it("drops an absent hero", () => {
    expect(editorialHeroSrc(null)).toBeNull();
    expect(editorialHeroSrc(undefined)).toBeNull();
    expect(editorialHeroSrc("")).toBeNull();
  });
});

describe("EditorialHero", () => {
  it("renders the frame and never defers the LCP element", () => {
    const { container } = render(
      <EditorialHero src={REPO_PATH} alt="A row of six Taiwanese crafts" />,
    );

    const image = screen.getByAltText("A row of six Taiwanese crafts");
    expect(image).toHaveAttribute("src", REPO_PATH);
    expect(image).toHaveAttribute("data-priority", "true");
    expect(image).toHaveAttribute("data-fetch-priority", "high");
    expect(image).not.toHaveAttribute("loading", "lazy");

    // v2 framing: a rule, never a shadow. The placeholder is `surface-deep` —
    // the trail's copy used `bg-surface`, which is the colour of the header band
    // it sits in, so its own empty state was invisible against its parent.
    const frame = container.firstElementChild;
    expect(frame?.className).toContain("border-rule");
    expect(frame?.className).toContain("bg-surface-deep");
    expect(frame?.className).not.toContain("shadow-");
  });

  it("renders nothing at all for an image the page cannot display", () => {
    // The imageless degradation path, not an empty bordered box. A blank 16:9
    // hole where the LCP element belongs is the failure this replaced.
    const { container } = render(<EditorialHero src={BLOCKED_REMOTE} alt="" />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there is no hero", () => {
    const { container } = render(<EditorialHero src={null} alt="" />);

    expect(container).toBeEmptyDOMElement();
  });

  it("carries the decorative empty alt through", () => {
    const { container } = render(
      <EditorialHero src={REPO_PATH} alt="" />,
    );

    expect(container.querySelector("img")).toHaveAttribute("alt", "");
  });

  it("takes the spacing its page owns", () => {
    const { container } = render(
      <EditorialHero src={REPO_PATH} alt="" className="mb-10" />,
    );

    expect(container.firstElementChild?.className).toContain("mb-10");
  });

  it("uses a route-specific image delivery contract when provided", () => {
    // The shared banner default describes the 100rem trail shell, while a
    // story renders the same component inside the much narrower prose shell.
    render(
      <EditorialHero
        src={REPO_PATH}
        alt=""
        sizes="(max-width: 768px) calc(100vw - 3rem), calc(768px - 5rem)"
        imageQuality={60}
      />,
    );

    const image = screen.getByRole("presentation");
    expect(image).toHaveAttribute(
      "sizes",
      "(max-width: 768px) calc(100vw - 3rem), calc(768px - 5rem)",
    );
    expect(image).toHaveAttribute("quality", "60");
  });
});

/**
 * Both long-form routes are async server components that read the filesystem
 * and the database, so they cannot be rendered here — but the copy this
 * component replaced lived in exactly those two files, and it drifted. So the
 * decision is pinned at the source: they call the component, and neither
 * hand-rolls the frame again.
 */
const ROUTES = {
  story: join(process.cwd(), "src/app/[locale]/(site)/stories/[slug]/page.tsx"),
  trail: join(process.cwd(), "src/app/[locale]/(site)/style/[slug]/page.tsx"),
} as const;

describe.each(Object.entries(ROUTES))(
  "%s detail opens with the shared hero",
  (_name, path) => {
    const source = readFileSync(path, "utf8");

    it("renders EditorialHero", () => {
      expect(source).toContain("<EditorialHero");
    });

    it("does not hand-roll a 16:9 hero box", () => {
      expect(source).not.toContain("aspect-[16/9]");
    });

    it("does not fall back to a raw img the CSP would blank", () => {
      expect(source).not.toContain("no-img-element");
    });
  },
);
