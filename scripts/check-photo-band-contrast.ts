/**
 * CONTRAST GATE FOR PHOTOGRAPHIC BANDS.
 *
 * A `PhotoBand` puts copy on top of a photograph behind a scrim. Whether that
 * copy is legible is a fact about the photograph's pixels, and it has been got
 * wrong three times by eye: the manifesto band shipped body copy at 3.04:1
 * over its dark regions, the homepage opener shipped a scrim sized off the
 * half of the frame nobody reads over, and the fix for that shipped a text
 * zone measured at desktop and applied to phones. None was visible as a bug —
 * they look merely "a bit washed" or "a bit moody" until the numbers are run.
 *
 * So the numbers are run here, on every `pnpm lint`:
 *
 *   1. Find every `<PhotoBand …>` call site in `src/`, by parsing the TSX
 *      rather than by regex — a prop holding an arrow function contains a `>`
 *      and used to truncate the match, failing a band that was correct.
 *   2. Read its `image` and `scrim` props. Both MUST be string literals — a
 *      band whose photograph is chosen at runtime cannot be checked, and an
 *      unverifiable band fails rather than passing quietly.
 *   3. For EVERY breakpoint the variant declares, model what the browser
 *      actually shows: `object-cover` crops the photograph to the band's
 *      aspect ratio, so only the visible rectangle is sampled, and band-x is
 *      mapped through it before the scrim alpha is read.
 *   4. Composite those pixels under that breakpoint's real stops, across that
 *      breakpoint's `textZone` only, and fail when the darkest sampled region
 *      drops the ink roles the band actually paints under the AA floor.
 *
 * THE REMEDY IS ALWAYS THE PHOTOGRAPH, NEVER THE OPACITY. The stops in
 * `photo-band-scrims.ts` are a contract; a band that fails wants a lighter
 * crop, a different frame, or a different variant. Tuning a scrim per image is
 * how the first two defects were introduced.
 *
 * It also bans a hand-rolled scrim anywhere else — a full-bleed absolutely
 * positioned translucent or gradient layer outside `PhotoBand` is the exact
 * construction the component replaced, and re-hand-rolling it would route
 * around this gate.
 */

import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import sharp from "sharp";
import ts from "typescript";

import {
  contrastFromLuminance,
  hexToRgb,
  readHexToken,
  relativeLuminance,
} from "./lib/color.mjs";
import {
  PHOTO_BAND_SCRIMS,
  scrimAlphaAt,
  scrimBreakpoints,
  type ScrimBreakpoint,
  type ScrimVariant,
} from "../src/lib/design/photo-band-scrims";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const SRC_DIR = path.join(REPO_ROOT, "src");
const PUBLIC_DIR = path.join(REPO_ROOT, "public");
const GLOBALS_CSS = path.join(REPO_ROOT, "src/app/globals.css");

/** The component's own file, where the construction is allowed to exist. */
const PHOTO_BAND_SOURCE = path.join(
  REPO_ROOT,
  "src/components/ui/photo-band.tsx",
);

/**
 * SCRIMS THAT PREDATE THE BAN, NAMED ONE BY ONE.
 *
 * Both are real instances of the construction and both are debt, not
 * exceptions — they are listed rather than converted because converting a
 * surface is a design change and this gate is not the place to make one. A
 * blanket "skip anything older than the gate" would have hidden them instead;
 * a named list keeps the debt in the source where the next person editing that
 * file reads it.
 *
 * NO TICKET IS FILED FOR EITHER YET. File one before adding a third entry: two
 * exemptions is a backlog, and three is a second convention.
 */
const HAND_ROLLED_SCRIM_EXEMPTIONS: { file: string; why: string }[] = [
  {
    // A card-scale scrim, not a band: a full-bleed gradient over the trail
    // tile's photograph with light copy on it. `PhotoBand` has no variant for
    // a tile, and giving it one means deciding whether a tile scrim is the
    // same contract as a band scrim — which it probably is not, since the copy
    // here paints `--ground` on a DARK scrim rather than ink on a light one.
    file: "src/components/landing/trail-tile.tsx",
    why: "tile-scale gradient scrim over a photograph; needs a tile variant before it can move",
  },
  {
    // The wall caption's hover panel: solid canvas at 94% over the lower edge
    // of the product photograph, from `sm` up, revealed on hover. It is a
    // caption plate rather than a band scrim, and it is already argued for
    // with measured numbers in its own comment.
    file: "src/components/brands/selected-product-tile.tsx",
    why: "hover caption plate on the product wall; a partial-height panel, not a band",
  },
];

