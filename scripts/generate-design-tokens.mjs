#!/usr/bin/env node
/**
 * D19 — DESIGN.md token tables are generated from globals.css, never hand-written.
 *
 * The v1 design system drifted until it documented button heights, badge radii, a
 * destructive style, a dark mode and a font policy that none of them shipped. Every
 * one of those was a hand-maintained number in a markdown file. This script removes
 * the class of failure: the values in DESIGN.md come from the stylesheet or they do
 * not exist.
 *
 * It carries a second contract of the same shape for the three PAGE MEASURES,
 * which are `@utility` rules rather than custom properties and are duplicated
 * into TypeScript because `next/image` `sizes` cannot read CSS — see MEASURES
 * below.
 *
 *   pnpm design:tokens          rewrite the generated block in DESIGN.md
 *   pnpm check:design-tokens    exit 1 if globals.css is missing a v2 token or
 *                               a page measure, if a measure disagrees with
 *                               MEASURE_PX, or (where DESIGN.md exists) if the
 *                               block is stale
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const CSS = join(ROOT, "src/app/globals.css");
const PX = join(ROOT, "src/lib/constants/layout.ts");
const DOC = join(ROOT, "docs/designs/ux/DESIGN.md");
const BEGIN = "<!-- BEGIN GENERATED TOKENS -->";
const END = "<!-- END GENERATED TOKENS -->";

/**
 * Roles are documentation, not values — they explain what a token is *for*.
 *
 * This list is a CONTRACT with `src/app/globals.css`: every name here must be
 * declared there or the script refuses to write anything (see REQUIRED below).
 * It was unsatisfiable when first committed — it demanded `paper-white`, which
 * v2 never adopted, and omitted the four tokens the ink-ground and form-error
 * ramps need. Reconciled to the exact 17-token v2 set on 2026-08-20 (DEV-1514).
 */
const ROLES = {
  ground: "page background",
  surface: "bands, cards, inset blocks",
  "surface-deep": "third step; image placeholder",
  ink: "primary text",
  "ink-soft": "body prose",
  "ink-muted": "metadata, secondary",
  rule: "hairlines, borders",
  accent: "interaction only",
  "on-ink": "text on ink grounds",
  "on-ink-muted": "secondary text on ink grounds",
  "rule-on-ink": "hairline on ink grounds; non-text only",
  danger: "form errors",
  "font-ming": "content face",
  "font-hei": "interface face",
  "space-section": "between page sections",
  "space-stack": "between blocks in a section",
  "space-gutter": "grid column gap",
};

const GROUPS = [
  ["Colour", (n) => !n.startsWith("font-") && !n.startsWith("space-")],
  ["Typography", (n) => n.startsWith("font-")],
  ["Spacing", (n) => n.startsWith("space-")],
];

function parseTokens(css) {
  // Custom properties declared in :root or @theme blocks.
  const out = new Map();
  for (const m of css.matchAll(/^\s*--([a-z0-9-]+)\s*:\s*([^;]+);/gim)) {
    const [, name, raw] = m;
    if (!(name in ROLES)) continue; // only tokens the doc claims to own
    out.set(name, raw.trim());
  }
  return out;
}

/**
 * THE SAME CONTRACT, FOR THE THREE PAGE MEASURES.
 *
 * Kept as its own map rather than folded into ROLES, for two reasons. The
 * measures are `@utility` rules, not `--custom-properties`, so `parseTokens`
 * cannot see them at all. And `:root` separately declares a property literally
 * named `--page-measure` holding a DIFFERENT value — the footer's overridable
 * default — so one map covering both would quietly match the wrong declaration
 * and document a width the utility does not ship.
 *
 * `px` names the key in `MEASURE_PX` that must agree with the rem literal. The
 * two copies exist because `next/image` `sizes` hints are static strings and
 * cannot read CSS; the point of this check is that the second copy can never
 * drift from the first in silence.
 */
const MEASURES = {
  "page-measure": {
    px: "page",
    role: "discovery and chrome: directory, landing, header, footer",
    /**
     * PENDING, and only this exact string. `page-measure` still resolves
     * through the footer's overridable `--page-measure`; it becomes the 100rem
     * literal when the call sites are converted. Any other non-literal — a
     * different `var()`, a `min()`, a wrong number — fails now. When the
     * literal lands, the rem branch below binds on its own and this line is
     * deleted with no other change to the script.
     */
    pending: "var(--page-measure)",
  },
  "form-measure": {
    px: "form",
    role: "a page whose content is a form",
  },
  "prose-measure": {
    px: "prose",
    role: "a reading page, or a reading column inside a wider one",
  },
};

/** The root size every `rem` in globals.css is relative to. */
const ROOT_PX = 16;

