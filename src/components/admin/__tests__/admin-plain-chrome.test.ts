import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { relative } from "node:path";

import {
  collectHeadings,
  collectSources,
  mingTitleRoleIn,
} from "@/test/source-scan";

/**
 * ADMIN IS DELIBERATELY PLAIN.
 *
 * The accent exists for interaction. Admin is nothing BUT interaction — every
 * screen is a queue, a table and a row of decisions — so filling its controls
 * with the accent paints the whole page one colour and destroys the signal the
 * accent carries everywhere else. Admin fills with ink instead
 * (`inkActionClassName`), and keeps the accent for links and focus rings.
 *
 * No monospace face ships in v2 either. Admin used to render one job identifier
 * in `font-mono`, the only consumer of a third webfont; field identifiers read
 * in 黑體 now. Bringing a mono back for admin alone is a decision to make in
 * `DESIGN.md` — not a class someone adds because a UUID looked ragged.
 *
 * And admin sits in the same 黑體 column as the dashboard in `DESIGN.md` §1
 * ("Tables, admin, dashboard chrome"), so its headings invert for the same
 * reason the dashboard's do.
 */
const ADMIN_ROOTS = ["src/app/admin", "src/components/admin"];

const FORBIDDEN = [
  {
    name: "monospace face",
    pattern: /\bfont-mono\b/,
    fix: "render field identifiers in 黑體 (`type-metadata` / `type-label`)",
  },
  {
    name: "accent fill",
    // The accent as a BACKGROUND. `text-accent`, `ring-accent` and
    // `border-accent` are deliberately absent: a link, a focus ring and an
    // active tab underline ARE interaction, which is what the accent is for.
    pattern: /\bbg-accent\b/,
    fix: "fill with ink — `buttonVariants({ variant: 'secondary', className: inkActionClassName })`",
  },
  {
    name: "accent-filled button",
    pattern: /variant=["']primary["']/,
    fix: 'use variant="secondary", plus `inkActionClassName` for the one primary action on the screen',
  },
] as const;

/** The opening `<Button …>` tag body, brace-aware so a `{…}` prop cannot end it early. */
function openingTag(source: string, from: number): string {
  let depth = 0;
  for (let i = from; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === ">" && depth === 0) return source.slice(from, i);
  }
  return source.slice(from);
}

/** The argument list of a `buttonVariants(…)` call. */
function callArguments(source: string, from: number): string {
  let depth = 1;
  for (let i = from; i < source.length; i += 1) {
    if (source[i] === "(") depth += 1;
    else if (source[i] === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(from, i);
    }
  }
  return source.slice(from);
}

const adminSources = ADMIN_ROOTS.flatMap(collectSources);

describe("admin chrome", () => {
  for (const rule of FORBIDDEN) {
    it(`renders no ${rule.name}`, () => {
      const offenders: string[] = [];

      for (const file of adminSources) {
        const source = readFileSync(file, "utf8");
        for (const [index, line] of source.split("\n").entries()) {
          if (rule.pattern.test(line)) {
            offenders.push(
              `${relative(process.cwd(), file)}:${index + 1} — ${rule.fix}`,
            );
          }
        }
      }

      expect(offenders).toEqual([]);
    });
  }

  it("names a variant on every admin button", () => {
    // The default variant IS the accent fill, so an omitted `variant` is an
    // accent fill that no grep for `primary` will ever find. Requiring the prop
    // is what makes the rule above enforceable rather than decorative.
    const offenders: string[] = [];

    for (const file of adminSources) {
      const source = readFileSync(file, "utf8");
      const lineAt = (index: number) => source.slice(0, index).split("\n").length;

      for (const match of source.matchAll(/<Button\b/g)) {
        const tag = openingTag(source, match.index + match[0].length);
        if (!tag.includes("variant=")) {
          offenders.push(
            `${relative(process.cwd(), file)}:${lineAt(match.index)} — <Button> without a variant`,
          );
        }
      }

      for (const match of source.matchAll(/buttonVariants\(/g)) {
        const args = callArguments(source, match.index + match[0].length);
        if (!args.includes("variant")) {
          offenders.push(
            `${relative(process.cwd(), file)}:${lineAt(match.index)} — buttonVariants() without a variant`,
          );
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("gives the ink action one height, set by its size variant", () => {
    // `inkActionClassName` is the ONE primary action on an admin screen, and
    // it shipped at two heights: five call sites wrapped it in
    // `cn("min-h-12", …)` and three did not, so the Save button in a detail
    // section stood 48px while the Approve button in the review queue stood
    // 44px — `min-h-12` silently wins over `size="default"`'s `h-11`, which
    // button.tsx calls "the height of every button". The height belongs to the
    // size variant. Nothing composed onto the ink fill may restate it.
    const offenders: string[] = [];

    for (const file of adminSources) {
      const source = readFileSync(file, "utf8");
      const lineAt = (index: number) => source.slice(0, index).split("\n").length;

      for (const match of source.matchAll(/\bcn\(/g)) {
        const args = callArguments(source, match.index + match[0].length);
        if (!args.includes("inkActionClassName")) continue;
        if (!/\b(min-)?h-\d/.test(args)) continue;

        offenders.push(
          `${relative(process.cwd(), file)}:${lineAt(match.index)} — a height ` +
            `class composed onto inkActionClassName. Pass \`size\` to the ` +
            `Button instead; the ink fill is a colour, not a size.`,
        );
      }
    }

    expect(offenders).toEqual([]);
  });

  it("sets every admin heading in 黑體, not 明體", () => {
    // The error boundary is exempt for the same reason the dashboard's
    // zero-state is: it is a page a person lands on with no shell above it,
    // not a panel inside the tool.
    const allowlist = ["src/app/admin/error.tsx"];

    const offenders = collectHeadings(adminSources)
      .filter((heading) => !allowlist.includes(heading.file))
      .map((heading) => ({ heading, role: mingTitleRoleIn(heading.attributes) }))
      .filter(({ role }) => role !== undefined)
      .map(({ heading, role }) => `${heading.file}:${heading.line} — ${role}`);

    expect(offenders).toEqual([]);
  });

  it("still scans the whole admin surface", () => {
    // If this collapses, every assertion above has stopped meaning anything
    // while still passing.
    expect(adminSources.length).toBeGreaterThan(50);
    expect(collectHeadings(adminSources).length).toBeGreaterThan(15);
  });
});