/**
 * WCAG AA for body text. Applied to the headline roles too: the display sizes
 * on these bands would qualify for the 3:1 large-text floor, but a band's
 * headline and its body copy sit on the same pixels, so a single floor is one
 * fewer thing to get wrong.
 */
const AA_FLOOR = 4.5;

/**
 * The percentile of the text zone treated as "the darkest region the copy sits
 * on". Not the true minimum: one stray dark pixel in ten thousand is not what
 * a reader experiences, and gating on it would reject every photograph with a
 * shadow in it.
 */
const DARK_PERCENTILE = 0.01;

/**
 * Ink roles checked against every band whatever it paints.
 *
 * `--ink-muted` is deliberately ABSENT from this floor — it fails over both
 * current photographs — but its absence is no longer a promise on trust. The
 * gate reads the ink each node inside a band actually paints (`resolveBandInk`
 * below) and adds it to this set, so a band that paints muted ink is checked
 * for muted ink and fails by name.
 *
 * WHAT IS NOT COVERED, stated so nobody reads more into this than it does:
 * non-ink foreground roles. `--accent` on the opener's browse link measured
 * 4.42:1 against the whole wide text zone and 7.16:1 restricted to the left
 * 35% where the link actually renders — the zone model is coarser than the
 * layout, so gating accent here would fail a control that is fine. A per-node
 * horizontal extent is what that would need, and nothing measures one.
 */
const BASE_INK_TOKENS = ["--ink", "--ink-soft"] as const;

/** `text-ink-soft` and friends, to the custom property they resolve to. */
const INK_UTILITY_TO_TOKEN: Record<string, string> = {
  "text-ink": "--ink",
  "text-ink-soft": "--ink-soft",
  "text-ink-muted": "--ink-muted",
};

type Band = {
  file: string;
  image: string;
  scrim: ScrimVariant;
  /**
   * One entry per JSX element inside the band, holding that element's class
   * list. The ink a band paints is decided per element, so the lists cannot be
   * flattened on the way in.
   */
  classLists: string[][];
};

type SourceFile = { file: string; source: string };

export async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      // Tests are skipped for the same reason the component's own file is: a
      // test that renders a `<PhotoBand>` over a fixture image, or asserts on
      // the scrim construction, is describing the rule rather than breaking
      // it, and has no correct way to satisfy the gate.
      if (entry.name === "__tests__") return [];
      if (entry.isDirectory()) return collectSourceFiles(full);
      if (/\.test\.tsx?$/.test(entry.name)) return [];
      return /\.tsx?$/.test(entry.name) ? [full] : [];
    }),
  );
  return files.flat();
}

/** Strips Tailwind variant prefixes: `sm:hover:bg-ground/94` -> `bg-ground/94`. */
function baseUtility(className: string): string {
  const segments = className.split(":");
  return segments[segments.length - 1] ?? className;
}

/**
 * Every string a class-list expression could contribute, whether it is written
 * inline, built with `cn`, or assembled in a template literal.
 *
 * The old detector read `className="…"` only, which the two live counterexamples
 * both evade — one hides the classes in a `cn()` assigned to a local, the other
 * would evade it with a single interpolation.
 */
