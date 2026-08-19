import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The editorial hero is the LCP element on both long-form routes, and nothing
 * else in the suite can see that: the pages are async server components that
 * read the filesystem and the database, so they cannot be rendered here, and
 * `priority` leaves no trace a DOM assertion could reach anyway.
 *
 * So this pins the DECISION at the source. It is deliberately narrow — the two
 * attributes that decide whether the largest paint is deferred, and the one
 * attribute that would defer it.
 */
const ROUTES = {
  story: join(
    process.cwd(),
    "src/app/[locale]/(site)/stories/[slug]/page.tsx",
  ),
  trail: join(
    process.cwd(),
    "src/app/[locale]/(site)/discover/[slug]/page.tsx",
  ),
} as const;

function heroBlock(source: string): string {
  // From the 16:9 hero box to the end of its conditional. Scoped so an
  // unrelated `priority` elsewhere on the page cannot satisfy the assertion.
  const start = source.indexOf("aspect-[16/9]");
  if (start === -1) throw new Error("no 16:9 hero box found in this route");
  return source.slice(start, start + 2000);
}

describe.each(Object.entries(ROUTES))(
  "%s detail hero is never deferred",
  (_name, path) => {
    const source = readFileSync(path, "utf8");
    const hero = heroBlock(source);

    it("marks the hero priority", () => {
      expect(hero).toContain("priority");
    });

    it("sets fetchPriority high", () => {
      expect(hero).toContain('fetchPriority="high"');
    });

    it("never lazy-loads it", () => {
      expect(hero).not.toContain('loading="lazy"');
    });

    it("frames it on the v2 rule, not a shadow", () => {
      expect(hero).toContain("border-rule");
      expect(hero).not.toContain("shadow-");
    });
  },
);
