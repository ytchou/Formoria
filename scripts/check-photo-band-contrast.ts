/**
 * CONTRAST GATE FOR PHOTOGRAPHIC BANDS.
 *
 * A `PhotoBand` puts copy on top of a photograph behind a scrim. Whether that
 * copy is legible is a fact about the photograph's pixels, and it has been got
 * wrong twice by eye: the manifesto band shipped body copy at 3.04:1 over its
 * dark regions, and the homepage opener shipped a scrim sized off the half of
 * the frame nobody reads over. Neither was visible as a bug — both look merely
 * "a bit washed" or "a bit moody" until the numbers are run.
 *
 * So the numbers are run here, on every `pnpm lint`:
 *
 *   1. Find every `<PhotoBand …>` call site in `src/`.
 *   2. Read its `image` and `scrim` props. Both MUST be string literals — a
 *      band whose photograph is chosen at runtime cannot be checked, and an
 *      unverifiable band fails rather than passing quietly.
 *   3. Composite the real pixels of that photograph under that variant's real
 *      stops, across the variant's `textZone` only.
 *   4. Fail when the darkest sampled region drops the ink tokens under the AA
 *      floor.
 *
 * THE REMEDY IS ALWAYS THE PHOTOGRAPH, NEVER THE OPACITY. The stops in
 * `photo-band-scrims.ts` are a contract; a band that fails wants a lighter
 * crop, a different frame, or a different variant. Tuning a scrim per image is
 * how both original defects were introduced.
 *
 * It also bans a hand-rolled scrim anywhere else — an `absolute inset-0` over
 * `--ground` outside `PhotoBand` is the exact construction this component
 * replaced, and re-hand-rolling it would route around this gate.
 */

import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import sharp from "sharp";

import {
  PHOTO_BAND_SCRIMS,
  scrimAlphaAt,
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
 * Ink roles checked against every band. `--ink-muted` is deliberately ABSENT:
 * it fails over both current photographs, which is why the bands override it
 * where they use it. Adding it here would gate a role no band is allowed to
 * paint on itself anyway.
 */
const INK_TOKENS = ["--ink", "--ink-soft"] as const;

type Band = {
  file: string;
  image: string;
  scrim: ScrimVariant;
};

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return collectSourceFiles(full);
      return entry.name.endsWith(".tsx") ? [full] : [];
    }),
  );
  return files.flat();
}

function parseHexToken(css: string, token: string): [number, number, number] {
  const match = new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!match?.[1]) {
    throw new Error(`token ${token} not found in globals.css`);
  }
  const hex = match[1];
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.04045
      ? scaled / 12.92
      : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  ) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

/**
 * Call sites, found by reading the JSX rather than by keeping a registry.
 *
 * A registry would be a second list to keep in sync with the first, and the
 * drift would be silent in exactly the direction that matters — a band added
 * without a registry entry would go unchecked. The props are required to be
 * literals precisely so this is decidable from the source.
 */
function findBands(files: string[]): { bands: Band[]; errors: string[] } {
  const bands: Band[] = [];
  const errors: string[] = [];

  for (const file of files) {
    if (file === PHOTO_BAND_SOURCE) continue;
    const source = readFileSync(file, "utf8");
    const relative = path.relative(REPO_ROOT, file);

    for (const match of source.matchAll(/<PhotoBand\b([\s\S]*?)>/g)) {
      const props = match[1] ?? "";
      const image = /\bimage=\{?"([^"]+)"\}?/.exec(props)?.[1];
      const scrim = /\bscrim=\{?"([^"]+)"\}?/.exec(props)?.[1];

      if (!image || !scrim) {
        errors.push(
          `${relative}: <PhotoBand> needs literal \`image\` and \`scrim\` props so the contrast gate can check it`,
        );
        continue;
      }
      if (!(scrim in PHOTO_BAND_SCRIMS)) {
        errors.push(`${relative}: unknown scrim variant "${scrim}"`);
        continue;
      }
      bands.push({ file: relative, image, scrim: scrim as ScrimVariant });
    }
  }

  return { bands, errors };
}