function stringLiteralsIn(node: ts.Node): string[] {
  const found: string[] = [];
  const visit = (child: ts.Node) => {
    if (
      ts.isStringLiteral(child) ||
      ts.isNoSubstitutionTemplateLiteral(child) ||
      ts.isTemplateHead(child) ||
      ts.isTemplateMiddle(child) ||
      ts.isTemplateTail(child)
    ) {
      found.push(child.text);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function classListOf(node: ts.Node): string[] {
  return stringLiteralsIn(node)
    .join(" ")
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/**
 * THE BANNED CONSTRUCTION, AS A PREDICATE: a positioned layer that covers its
 * container and paints something you can see through.
 *
 * All three parts are required, which is what keeps it from flagging every
 * `absolute inset-0` overlay in the codebase — a focus ring, a click target
 * and a skeleton shimmer all cover their box and none of them paints a
 * translucent wash over a photograph.
 */
export function isHandRolledScrim(classes: string[]): boolean {
  const bases = new Set(classes.map(baseUtility));

  // `absolute` only, never `fixed`. A `fixed inset-0 bg-black/10` is a modal
  // backdrop over the VIEWPORT — dialog, sheet and alert-dialog all ship one,
  // and none of them is a scrim over a photograph. The banned construction is
  // an absolute layer inside a band's own `relative overflow-hidden` box.
  if (!bases.has("absolute")) return false;

  const covers =
    bases.has("inset-0") ||
    (bases.has("inset-x-0") &&
      (bases.has("inset-y-0") || bases.has("bottom-0") || bases.has("top-0")));
  if (!covers) return false;

  return [...bases].some((utility) => {
    // `bg-ground/85`, `bg-foreground/55` — a token with an opacity modifier.
    if (/^bg-[a-z0-9-]+\/\d/.test(utility)) return true;
    // `bg-gradient-to-t` (v3 name) and `bg-linear-to-t` (v4 name).
    if (/^bg-(gradient|linear|radial|conic)-/.test(utility)) return true;
    // `bg-[var(--ground)]/85`, `bg-[rgba(0,0,0,.5)]`, `bg-[#000]/40`.
    if (/^bg-\[.*(var\(--|rgba?\(|#|gradient)/.test(utility)) return true;
    return false;
  });
}

/**
 * Bands, hand-rolled scrims and prop errors, from one file's source text.
 *
 * Pure on purpose: the parts that have been wrong here are parsing decisions,
 * and a function taking source text is one a test can pin with a fixture
 * instead of a temporary directory.
 */
export function analyzeSource(
  relativeFile: string,
  source: string,
): { bands: Band[]; errors: string[]; handRolled: string[] } {
  const bands: Band[] = [];
  const errors: string[] = [];
  const handRolled: string[] = [];

  const parsed = ts.createSourceFile(
    relativeFile,
    source,
    ts.ScriptTarget.Latest,
    true,
    relativeFile.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const classListsSeen: string[][] = [];

  const openingOf = (node: ts.Node): ts.JsxOpeningLikeElement | undefined => {
    if (ts.isJsxSelfClosingElement(node)) return node;
    if (ts.isJsxOpeningElement(node)) return node;
    return undefined;
  };

  const classAttributeOf = (
    element: ts.JsxOpeningLikeElement,
  ): string[] | undefined => {
    for (const attribute of element.attributes.properties) {
      if (!ts.isJsxAttribute(attribute)) continue;
      const name = attribute.name.getText(parsed);
      if (name !== "className" && name !== "contentClassName") continue;
      if (!attribute.initializer) continue;
      return classListOf(attribute.initializer);
    }
    return undefined;
  };

  const literalProp = (
    element: ts.JsxOpeningLikeElement,
    propName: string,
  ): string | undefined => {
    for (const attribute of element.attributes.properties) {
      if (!ts.isJsxAttribute(attribute)) continue;
      if (attribute.name.getText(parsed) !== propName) continue;
      const initializer = attribute.initializer;
      if (!initializer) return undefined;
      if (ts.isStringLiteral(initializer)) return initializer.text;
      if (
        ts.isJsxExpression(initializer) &&
        initializer.expression &&
        ts.isStringLiteral(initializer.expression)
      ) {
        return initializer.expression.text;
      }
      return undefined;
    }
    return undefined;
  };

  /** Every element's class list inside a band, for the ink check. */
  const collectClassLists = (node: ts.Node, into: string[][]) => {
    const element = openingOf(node);
    if (element) {
      const classes = classAttributeOf(element);
      if (classes) into.push(classes);
    }
    ts.forEachChild(node, (child) => collectClassLists(child, into));
  };

  const visit = (node: ts.Node) => {
    const element = openingOf(node);
    if (element) {
      const classes = classAttributeOf(element);
      if (classes) classListsSeen.push(classes);

      if (element.tagName.getText(parsed) === "PhotoBand") {
        const image = literalProp(element, "image");
        const scrim = literalProp(element, "scrim");
        if (!image || !scrim) {
          errors.push(
            `${relativeFile}: <PhotoBand> needs literal \`image\` and \`scrim\` props so the contrast gate can check it`,
          );
        } else if (!(scrim in PHOTO_BAND_SCRIMS)) {
          errors.push(`${relativeFile}: unknown scrim variant "${scrim}"`);
        } else if (!image.startsWith("/") || image.includes("://")) {
          // The prop's docblock says "repo path under /public" and this is
          // what makes that true. A remote URL used to reach `path.join` and
          // die inside sharp with an ENOENT stack trace naming neither the
          // component nor the rule.
          errors.push(
            `${relativeFile}: <PhotoBand image="${image}"> must be a repo path under /public — the gate opens the file to measure it, and a remote image cannot be proved legible`,
          );
        } else {
          const classLists: string[][] = [];
          const parent = node.parent;
          if (parent && ts.isJsxElement(parent)) {
            for (const child of parent.children) {
              collectClassLists(child, classLists);
            }
          }
          bands.push({
            file: relativeFile,
            image,
            scrim: scrim as ScrimVariant,
            classLists,
          });
        }
      }
    }

    // `cn(...)`, `clsx(...)`, `cva(...)` — a class list that never reaches a
    // `className=` attribute as a literal.
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(parsed);
      if (/^(cn|clsx|cva|twMerge|buttonVariants)$/.test(callee)) {
        classListsSeen.push(classListOf(node));
      }
    }

    // A bare string constant assigned to a variable and used later.
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      (ts.isStringLiteral(node.initializer) ||
        ts.isNoSubstitutionTemplateLiteral(node.initializer) ||
        ts.isTemplateExpression(node.initializer))
    ) {
      classListsSeen.push(classListOf(node.initializer));
    }

    ts.forEachChild(node, visit);
  };

  visit(parsed);

  const reported = new Set<string>();
  for (const classes of classListsSeen) {
    if (!isHandRolledScrim(classes)) continue;
    const rendered = classes.join(" ");
    if (reported.has(rendered)) continue;
    reported.add(rendered);
    handRolled.push(
      `${relativeFile}: hand-rolled scrim \`${rendered}\` — use <PhotoBand> instead`,
    );
  }

  return { bands, errors, handRolled };
}

export function analyzeFiles(files: SourceFile[]): {
  bands: Band[];
  errors: string[];
  handRolled: string[];
} {
  const bands: Band[] = [];
  const errors: string[] = [];
  const handRolled: string[] = [];
  const exempt = new Set(
    HAND_ROLLED_SCRIM_EXEMPTIONS.map((entry) => entry.file),
  );

  for (const { file, source } of files) {
    if (file === path.relative(REPO_ROOT, PHOTO_BAND_SOURCE)) continue;
    const result = analyzeSource(file, source);
    bands.push(...result.bands);
    errors.push(...result.errors);
    if (!exempt.has(file)) handRolled.push(...result.handRolled);
  }

  return { bands, errors, handRolled };
}

/**
 * `@utility type-body { @apply … text-ink-muted }` — the role-to-ink map, read
 * from the stylesheet rather than restated here.
 */
export function readTypeRoleInk(css: string): Map<string, string> {
  const roles = new Map<string, string>();
  for (const match of css.matchAll(
    /@utility\s+(type-[a-z0-9-]+)\s*\{([^}]*)\}/g,
  )) {
    const [, role, body] = match;
    if (!role || !body) continue;
    // `@apply` declarations end in a semicolon, which is part of the token as
    // far as a whitespace split is concerned.
    for (const utility of body.split(/\s+/)) {
      const token =
        INK_UTILITY_TO_TOKEN[baseUtility(utility.replace(/[;,]+$/, ""))];
      if (token) roles.set(role, token);
    }
  }
  return roles;
}

/**
 * The ink tokens a band actually paints.
 *
 * Per element, an explicit `text-ink-*` beats the `type-*` role's default —
 * which is exactly what the homepage opener does, overriding `type-eyebrow`'s
 * muted ink because muted fails over that photograph. An element carrying
 * neither is inheriting, and inheriting from an ancestor already in this set.
 */
export function resolveBandInk(
  classLists: string[][],
  roleInk: Map<string, string>,
): string[] {
  const tokens = new Set<string>(BASE_INK_TOKENS);

  for (const classes of classLists) {
    const bases = classes.map(baseUtility);
    const explicit = bases
      .map((utility) => INK_UTILITY_TO_TOKEN[utility])
      .filter((token): token is string => Boolean(token));
    if (explicit.length > 0) {
      for (const token of explicit) tokens.add(token);
      continue;
    }
    for (const utility of bases) {
      const token = roleInk.get(utility);
      if (token) tokens.add(token);
    }
  }

  return [...tokens];
}

/**
 * WHAT `object-cover` ACTUALLY SHOWS, as fractions of the source image.
 *
 * The band is full-bleed and its height is set by its copy, so its ratio has
 * nothing to do with the photograph's. The browser scales the image to cover
 * the box and centres it, discarding the overflow on one axis — which is why
 * measuring the file was measuring pixels nobody sees: on a phone the opener
 * shows a centre strip roughly 42% of the frame wide, so every alpha the old
 * gate assigned to a column was assigned to the wrong column.
 */
export function visibleSourceRect(
  imageAspect: number,
  bandAspect: number,
): { x0: number; x1: number; y0: number; y1: number } {
  if (bandAspect >= imageAspect) {
    // Wider box than frame: full width survives, rows are cropped.
    const visible = imageAspect / bandAspect;
    const margin = (1 - visible) / 2;
    return { x0: 0, x1: 1, y0: margin, y1: 1 - margin };
  }
  const visible = bandAspect / imageAspect;
  const margin = (1 - visible) / 2;
  return { x0: margin, x1: 1 - margin, y0: 0, y1: 1 };
}

/**
 * The photograph's pixels, normalised so the arithmetic below cannot be
 * silently wrong.
 *
 * `flatten` composites any alpha over `--ground`, which is what the browser
 * does behind a band; `toColourspace("srgb")` turns a greyscale export into
 * three channels. Without both, `data[offset + 1]` on a one-channel image
 * reads the NEXT PIXEL as this pixel's green — a plausible-looking ratio
 * computed from garbage, printed as a pass. The channel assertion is the
 * fail-closed backstop for any format neither step normalises.
 */
export function assertRgbPixels(
  label: string,
  data: { length: number },
  info: { width: number; height: number; channels: number },
): void {
  if (info.channels !== 3) {
    throw new Error(
      `${label}: expected 3 channels after normalising, got ${info.channels} — the gate cannot read this image's pixels and will not guess at them`,
    );
  }
  if (data.length < info.width * info.height * 3) {
    throw new Error(
      `${label}: pixel buffer is shorter than ${info.width}x${info.height}x3`,
    );
  }
}

export async function loadBandPixels(
  imagePath: string,
  ground: [number, number, number],
): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(imagePath)
    .flatten({ background: { r: ground[0], g: ground[1], b: ground[2] } })
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });

  assertRgbPixels(imagePath, data, info);

  return { data, width: info.width, height: info.height };
}

export function darkestCompositedLuminance(
  pixels: { data: Buffer; width: number; height: number },
  breakpoint: ScrimBreakpoint,
  ground: [number, number, number],
): number | undefined {
  const { data, width, height } = pixels;
  const rect = visibleSourceRect(width / height, breakpoint.bandAspect);
  const [zoneStart, zoneEnd] = breakpoint.textZone;

  const firstRow = Math.floor(rect.y0 * height);
  const lastRow = Math.max(firstRow + 1, Math.ceil(rect.y1 * height));
  const visibleWidth = rect.x1 - rect.x0;

  /*
   * Composited luminance per pixel, not per column: the scrim's alpha varies
   * across x, so a pixel's fate depends on where it sits as well as how dark
   * it is. A dark pixel under a heavy part of the scrim is fine; the same
   * pixel under a thin part is not. `bandX` is the position in the RENDERED
   * band — the only space the scrim's stops are defined in.
   */
  const startImageX = Math.floor((rect.x0 + zoneStart * visibleWidth) * width);
  const endImageX = Math.min(
    width,
    Math.max(
      startImageX + 1,
      Math.ceil((rect.x0 + zoneEnd * visibleWidth) * width),
    ),
  );

  const luminances: number[] = [];
  for (let y = firstRow; y < Math.min(lastRow, height); y += 1) {
    for (let x = startImageX; x < endImageX; x += 1) {
      const bandX = (x / width - rect.x0) / visibleWidth;
      const alpha = scrimAlphaAt(breakpoint, bandX);
      const offset = (y * width + x) * 3;
      const composited: [number, number, number] = [
        alpha * ground[0] + (1 - alpha) * (data[offset] ?? 0),
        alpha * ground[1] + (1 - alpha) * (data[offset + 1] ?? 0),
        alpha * ground[2] + (1 - alpha) * (data[offset + 2] ?? 0),
      ];
      luminances.push(relativeLuminance(composited));
    }
  }

  luminances.sort((a, b) => a - b);
  return luminances[Math.floor(luminances.length * DARK_PERCENTILE)];
}

/** How a breakpoint is named in the gate's output. */
export function breakpointLabel(breakpoint: ScrimBreakpoint): string {
  return breakpoint.minWidth <= 0
    ? "base (narrow)"
    : `min-width:${breakpoint.minWidth}px`;
}

async function checkBand(
  band: Band,
  inkTokens: { token: string; rgb: [number, number, number] }[],
  ground: [number, number, number],
): Promise<string[]> {
  const imagePath = path.join(PUBLIC_DIR, band.image);
  const pixels = await loadBandPixels(imagePath, ground);
  const failures: string[] = [];

  for (const breakpoint of scrimBreakpoints(band.scrim)) {
    const darkest = darkestCompositedLuminance(pixels, breakpoint, ground);
    if (darkest === undefined) {
      failures.push(
        `${band.file}: ${band.image} produced no pixels to sample at ${breakpointLabel(breakpoint)}`,
      );
      continue;
    }

    for (const ink of inkTokens) {
      const ratio = contrastFromLuminance(relativeLuminance(ink.rgb), darkest);
      const label = `${band.file} · ${band.image} · scrim="${band.scrim}" · ${breakpointLabel(breakpoint)} · ${ink.token}`;
      if (ratio < AA_FLOOR) {
        failures.push(
          `${label}: ${ratio.toFixed(2)}:1 in the darkest ${DARK_PERCENTILE * 100}% of the text zone (floor ${AA_FLOOR}:1) — use a lighter crop or a different photograph, do NOT weaken the scrim`,
        );
      } else {
        console.log(`  ok  ${label}: ${ratio.toFixed(2)}:1`);
      }
    }
  }

  return failures;
}

function rgbToken(css: string, token: string): [number, number, number] {
  const rgb = hexToRgb(readHexToken(css, token));
  if (!rgb) throw new Error(`token ${token} is not a 6-digit hex colour`);
  return rgb;
}

async function main(): Promise<void> {
  const css = readFileSync(GLOBALS_CSS, "utf8");
  const ground = rgbToken(css, "--ground");
  const roleInk = readTypeRoleInk(css);

  const files = (await collectSourceFiles(SRC_DIR)).map((file) => ({
    file: path.relative(REPO_ROOT, file),
    source: readFileSync(file, "utf8"),
  }));
  const { bands, errors, handRolled } = analyzeFiles(files);
  const problems = [...errors, ...handRolled];

  if (bands.length === 0 && problems.length === 0) {
    console.error(
      "check:photo-bands — no <PhotoBand> call sites found. The gate is checking nothing; the scanner is probably broken.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`check:photo-bands — ${bands.length} band(s)`);
  for (const band of bands) {
    const inkTokens = resolveBandInk(band.classLists, roleInk).map((token) => ({
      token,
      rgb: rgbToken(css, token),
    }));
    problems.push(...(await checkBand(band, inkTokens, ground)));
  }

  if (problems.length > 0) {
    console.error("\ncheck:photo-bands FAILED");
    for (const problem of problems) console.error(`  - ${problem}`);
    // `exitCode`, not `exit`: `process.exit` can cut off buffered stdout on a
    // piped CI runner, which drops the very list that says what to fix.
    process.exitCode = 1;
    return;
  }

  console.log(
    "check:photo-bands — every band clears AA in its text zone, at every declared breakpoint.",
  );
}

// `pathToFileURL` percent-encodes exactly as `import.meta.url` does, matching
// `check-zh-terms.ts`: a hand-built `file://${path}` compares false for any
// checkout path holding a space, and the gate would then exit 0 in silence.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    console.error("check:photo-bands FAILED");
    console.error(error);
    process.exitCode = 1;
  });
}

export { HAND_ROLLED_SCRIM_EXEMPTIONS, PHOTO_BAND_SOURCE, REPO_ROOT, SRC_DIR };
