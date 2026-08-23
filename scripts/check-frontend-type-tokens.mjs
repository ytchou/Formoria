#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * `src/lib` is here because a page width escaped into it. The site's reading
 * width now lives on the block rules in `src/lib/mdx/components.ts` — the one
 * file that decides how wide every story and trail paragraph renders — and for
 * as long as the roots stopped at `src/app` and `src/components`, the single
 * most load-bearing width on the public site was the only one no guard saw.
 */
export const frontendTokenRoots = ["src/app", "src/components", "src/lib"];

/**
 * Exported so a test can assert every entry still points at a file that exists.
 * An allowlist has no existence check of its own, which is why the entry for
 * the microsite registry test (parked in DEV-1570) sat here silently
 * permitting two hexes in a file that had not existed for months.
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
    // `share-dialog-content.tsx` chunk; the shell now holds no literals. Its
    // WIDTH rows are gone: both halves name `size="compact"`, so neither file
    // spells a width at all and the only surviving width rows are `ui/dialog`'s
    // edge gutter and the floor map's viewport-relative cap.
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
    file: "src/components/ui/button.tsx",
    names: ["arbitrary numeric text size"],
    values: ["text-[0.8125rem]"],
  },
  {
    // The MDX code faces, sized RELATIVE to the prose around them. The inline
    // `text-[0.85em]` is em, not rem, so a `<code>` in a heading and one in
    // body copy each track the line they sit on — which no `type-*` role can
    // express, every one of the twelve being absolute. `text-[0.8125rem]` is
    // the code BLOCK, standing on its own at the same 13px step already
    // allowlisted for `ui/button.tsx`.
    file: "src/lib/mdx/components.ts",
    names: ["arbitrary numeric text size"],
    values: ["text-[0.85em]", "text-[0.8125rem]"],
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
    // Table-cell truncation caps, as `brand-list.tsx`. Each pairs with a
    // `<span className="block truncate">`, so the cap is what makes the
    // ellipsis happen — replacing it with a measure would restore the
    // row-stretching it exists to prevent.
    file: "src/components/admin/stockist-queue.tsx",
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
     * PAGE-SCALE widths only. `max-w-5xl/6xl/7xl` (64/72/80rem), `max-w-prose`,
     * any arbitrary `max-w-[…]`, any `max-w-(--var)` and any `max-w-screen-*`
     * are sizes a component does not ask for — they are page shells, and the
     * page has three named measures. Ten unnamed caps accumulated one
     * reasonable-looking call site at a time and nothing noticed; this is what
     * notices.
     *
     * `max-w-(--var)` IS THE FORM THIS BRANCH DELETED, and was the one form the
     * guard could not spell. Tailwind v4 writes `max-width: var(--x)` as
     * `max-w-(--x)`, which is exactly how `page-measure` resolved while it was
     * an overridable custom property. A guard blind to its own regression is
     * not a guard, so both the bare `(--x)` and the `(length:--x)` data-type
     * form match.
     *
     * `max-w-prose` IS NOT A COMPONENT SIZE. Tailwind's `--container-prose` is
     * 65ch — a reading width reached by a different route, which would sit
     * beside `prose-measure` (48rem) rendering a visibly different column with
     * nothing in either class saying which page it belongs to.
     *
     * `max-w-screen-*` DOES NOT EXIST IN v4, and the arm stays for exactly that
     * reason. It went with the v3 container scale, so the class emits no CSS
     * and the cap its author believed they wrote is simply absent — a layout
     * bug with no failing artefact anywhere. This is the one arm that fires on
     * a class Tailwind will not render, and it converts a v3 habit from an
     * invisible no-op into a lint failure.
     *
     * DELIBERATELY NOT A BLANKET `max-w-*` BAN. `xs`…`4xl`, `none`, and `full`
     * stay legal: they are how a card, a button, or a table cell sizes itself,
     * and banning them would need ~38 allowlist rows — an allowlist that long
     * is the drift problem wearing a lint rule's hat.
     */
    name: "unnamed page width",
    pattern:
      /\bmax-w-(?:[5-7]xl\b|prose\b|screen-[a-z0-9]+|\([^)]+\)|\[[^\]]+\])/g,
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

      // `src/lib` CARRIES NO STYLESHEET-BACKED MARKUP, so a bare hex there is
      // not a token leak — it is a palette copy for a renderer that cannot read
      // CSS. Satori (`next/og`) resolves inline styles and nothing else, mail
      // clients strip custom properties, and `runlog/render.ts` emits a
      // standalone internal HTML document whose palette is deliberately not
      // v2's. The first two are pinned to `globals.css` by real assertions —
      // `src/lib/brand/colors.test.ts` and
      // `src/lib/email/__tests__/v2-palette.test.tsx` — a stronger anchor than
      // an allowlist row, and one whose expected values ARE the hexes this
      // check would otherwise flag, so allowlisting them would mean listing the
      // palette twice to permit the file that already pins it.
      //
      // Ceiling: only the BARE literal is exempt. `bg-[#…]` and `text-[#…]` are
      // Tailwind markup and stay banned here as everywhere else, so rendered
      // chrome drifting into `src/lib` is still caught. If a stylesheet-backed
      // surface ever does move here, narrow this to the three renderer
      // directories rather than widening it.
      if (check.name === "raw hex color literal" && file.startsWith("src/lib/"))
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
