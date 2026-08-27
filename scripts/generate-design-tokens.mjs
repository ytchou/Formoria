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
import { contrast } from "./lib/color.mjs";

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
 * ramps need. Reconciled to the complete v2 token set on 2026-08-20 (DEV-1514).
 */
const ROLES = {
  ground: "page background",
  surface: "bands, cards, inset blocks",
  "surface-deep": "third step; image placeholder",
  "surface-dark": "warm-charcoal photographic bands",
  ink: "primary text",
  "ink-soft": "body prose",
  "ink-muted": "metadata, secondary",
  rule: "hairlines, borders",
  accent: "interaction only",
  "on-ink": "text on ink grounds",
  "on-ink-muted": "secondary text on ink grounds",
  "rule-on-ink": "hairline on ink grounds; non-text only",
  danger: "form errors",
  "radius-control": "buttons, inputs, chips",
  "radius-surface": "cards, dialogs, panels, badges",
  "font-ming": "content face",
  "font-hei": "interface face",
  "space-section": "between page sections",
  "space-stack": "between blocks in a section",
  "space-gutter": "grid column gap",
};

const GROUPS = [
  [
    "Colour",
    (n) =>
      !n.startsWith("font-") &&
      !n.startsWith("space-") &&
      !n.startsWith("radius-"),
  ],
  ["Typography", (n) => n.startsWith("font-")],
  ["Spacing", (n) => n.startsWith("space-")],
  ["Radius", (n) => n.startsWith("radius-")],
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
 * Kept as its own map rather than folded into ROLES because the measures are
 * `@utility` rules, not `--custom-properties`, so `parseTokens` cannot see them
 * at all.
 *
 * All three are now bare rem literals, so every entry binds to the same hard
 * assertion and there is no accepted non-literal. `page-measure` briefly
 * resolved through an overridable `--page-measure` so the footer could follow
 * the page above it; that property is gone, and a `var()` here would again be
 * an override seam this contract could not price in px.
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
  // max-width must be the block's FIRST declaration, which is what makes an
  // `@utility` carrying no max-width of its own match nothing rather than
  // borrow the next one in the file. `page-gutter-wide` is the live case: its
  // body opens with `@apply page-gutter`, and a pattern willing to scan forward
  // for a `max-width` would bind some later rule's width to that name and
  // document it as a measure.
  const out = new Map();
  for (const m of css.matchAll(
    /@utility\s+([a-z0-9-]+)\s*\{\s*max-width:\s*([^;]+);/gi,
  )) {
    const [, name, raw] = m;
    // The four component names — `overlay-compact`, `overlay-panel`,
    // `overlay-wide`, `content-column` — DO open with a `max-width`, so they
    // match above. They are a component's width rather than a page's and have
    // no pixel mirror to agree with; this line is what keeps them out of the
    // measure contract and out of the doc's Measure table.
    if (!(name in MEASURES)) continue;
    out.set(name, raw.trim());
  }
  return out;
}

/**
 * `MEASURE_PX` read as TEXT, not imported. This is an `.mjs` script running as
 * the first link of the `pnpm lint` chain, and standing up a TypeScript loader
 * there to read three integers costs more than it buys. Regex, like the CSS.
 *
 * THE OBJECT BODY IS BRACE-MATCHED, NOT REGEXED. A single `([^}]*)` stops at
 * the first `}` in the file, so one `{@link …}` in a per-key JSDoc — or a
 * nested object added later — would silently cut the map short after whatever
 * keys came before it. That failure does not look like a parse failure: the
 * short map simply lacks a key, and `checkMeasures` reports
 * `MEASURE_PX.prose is missing from layout.ts` to a reader who can see it
 * sitting there. A guard whose message points at the wrong file is worse than
 * no guard, so the body is scanned to its matching close instead.
 *
 * Both ways of failing to FIND the object are loud, for the same reason: an
 * empty map is indistinguishable downstream from three absent keys.
 */
function parseMeasurePx(ts) {
  const header = ts.match(/export const MEASURE_PX\s*(?::[^=]*)?=\s*\{/);
  if (!header) {
    console.error(
      `design:tokens — could not find \`export const MEASURE_PX = {\` in ${PX}.\n` +
        `That constant is the pixel mirror of the three page measures. If it was\n` +
        `renamed or moved, this script has to be told; if it was deleted, the\n` +
        `\`sizes\` hints that read it have lost their anchor to globals.css.`,
    );
    process.exit(1);
  }

  const open = header.index + header[0].length - 1;
  let depth = 0;
  let close = -1;
  for (let i = open; i < ts.length; i += 1) {
    if (ts[i] === "{") depth += 1;
    else if (ts[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }

  if (close === -1) {
    console.error(
      `design:tokens — the \`MEASURE_PX\` object literal in ${PX} never closes.\n` +
        `Its braces are unbalanced from the declaration onward, so the pixel\n` +
        `mirror cannot be read and no measure can be checked against it.`,
    );
    process.exit(1);
  }

  // Bare integer values only, which is all the three keys have ever held. A
  // separator or an expression (`1_600`, `100 * 16`) would read as a different
  // number and be reported as a disagreement rather than as a parse problem —
  // acceptable, because that message still names the right file and the right
  // key, which is the property the brace scan above exists to preserve.
  const out = new Map();
  for (const m of ts
    .slice(open + 1, close)
    .matchAll(/([a-z]+)\s*:\s*(\d+)/gi)) {
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
      problems.push(
        `${name}: no \`@utility ${name}\` with a max-width in globals.css`,
      );
      continue;
    }

    const want = px.get(spec.px);
    if (want === undefined) {
      problems.push(`${name}: MEASURE_PX.${spec.px} is missing from layout.ts`);
      continue;
    }

    const got = remToPx(value);
    if (got === null) {
      // No accepted non-literal is left: the contract above retired the last
      // one, so anything that is not a bare rem is a failure outright.
      problems.push(
        `${name}: declared \`${value}\`, which is not a rem literal`,
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

  // Its own table because it is its own contract: these are `@utility` rules
  // with a px counterpart to agree with, not entries in the colour table's
  // custom-property ramp.
  //
  // UNCONDITIONAL, AND EVERY ROW RENDERS. `checkMeasures` runs before this and
  // exits 1 unless all three are declared as bare rem literals agreeing with
  // `MEASURE_PX`, so there is no absent measure to skip here and no
  // non-literal to print a dash for. Both branches lived in this block until
  // DEV-1529 and neither could be reached from any tree; a fallback that
  // cannot fire is a claim the table can express something it cannot.
  lines.push(
    "### Measure",
    "",
    "| Utility | CSS | px | Role |",
    "|---|---|---|---|",
  );
  for (const [name, spec] of Object.entries(MEASURES)) {
    const value = measures.get(name);
    // px derived from the CSS, NEVER from MEASURE_PX. The two agree — the check
    // above proved it — but only one of them is what the browser obeys, and the
    // doc has to quote that one.
    lines.push(
      `| \`${name}\` | \`${value}\` | ${remToPx(value)}px | ${spec.role} |`,
    );
  }
  lines.push("");

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
const measureProblems = checkMeasures(
  measures,
  parseMeasurePx(readFileSync(PX, "utf8")),
);

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
