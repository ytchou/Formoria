#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

export const frontendTokenRoots = ["src/app", "src/components"];

/**
 * Exported so a test can assert every entry still points at a file that exists.
 * An allowlist has no existence check of its own, which is why the entry for a
 * deleted microsite test sat here silently permitting two hexes in a file that
 * had not existed for months.
 */
export const allowedMatches = [
  {
    file: "src/components/auth/google-button.tsx",
    names: ["raw hex color literal"],
    values: ["#4285F4", "#34A853", "#FBBC04", "#EA4335"],
  },
  {
    // Ceiling: brand marks only — the LINE / Facebook / Instagram hexes exist so
    // each channel disc reads as that platform's own logo. Never extend this
    // entry to Formoria chrome (accent, surfaces, text). The `text-[13px]` value
    // is a separate typography escape, not a brand mark: it is the desktop-only
    // density of the read-only URL field, paired with a `text-base` mobile floor
    // so iOS Safari does not auto-zoom on focus.
    // The values moved out of `share-dialog.tsx` into the click-gated
    // `share-dialog-content.tsx` chunk; the shell now holds no literals.
    file: "src/components/brands/share-dialog-content.tsx",
    names: [
      "raw hex color class",
      "raw hex color literal",
      "arbitrary numeric text size",
      "direct text size",
    ],
    values: [
      "bg-[#06C755]",
      "#06C755",
      "bg-[#1877F2]",
      "#1877F2",
      "#FDF497",
      "#FD5949",
      "#D6249F",
      "#285AEB",
      "text-[13px]",
      "text-base",
    ],
  },
  {
    file: "src/components/brands/brand-links.tsx",
    names: ["raw hex color class", "raw hex color literal"],
    values: [
      "text-[#E1306C]",
      "#E1306C",
      "text-[#1877F2]",
      "#1877F2",
      "text-[#E05B6F]",
      "#E05B6F",
      "text-[#EE4D2D]",
      "#EE4D2D",
      "text-[#FF6600]",
      "#FF6600",
    ],
  },
  {
    // Per-brand accents are brand property, deliberately outside the palette
    // (DESIGN.md §2's one documented exception). These are arbitrary fixture
    // values standing in for whatever a brand actually picks — plus the system
    // accent, which appears here only in the assertion that it must NOT leak
    // into microsite output.
    file: "src/components/microsite/__tests__/registry.test.ts",
    names: ["raw hex color literal"],
    values: [
      "#123456",
      "#FFFFFF",
      "#000000",
      "#2F5D50",
      "#C4693B",
      "#FF00FF",
      "#2F4F63",
    ],
  },
  {
    file: "src/components/microsite/tokens.ts",
    names: ["raw hex color literal"],
    values: ["#FFFFFF"],
  },
  {
    file: "src/components/microsite/contact-cta.tsx",
    names: ["arbitrary numeric text size", "raw-type-combo"],
    values: ["text-[13px]", "text-sm font-semibold"],
  },
  {
    file: "src/components/microsite/hero.tsx",
    names: ["arbitrary numeric text size", "raw-type-combo"],
    values: ["text-[clamp(2.5rem,8vw,6rem)]", "text-sm font-semibold"],
  },
  {
    file: "src/components/microsite/product-grid.tsx",
    names: ["arbitrary numeric text size"],
    values: ["text-[13px]"],
  },
  {
    file: "src/components/ui/button.tsx",
    names: ["arbitrary numeric text size"],
    values: ["text-[0.8125rem]"],
  },
  {
    file: "src/components/brands/brand-image-fallback.tsx",
    names: ["direct text size", "raw-type-combo"],
    values: ["text-3xl", "text-5xl", "font-bold text-foreground"],
  },

  /**
   * Page-width escapes below this line. Every one of them is a COMPONENT's own
   * cap or a viewport clamp, never a page shell — none may be rewritten as
   * `page-measure` / `form-measure` / `prose-measure`, which is exactly why
   * they survive a check named for page widths. Ceiling: a row here is a
   * standing permission for one value in one file. A new page-scale width does
   * not belong here; it belongs in `PageShell`.
   */
  {
    // `max-w-[calc(100%-2rem)]` is a VIEWPORT CLAMP, not a size. It says "never
    // touch the screen edge" and carries whatever width the panel itself takes
    // (`sm:overlay-panel`, one class along). Naming it as a measure would
    // declare a width the dialog does not have. The value appears twice: once
    // in the comment that explains it, once in the class string — this guard
    // reads comments too.
    file: "src/components/ui/dialog.tsx",
    names: ["unnamed page width"],
    values: ["max-w-[calc(100%-2rem)]"],
  },
  {
    // Prose, not markup: the doc block above `PAGE_MEASURES` cites
    // `max-w-[64rem]` as the second declaration of a measure that the component
    // exists to prevent. The shell's own variants hold class names only.
    // Ceiling: this permits the literal inside the file that forbids it. If
    // `max-w-[64rem]` ever reaches real markup here, delete this row instead of
    // widening it.
    file: "src/components/ui/page-shell.tsx",
    names: ["unnamed page width"],
    values: ["max-w-[64rem]"],
  },
  {
    // The share panel's own width. `21rem` pairs with the `w-[21rem]` beside it
    // and falls between `overlay-compact` (20rem) and `overlay-panel` (24rem),
    // so no overlay name states it; the `calc` is the same viewport clamp as
    // `dialog.tsx`.
    file: "src/components/brands/share-dialog.tsx",
    names: ["unnamed page width"],
    values: ["max-w-[calc(100%-2rem)]", "max-w-[21rem]"],
  },
  {
    // The loaded half of the same share panel — same clamp, same reason.
    file: "src/components/brands/share-dialog-content.tsx",
    names: ["unnamed page width"],
    values: ["max-w-[calc(100%-2rem)]"],
  },
  {
    // The `!` prefix overrides `AlertDialogContent`'s built-in clamp with the
    // identical value so the `sm:!max-w-lg` step below it wins in order; it is
    // the same edge-gutter clamp, not a width.
    file: "src/components/submit/SubmitOverview.tsx",
    names: ["unnamed page width"],
    values: ["max-w-[calc(100%-2rem)]"],
  },
  {
    // The floor-map dialog is sized by the MAP's legibility, and needs a
    // viewport-relative cap that no fixed overlay name can express:
    // `overlay-wide` is a flat 72rem and would overflow a 1024px laptop.
    file: "src/components/events/taiwan-creative-expo-official-map.tsx",
    names: ["unnamed page width"],
    values: ["max-w-[min(96vw,1100px)]"],
  },
  {
    // Caps the donut GRAPHIC so it stays circular and legible inside a card of
    // any width. A drawing's size, not a text column's.
    file: "src/components/dashboard/analytics-donut-card.tsx",
    names: ["unnamed page width"],
    values: ["max-w-[280px]"],
  },
  {
    // An empty state's centred body column. Its near neighbour `content-column`
    // is 28rem/448px, so converting it is plausible but would move the rendered
    // width by 32px — a visual change, which is out of scope for a lint gate.
    file: "src/components/dashboard/dashboard-empty-state.tsx",
    names: ["unnamed page width"],
    values: ["max-w-[480px]"],
  },
  {
    // Table-cell truncation caps. They bound a `<td>` so a long brand name
    // ellipses instead of stretching its column — a cell width, which no page
    // measure and no overlay name describes.
    file: "src/components/admin/brand-list.tsx",
    names: ["unnamed page width"],
    values: ["max-w-[180px]"],
  },
  {
    // Table-cell truncation caps, as `brand-list.tsx`.
    file: "src/app/admin/submissions/submissions-review-list.tsx",
    names: ["unnamed page width"],
    values: ["max-w-[240px]", "max-w-[200px]"],
  },
  {
    // Table-cell truncation caps, as `brand-list.tsx`.
    file: "src/app/admin/curated-products/curated-products-list.tsx",
    names: ["unnamed page width"],
    values: ["max-w-[200px]", "max-w-[240px]"],
  },
  {
    // Caps a single numeric `<input>` (placement position) so a 3-digit field
    // does not stretch to the form's width. A control's size, not a page's.
    // Note for future sweeps: this file carries a literal NUL byte in a
    // `.join()` separator, so `rg` and `grep` classify it as binary and report
    // ZERO matches in all 1060 lines. Only a reader that does not sniff for
    // binary — this script, or Python — sees it.
    file: "src/app/admin/curated-products/curated-product-editor.tsx",
    names: ["unnamed page width"],
    values: ["max-w-[8rem]"],
  },
];