function parseMeasures(css) {
  // `@utility <name> { max-width: … }` — a rule, not a custom property. The
  // max-width must be the block's first declaration, which is what makes this
  // skip `page-shell` (a cap behind an `@apply`) rather than mis-read it.
  const out = new Map();
  for (const m of css.matchAll(
    /@utility\s+([a-z0-9-]+)\s*\{\s*max-width:\s*([^;]+);/gi,
  )) {
    const [, name, raw] = m;
    if (!(name in MEASURES)) continue; // `header-measure` is not one of the three
    out.set(name, raw.trim());
  }
  return out;
}

/**
 * `MEASURE_PX` read as TEXT, not imported. This is an `.mjs` script running as
 * the first link of the `pnpm lint` chain, and standing up a TypeScript loader
 * there to read three integers costs more than it buys. Regex, like the CSS.
 */
function parseMeasurePx(ts) {
  const out = new Map();
  const block = ts.match(/export const MEASURE_PX\s*=\s*\{([^}]*)\}/);
  if (!block) return out;
  for (const m of block[1].matchAll(/([a-z]+)\s*:\s*(\d+)/gi)) {
    out.set(m[1], Number(m[2]));
  }
  return out;
}

/** `48rem` -> 768. Anything that is not a bare rem literal -> null. */
function remToPx(value) {
  const m = /^(\d+(?:\.\d+)?)rem$/.exec(value);
  return m ? Number(m[1]) * ROOT_PX : null;
}

/** Every disagreement between the CSS, `MEASURE_PX` and MEASURES above. */
function checkMeasures(declared, px) {
  const problems = [];
  for (const [name, spec] of Object.entries(MEASURES)) {
    const value = declared.get(name);
    if (value === undefined) {
      problems.push(`${name}: no \`@utility ${name}\` with a max-width in globals.css`);
      continue;
    }

    const want = px.get(spec.px);
    if (want === undefined) {
      problems.push(`${name}: MEASURE_PX.${spec.px} is missing from layout.ts`);
      continue;
    }

    const got = remToPx(value);
    if (got === null) {
      if (value === spec.pending) continue; // the one documented interim state
      problems.push(
        `${name}: declared \`${value}\`, which is not a rem literal` +
          (spec.pending ? ` and not the accepted interim \`${spec.pending}\`` : ""),
      );
      continue;
    }

    if (got !== want) {
      problems.push(
        `${name}: globals.css says \`${value}\` (${got}px), MEASURE_PX.${spec.px} says ${want}`,
      );
    }
  }
  return problems;
}

function srgb(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const h = hex.replace("#", "");
  if (h.length !== 6) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
}

