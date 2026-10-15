import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { editorialHeroSrc } from "@/components/ui/editorial-hero";

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

/**
 * Both long-form routes open with the shared `EditorialHeader`, which renders
 * whatever `editorialHeroSrc` resolved. The component's own rendering is
 * covered in `editorial-header.test.tsx`; this pins that neither route grows a
 * second, hand-rolled hero again.
 */
const ROUTES = {
  story: join(process.cwd(), "src/app/[locale]/(site)/stories/[slug]/page.tsx"),
  trail: join(process.cwd(), "src/app/[locale]/(site)/style/[slug]/page.tsx"),
} as const;

describe.each(Object.entries(ROUTES))(
  "%s detail opens with the shared header",
  (_name, path) => {
    const source = readFileSync(path, "utf8");

    it("renders EditorialHeader from the resolved hero", () => {
      expect(source).toContain("<EditorialHeader");
      expect(source).toContain("editorialHeroSrc(");
    });

    it("does not hand-roll a hero box", () => {
      expect(source).not.toContain("<SurfaceImage");
      expect(source).not.toContain("aspect-[");
    });

    it("does not fall back to a raw img the CSP would blank", () => {
      expect(source).not.toContain("no-img-element");
    });
  },
);
