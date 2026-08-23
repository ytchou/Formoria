import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * `--nav-height` IS THE STICKY OFFSET FOR SIX ELEMENTS, AND IT DRIFTED.
 *
 * The brand section nav, the directory filter rail, the favorites loading
 * header, the brand wizard sidebar and the terms/faq/privacy asides all
 * park below the header with `top-(--nav-height)`. When row 1 grew from `h-14`
 * to `h-16` and a `min-h-12` category row was added, the token still read
 * 100px, so all six lost their top 13px under a z-50 bar — including the top
 * of a 44px tap target.
 *
 * The repair is structural: the two rows read their heights from
 * `--nav-row-primary` / `--nav-row-categories`, and `--nav-height` is a
 * `calc()` of those plus the hairline. This file is the guard on that repair —
 * it fails if a row goes back to a literal, or if the sum stops being derived.
 * A rendered-height assertion cannot do this job: jsdom has no layout, so it
 * would report 0 for both rows and pass forever.
 */
const read = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf-8");

describe("--nav-height", () => {
  it("is derived from the two header rows and the hairline, never typed", () => {
    const css = read("src/app/globals.css");

    expect(css).toMatch(/--nav-row-primary:\s*4rem;/);
    expect(css).toMatch(/--nav-row-categories:\s*3rem;/);
    expect(css).toMatch(/--nav-rule:\s*1px;/);

    // The whole point: no literal total. `calc()` of the three parts.
    const total = css.match(/--nav-height:\s*([^;]+);/);
    expect(total).not.toBeNull();
    const expression = total?.[1].replace(/\s+/g, " ").trim();
    expect(expression).toBe(
      "calc( var(--nav-row-primary) + var(--nav-row-categories) + var(--nav-rule) )",
    );
  });

  it("has row 1 reading `--nav-row-primary` rather than a literal height", () => {
    const source = read("src/components/navigation/main-nav.tsx");
    // ANCHORED TO THE ELEMENT, NOT TO A CLASS SUFFIX. Row 1 is a `PageShell`
    // now that the header shares the page measure, and the whole invariant sits
    // on ONE element: it is the page shell (`measure="page"` — same measure,
    // same gutter step as the content below it, which is the 160px seam this
    // ticket closed) AND it takes its height from `--nav-row-primary`. Matching
    // the opening tag keeps both halves of that together.
    //
    // An earlier revision matched only a class string ending `items-center
    // gap-6`. That is anchored to nothing: it takes the FIRST such string in
    // the file, so an element added above row 1 silently retargets the test,
    // and it requires a literal `className="…"`, so the day row 1 needs a
    // conditional and becomes `className={cn(...)}` the regex walks past it —
    // and a regex that matches nothing passes vacuously while the six sticky
    // elements go unguarded. It also stopped proving row 1 carries the shell.
    //
    // `(?:[^<>]|=>)` is "still inside this one tag" — it stops at the next
    // element boundary — and `(?<!=)>` is what makes the tag end the tag: a
    // lazy match would otherwise close on the `>` of an `onClick={() => …}`
    // and cut the class string off before the height token.
    //
    // A null match still FAILS here rather than skipping the two assertions
    // below, which is what keeps a reordered or deleted row loud. The height
    // token is asserted rather than matched, so a row that kept the shell and
    // lost the token fails on the token instead of on a null.
    const row = source.match(
      /<PageShell\b(?:[^<>]|=>)*?measure="page"(?:[^<>]|=>)*?(?<!=)>/,
    );

    expect(row).not.toBeNull();
    expect(row?.[0]).toContain("h-(--nav-row-primary)");
    expect(row?.[0]).not.toMatch(/\bh-\d/);
  });

  it("has row 2 reading `--nav-row-categories`, including its fallback", () => {
    const source = read("src/components/navigation/nav-category-tabs.tsx");
    const rows = source.match(/min-h-\(--nav-row-categories\)/g) ?? [];

    // The live row, one tab's tap target, and the Suspense fallback. If they
    // disagree, the header changes height while the row is still resolving, or
    // a tab taller than its row grows the header behind the token's back.
    expect(rows).toHaveLength(3);
    expect(source).not.toMatch(/\bmin-h-\d/);
  });

  it("keeps the header's bottom hairline, which `--nav-rule` accounts for", () => {
    const source = read("src/components/navigation/main-nav.tsx");
    expect(source).toContain('className="sticky top-0 z-50 border-b border-rule bg-ground"');
  });
});