export const frontendTokenChecks = [
  {
    name: "raw hex color class",
    pattern: /(?:text|bg|border|stroke|fill)-\[#[0-9A-Fa-f]{3,8}\]/g,
  },
  {
    name: "raw hex color literal",
    pattern: /#[0-9A-Fa-f]{6}\b/g,
  },
  {
    name: "arbitrary numeric text size",
    pattern: /text-\[(?:\d|\d*\.)[^\]]+\]/g,
  },
  {
    name: "direct heading font",
    pattern: /font-heading|font-\[family-name:var\(--font-heading\)\]/g,
  },
  {
    name: "direct text size",
    pattern: /\btext-(?:xs|sm|base|lg|xl|[2-9]xl)\b/g,
  },
  {
    name: "raw-type-combo",
    pattern:
      /\btext-(xs|sm|base|lg|xl|[2-9]xl)\b.*\bfont-(medium|semibold|bold)\b|\bfont-(medium|semibold|bold)\b.*\btext-(xs|sm|base|lg|xl|[2-9]xl)\b/g,
  },
  {
    /**
     * PAGE-SCALE widths only. `max-w-5xl/6xl/7xl` (64/72/80rem), any
     * `max-w-screen-*`, and any arbitrary `max-w-[…]` are sizes a component
     * does not ask for — they are page shells, and the page has three named
     * measures. Ten unnamed caps accumulated one reasonable-looking call site
     * at a time and nothing noticed; this is what notices.
     *
     * DELIBERATELY NOT A BLANKET `max-w-*` BAN. `xs`…`4xl`, `none`, and `full`
     * stay legal: they are how a card, a button, or a table cell sizes itself,
     * and banning them would need ~38 allowlist rows — an allowlist that long
     * is the drift problem wearing a lint rule's hat.
     */
    name: "unnamed page width",
    pattern: /\bmax-w-(?:[5-7]xl\b|screen-[a-z0-9]+|\[[^\]]+\])/g,
  },
];