function contrast(a, b) {
  const [la, lb] = [luminance(a), luminance(b)];
  if (la == null || lb == null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function render(tokens, measures) {
  const lines = [
    "> Generated by `pnpm design:tokens` from `src/app/globals.css`. Do not hand-edit.",
    "",
  ];

  for (const [heading, match] of GROUPS) {
    const rows = [...tokens].filter(([n]) => match(n));
    if (!rows.length) continue;
    lines.push(
      `### ${heading}`,
      "",
      "| Token | Value | Role |",
      "|---|---|---|",
    );
    for (const [name, value] of rows) {
      lines.push(`| \`--${name}\` | \`${value}\` | ${ROLES[name]} |`);
    }
    lines.push("");
  }

  // Its own table because it is its own contract, and because a row named
  // `--page-measure` sitting in the colour table above would be a different
  // declaration with a different value.
  if (measures.size) {
    lines.push(
      "### Measure",
      "",
      "| Utility | CSS | px | Role |",
      "|---|---|---|---|",
    );
    for (const [name, spec] of Object.entries(MEASURES)) {
      const value = measures.get(name);
      if (value === undefined) continue;
      // px derived from the CSS, NEVER from MEASURE_PX. A measure still holding
      // its interim `var()` must not be documented at a number it has not
      // adopted — that is the exact failure this file was written to end.
      const px = remToPx(value);
      lines.push(
        `| \`${name}\` | \`${value}\` | ${px === null ? "—" : `${px}px`} | ${spec.role} |`,
      );
    }
    lines.push("");
  }

  // Contrast is derived, so it can never disagree with the palette above.
  const ground = tokens.get("ground");
  const surface = tokens.get("surface");
  const inks = ["ink", "ink-soft", "ink-muted", "accent"];
  if (ground?.startsWith("#") && surface?.startsWith("#")) {
    lines.push(
      "### Contrast (derived)",
      "",
      "Small text needs 4.5:1. The accent is interaction-only and therefore almost",
      "always small text, so 4.5:1 is its binding floor.",
      "",
      "| Token | on ground | on surface |",
      "|---|---|---|",
    );
    for (const name of inks) {
      const v = tokens.get(name);
      if (!v?.startsWith("#")) continue;
      const g = contrast(v, ground);
      const s = contrast(v, surface);
      const flag = (r) =>
        r >= 4.5 ? r.toFixed(2) : `**${r.toFixed(2)} FAIL**`;
      lines.push(`| \`--${name}\` | ${flag(g)} | ${flag(s)} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

const css = readFileSync(CSS, "utf8");
const tokens = parseTokens(css);
const measures = parseMeasures(css);
const check = process.argv.includes("--check");

if (!existsSync(PX)) {
  console.error(
    `design:tokens — ${PX} not found.\n` +
      `The page measures are declared in globals.css and mirrored in pixels in\n` +
      `that file, and the mirror is checked against the stylesheet on every lint.\n` +
      `Unlike DESIGN.md it is committed, so its absence is a broken tree.`,
  );
  process.exit(1);
}

/**
 * A PARTIAL match is more dangerous than no match. When this script first ran against
 * the pre-overhaul stylesheet it matched exactly one name — `--accent`, which existed
 * in v1 with an unrelated meaning (dark ink for nav and footer) — and wrote that wrong
 * value into DESIGN.md with full confidence. That is precisely the silent drift v2
 * exists to prevent, so the generator refuses to emit anything unless the whole v2
 * token set is present.
 */
const REQUIRED = Object.keys(ROLES);
const missing = REQUIRED.filter((n) => !tokens.has(n));

if (missing.length) {
  console.error(
    `design:tokens — refusing to generate: ${missing.length} of ${REQUIRED.length} ` +
      `v2 tokens are absent from globals.css.\n` +
      `  missing: ${missing.join(", ")}\n` +
      `\nEither the system-layer change has not landed yet (expected before the\n` +
      `redesign branch merges), or a token was renamed without updating ROLES here.\n` +
      `A partial table would state wrong values confidently, so nothing is written.`,
  );
  process.exit(1);
}

/**
 * The measures fail for a different reason than the tokens, so they say so
 * separately. A token goes missing when the stylesheet is edited; a measure
 * goes wrong when ONE OF TWO COPIES of the same number is edited — the rem
 * literal in globals.css or the pixel mirror in layout.ts — and the message
 * has to name both so the reader knows there is a second place to look.
 */
const measureProblems = checkMeasures(measures, parseMeasurePx(readFileSync(PX, "utf8")));

if (measureProblems.length) {
  console.error(
    `design:tokens — refusing to generate: the page measures do not agree.\n` +
      measureProblems.map((p) => `  ${p}\n`).join("") +
      `\nThe three measures are rem literals in src/app/globals.css, mirrored in\n` +
      `pixels in src/lib/constants/layout.ts because \`next/image\` \`sizes\` hints\n` +
      `are static strings and cannot read CSS. Fix whichever of the two is wrong —\n` +
      `they are the same number and the browser only obeys the stylesheet.`,
  );
  process.exit(1);
}

/**
 * `--check` DOES NOT NEED DESIGN.md, AND MUST NOT.
 *
 * `docs/` is gitignored, so the doc is absent from every CI checkout and from
 * every worktree. Wiring a check that reads it into `pnpm lint` would fail every
 * build for a file the build can never have. The two halves are therefore
 * separated: the two contracts above (all 17 ROLES declared in globals.css, and
 * the three measures agreeing with their pixel mirror) are the part CI can
 * verify and does, and the doc comparison runs only where the doc exists.
 *
 * That is not a weaker gate. The failure this script was written for — a value
 * documented that the stylesheet does not ship — is caught by the REQUIRED
 * check, before any table is rendered.
 */
if (!existsSync(DOC)) {
  if (check) {
    console.log(
      `design:tokens — ${tokens.size}/${REQUIRED.length} v2 tokens and ` +
        `${measures.size}/${Object.keys(MEASURES).length} page measures declared in globals.css. ` +
        `DESIGN.md is not present (docs/ is gitignored), so only the contracts were checked.`,
    );
    process.exit(0);
  }

  console.error(
    `design:tokens — ${DOC} not found.\n` +
      `The generated block is written into the design doc, which lives only in the\n` +
      `main checkout (docs/ is gitignored). Run this from there, or run --check,\n` +
      `which verifies the token contract without the doc.`,
  );
  process.exit(1);
}

const doc = readFileSync(DOC, "utf8");
const start = doc.indexOf(BEGIN);
const end = doc.indexOf(END);
if (start === -1 || end === -1) {
  console.error(`design:tokens — markers missing in ${DOC}`);
  process.exit(1);
}

const next =
  doc.slice(0, start + BEGIN.length) +
  "\n" +
  render(tokens, measures) +
  doc.slice(end);

if (check) {
  if (next !== doc) {
    console.error(
      "design:tokens — DESIGN.md is stale. Run `pnpm design:tokens` and commit.",
    );
    process.exit(1);
  }
  console.log(
    `design:tokens — up to date (${tokens.size} tokens, ${measures.size} measures)`,
  );
} else {
  writeFileSync(DOC, next);
  console.log(
    `design:tokens — wrote ${tokens.size} tokens and ${measures.size} measures to DESIGN.md`,
  );
}