/** The construction this component replaced, banned everywhere else. */
function findHandRolledScrims(files: string[]): string[] {
  const offenders: string[] = [];

  for (const file of files) {
    if (file === PHOTO_BAND_SOURCE) continue;
    const source = readFileSync(file, "utf8");

    for (const match of source.matchAll(/className="([^"]*absolute[^"]*)"/g)) {
      const classes = match[1] ?? "";
      if (!classes.includes("inset-0")) continue;
      if (!/\bbg-ground\//.test(classes)) continue;
      offenders.push(
        `${path.relative(REPO_ROOT, file)}: hand-rolled scrim \`${classes}\` — use <PhotoBand> instead`,
      );
    }
  }

  return offenders;
}

async function checkBand(
  band: Band,
  inks: { token: string; rgb: [number, number, number] }[],
  ground: [number, number, number],
): Promise<string[]> {
  const imagePath = path.join(PUBLIC_DIR, band.image);
  const { data, info } = await sharp(imagePath)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const [zoneStart, zoneEnd] = PHOTO_BAND_SCRIMS[band.scrim].textZone;
  const startX = Math.floor(info.width * zoneStart);
  const endX = Math.max(startX + 1, Math.ceil(info.width * zoneEnd));

  /*
   * Composited luminance per pixel, not per column: the scrim's alpha varies
   * across x, so a pixel's fate depends on where it sits as well as how dark
   * it is. A dark pixel under a heavy part of the scrim is fine; the same
   * pixel under a thin part is not.
   */
  const luminances: number[] = [];
  for (let y = 0; y < info.height; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      const alpha = scrimAlphaAt(band.scrim, x / info.width);
      const composited: [number, number, number] = [
        alpha * ground[0] + (1 - alpha) * (data[offset] ?? 0),
        alpha * ground[1] + (1 - alpha) * (data[offset + 1] ?? 0),
        alpha * ground[2] + (1 - alpha) * (data[offset + 2] ?? 0),
      ];
      luminances.push(relativeLuminance(composited));
    }
  }

  luminances.sort((a, b) => a - b);
  const index = Math.floor(luminances.length * DARK_PERCENTILE);
  const darkest = luminances[index];
  if (darkest === undefined) {
    return [`${band.file}: ${band.image} produced no pixels to sample`];
  }

  const failures: string[] = [];
  for (const ink of inks) {
    const ratio =
      (Math.max(relativeLuminance(ink.rgb), darkest) + 0.05) /
      (Math.min(relativeLuminance(ink.rgb), darkest) + 0.05);
    const label = `${band.file} · ${band.image} · scrim="${band.scrim}" · ${ink.token}`;
    if (ratio < AA_FLOOR) {
      failures.push(
        `${label}: ${ratio.toFixed(2)}:1 in the darkest ${DARK_PERCENTILE * 100}% of the text zone (floor ${AA_FLOOR}:1) — use a lighter crop or a different photograph, do NOT weaken the scrim`,
      );
    } else {
      console.log(`  ok  ${label}: ${ratio.toFixed(2)}:1`);
    }
  }
  return failures;
}

async function main(): Promise<void> {
  const css = readFileSync(GLOBALS_CSS, "utf8");
  const ground = parseHexToken(css, "--ground");
  const inks = INK_TOKENS.map((token) => ({
    token,
    rgb: parseHexToken(css, token),
  }));

  const files = await collectSourceFiles(SRC_DIR);
  const { bands, errors } = findBands(files);
  const problems = [...errors, ...findHandRolledScrims(files)];

  if (bands.length === 0 && problems.length === 0) {
    console.error(
      "check:photo-bands — no <PhotoBand> call sites found. The gate is checking nothing; the scanner is probably broken.",
    );
    process.exit(1);
  }

  console.log(`check:photo-bands — ${bands.length} band(s)`);
  for (const band of bands) {
    problems.push(...(await checkBand(band, inks, ground)));
  }

  if (problems.length > 0) {
    console.error("\ncheck:photo-bands FAILED");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  console.log("check:photo-bands — every band clears AA in its text zone.");
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
    process.exit(1);
  });
}

export { contrastRatio, relativeLuminance };