function isAllowedMatch(file, name, value) {
  return allowedMatches.some(
    (allowed) =>
      allowed.file === file &&
      allowed.names.includes(name) &&
      allowed.values.includes(value),
  );
}

function collectSourceFiles(cwd, root) {
  const absoluteRoot = join(cwd, root);
  if (!existsSync(absoluteRoot)) return [];

  const files = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    for (const entry of readdirSync(join(cwd, current), {
      withFileTypes: true,
    })) {
      if (entry.name === ".next" || entry.name === "node_modules") continue;

      const child = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(child);
        continue;
      }

      if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
        files.push(child);
      }
    }
  }

  return files.sort();
}

export function collectFrontendTokenFailures({
  cwd = process.cwd(),
  roots = frontendTokenRoots,
} = {}) {
  const files = roots.flatMap((root) => collectSourceFiles(cwd, root));

  const failures = [];

  for (const file of files) {
    const source = readFileSync(join(cwd, file), "utf8");
    const lines = source.split("\n");

    for (const check of frontendTokenChecks) {
      if (
        (check.name === "direct text size" ||
          check.name === "raw-type-combo") &&
        file.startsWith("src/components/ui/")
      )
        continue;
      for (const [index, line] of lines.entries()) {
        const matches = [...line.matchAll(check.pattern)].map(
          (match) => match[0],
        );
        if (!matches) continue;

        for (const value of matches) {
          if (isAllowedMatch(file, check.name, value)) continue;

          failures.push({
            file: relative(cwd, join(cwd, file)),
            line: index + 1,
            name: check.name,
            value,
          });
        }
      }
    }
  }

  return failures;
}

export function reportFrontendTokenFailures(failures) {
  if (failures.length > 0) {
    console.error("Frontend typography/token guard failed:");
    for (const failure of failures) {
      console.error(
        `${failure.file}:${failure.line} - ${failure.name}: ${failure.value}`,
      );
    }
    console.error(
      "Use semantic type-* utilities, Typography/textStyles variants, and design tokens. Add an allowlist only for real platform/brand-color exceptions.",
    );
    if (failures.some((failure) => failure.name === "unnamed page width")) {
      console.error(
        "For a page width use PageShell or shellStyles from src/components/ui/page-shell.tsx - page-measure (100rem), form-measure (64rem), prose-measure (48rem). For a component's own width use overlay-compact, overlay-panel, overlay-wide, or content-column. Allowlist a width only when it is neither: a viewport clamp, a graphic, or a table cell.",
      );
    }
    return 1;
  }

  console.log("Frontend typography/token guard passed.");
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = reportFrontendTokenFailures(
    collectFrontendTokenFailures(),
  );
}
