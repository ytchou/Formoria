#!/usr/bin/env node
// One-off derivation: booth-block rectangles for the 2026 Taiwan Creative Expo
// floor map. Output is a committed artifact
// (content/events/2026-taiwan-creative-expo.block-geometry.json); this script
// exists so the derivation is reproducible and reviewable, not so it runs in CI.
//
// Why segment the committed .webp rather than the source PDF: the PDF has no
// text layer and no vector booth shapes (both pages are flattened CMYK rasters),
// so there is nothing to parse either way -- but the .webp is lossless VP8L and
// is natively 3200x2450, which is EXPO_FLOOR_MAP_GEOMETRY's coordinate system.
// Extracting from it means block rects need no crop-offset calibration to line
// up with the zone polygons already in taiwan-creative-expo-floor-map-config.ts.
//
// The map draws one flat-filled rectangle per booth block, one fill colour per
// zone, separated by white gutters -- so connected components of an exact-colour
// mask are the blocks. Codes are assigned against a closed vocabulary: the
// exhibitor ledger already lists every valid block code, so labelling only has
// to pick the nearest member, never read free text.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAP_IMAGE = join(
  ROOT,
  'public/images/events/taiwan-creative-expo-2026-floor-map.webp',
);
const LEDGER = join(
  ROOT,
  'content/events/2026-taiwan-creative-expo.exhibitors.json',
);
const OUT = join(
  ROOT,
  'content/events/2026-taiwan-creative-expo.block-geometry.json',
);

// Sampled from the committed .webp, which sits 1-3 levels off the source PDF's
// values after colour conversion -- hence the tolerance rather than an equality
// test. The four zones Formoria lists; J1/J2/J3/F/I/K4 are deliberately absent.
const ZONE_FILLS = {
  K1: [143, 162, 165],
  K2: [158, 220, 220],
  K3: [171, 173, 175],
  S: [203, 202, 202],
};
const COLOUR_TOLERANCE = 6;

// Mirrors EXPO_ZONE_DEFINITIONS[].polygon in
// src/components/events/taiwan-creative-expo-floor-map-config.ts. Every booth
// block must fall inside its own zone's region; anything outside is a legend
// swatch or a zone-header chip painted in the same fill, not a booth. Keeping a
// copy here rather than importing the .ts keeps this script dependency-free --
// the artifact test asserts the two agree.
const ZONE_BOUNDS = {
  K1: { x0: 1560, y0: 1575, x1: 2450, y1: 2270 },
  K2: { x0: 1560, y0: 1080, x1: 2450, y1: 1585 },
  K3: { x0: 2470, y0: 1000, x1: 3190, y1: 1905 },
  S: { x0: 2470, y0: 105, x1: 3190, y1: 1120 },
};

// A booth block is roughly 45x31 in this coordinate space. The floor plan also
// paints thin rules and legend swatches in the same fills, so anything much
// smaller than a block is an artefact rather than a booth.
const MIN_BLOCK_WIDTH = 18;
const MIN_BLOCK_HEIGHT = 12;

/**
 * Printed codes are ~8px tall here, below what Tesseract reads reliably, so
 * every crop is upscaled first. 6x suits almost every block; the narrow stands
 * along the aisles carry smaller type and need 12x. Escalating only on failure
 * matters -- at 12x, lanczos ringing on a normal-sized block starts reading the
 * leading `S` of an S-zone code as `5` or `9`.
 */
const OCR_UPSCALES = [6, 12];

/** `K1-011-03` and `K1-019-1` are sub-booths of one printed block. */
const BOOTH_CODE = /^(K1|K2|K3|S|J2)-(\d+)(?:-(\d+))?$/;

export function parseBoothCode(booth) {
  const match = BOOTH_CODE.exec(booth?.trim() ?? '');
  if (!match) return null;
  return {
    zone: match[1],
    block: `${match[1]}-${match[2]}`,
    sub: match[3] ?? null,
  };
}

/**
 * Two-pass run-length connected components with union-find. Rows are scanned
 * into runs and merged against the previous row's overlapping runs, which keeps
 * the whole 3200x2450 mask at one pass per axis instead of a per-pixel flood.
 */
function labelComponents(mask, width, height) {
  const parent = [0];
  const find = (x) => {
    let root = x;
    while (parent[root] !== root) root = parent[root];
    while (parent[x] !== root) {
      const next = parent[x];
      parent[x] = root;
      x = next;
    }
    return root;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  const runs = [];
  let previous = [];
  for (let y = 0; y < height; y += 1) {
    const current = [];
    let x = 0;
    const rowOffset = y * width;
    while (x < width) {
      if (!mask[rowOffset + x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < width && mask[rowOffset + x]) x += 1;
      const id = parent.length;
      parent.push(id);
      current.push([start, x, id]);
      runs.push([y, start, x, id]);
      for (const [previousStart, previousEnd, previousId] of previous) {
        if (previousStart < x && start < previousEnd) union(id, previousId);
      }
    }
    previous = current;
  }

  const boxes = new Map();
  for (const [y, start, end, id] of runs) {
    const root = find(id);
    const box = boxes.get(root);
    if (!box) {
      boxes.set(root, { x0: start, y0: y, x1: end, y1: y + 1, area: end - start });
      continue;
    }
    box.x0 = Math.min(box.x0, start);
    box.y0 = Math.min(box.y0, y);
    box.x1 = Math.max(box.x1, end);
    box.y1 = Math.max(box.y1, y + 1);
    box.area += end - start;
  }
  return [...boxes.values()];
}

function buildMask(data, channels, width, height, [tr, tg, tb]) {
  const mask = new Uint8Array(width * height);
  for (let pixel = 0, i = 0; pixel < mask.length; pixel += 1, i += channels) {
    if (
      Math.abs(data[i] - tr) <= COLOUR_TOLERANCE &&
      Math.abs(data[i + 1] - tg) <= COLOUR_TOLERANCE &&
      Math.abs(data[i + 2] - tb) <= COLOUR_TOLERANCE
    ) {
      mask[pixel] = 1;
    }
  }
  return mask;
}

/**
 * Read the block code printed inside one rect. Tesseract is a one-time
 * dev-machine tool (`brew install tesseract`), never a repo dependency -- this
 * script's output is committed, so nothing in CI or at runtime needs OCR.
 *
 * The whitelist and single-line mode matter more than they look: the printed
 * codes are the only text inside a block, and constraining the alphabet to the
 * characters a block code can contain removes most of the misreads outright.
 */
function readBlockCode(imagePath, pageSegMode) {
  try {
    const stdout = execFileSync(
      'tesseract',
      [
        imagePath,
        'stdout',
        '--psm',
        String(pageSegMode),
        '-c',
        'tessedit_char_whitelist=KS0123456789-',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return stdout.trim();
  } catch {
    return '';
  }
}

/**
 * 7 (one text line) suits the common single-label block. 6 and 11 are the
 * fallbacks for the two shapes that defeat it: blocks holding sub-booths print
 * a whole grid of labels, and the narrow aisle-edge stands print one rotated
 * label with a lot of empty space around it.
 */
const PAGE_SEG_MODES = [7, 6, 11];

/**
 * Ordered by how often each one wins. The fixed linear stretch leads because
 * many blocks have a near-white service square notched out of them, and an
 * adaptive stretch pins its white point to that notch -- which collapses the
 * mid-grey fill against the dark label and reads as blank. A fixed curve
 * ignores the notch entirely. `normalise` still helps the faintest of the light
 * teal blocks, and `negate` covers the inverted-label stands.
 */
const CONTRAST_VARIANTS = {
  linear: (pipeline) => pipeline.linear(2.2, -140),
  normalise: (pipeline) => pipeline.normalise(),
  negate: (pipeline) => pipeline.normalise().negate(),
};

/**
 * Try to read one block's code, escalating through preprocessing variants and
 * stopping at the first that lands on a real code.
 *
 * Two things force the escalation. The zone fills span light teal to mid grey,
 * so a single threshold that suits K2 crushes K1's text into its background --
 * hence the plain-contrast attempt before any binarisation, and the inverted
 * attempt after it. And the blocks along the right-hand aisles are printed
 * portrait with their labels rotated, so a portrait rect gets retried at +/-90.
 */
async function readBlockAt(box, candidates, zone, pathPrefix) {
  const width = box.x1 - box.x0;
  const height = box.y1 - box.y0;
  // Small rects carry proportionally smaller type, so they get a bigger upscale
  // rather than one global factor that over-blurs the large blocks.
  const rotations = height > width * 1.3 ? [0, 90, 270] : [0];
  let lastRaw = '';
  for (const scale of OCR_UPSCALES) {
    for (const rotation of rotations) {
      for (const [name, contrast] of Object.entries(CONTRAST_VARIANTS)) {
        const file = `${pathPrefix}-x${scale}-r${rotation}-${name}.png`;
        let pipeline = sharp(MAP_IMAGE)
          .extract({ left: box.x0, top: box.y0, width, height })
          .resize({ width: width * scale, kernel: 'lanczos3' })
          .greyscale();
        if (rotation) pipeline = pipeline.rotate(rotation);
        await contrast(pipeline).png().toFile(file);

        for (const mode of PAGE_SEG_MODES) {
          const raw = readBlockCode(file, mode);
          if (raw) lastRaw = raw;
          const code = matchBlockCode(raw, candidates, zone);
          if (code) return { code, raw };
        }
      }
    }
  }
  return { code: null, raw: lastRaw };
}

/**
 * Snap a raw OCR string onto the closed vocabulary of codes the ledger says
 * exist in this zone. Anything that does not land on a real code is reported
 * rather than guessed -- a silently mis-assigned block is the failure mode this
 * whole script is built to avoid.
 */
function matchBlockCode(raw, candidates, zone) {
  const normalized = raw
    .toUpperCase()
    .replace(/[^KS0-9-]/g, '')
    .replace(/^[-]+|[-]+$/g, '');
  if (!normalized) return null;
  if (candidates.has(normalized)) return normalized;

  // A block that holds sub-booths prints every sub-code inside it, so OCR comes
  // back with `K1-011-03` where the block itself is `K1-011`.
  const parsed = parseBoothCode(normalized);
  if (parsed?.sub && candidates.has(parsed.block)) return parsed.block;

  // Deliberately no fuzzy/edit-distance fallback. Adjacent booths differ by a
  // single digit, so `K2-055` sits one edit from both `K2-054` and `K2-056` --
  // any near-match rule here silently mis-assigns a block to the wrong brand,
  // which is the one failure this script is built to prevent. An unreadable
  // rect is reported and resolved in BLOCK_OVERRIDES instead of guessed.

  // The printed map carries booths the ledger does not list -- stands Formoria
  // never catalogued, and vacant ones. They are still part of the hall, so a
  // well-formed code for this zone is kept and rendered as an unlisted booth
  // rather than discarded.
  if (parsed && !parsed.sub && parsed.zone === zone) return normalized;
  return null;
}

function loadExpectedBlocks() {
  const ledger = JSON.parse(readFileSync(LEDGER, 'utf8'));
  const blocks = new Map();
  for (const exhibitor of ledger.exhibitors) {
    const parsed = parseBoothCode(exhibitor.booth);
    if (!parsed || !(parsed.zone in ZONE_FILLS)) continue;
    const existing = blocks.get(parsed.block);
    if (existing) existing.booths.push(exhibitor.booth);
    else
      blocks.set(parsed.block, {
        block: parsed.block,
        zone: parsed.zone,
        booths: [exhibitor.booth],
      });
  }
  return blocks;
}

async function main() {
  const { data, info } = await sharp(MAP_IMAGE)
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  const expected = loadExpectedBlocks();
  const expectedByZone = {};
  for (const block of expected.values()) {
    expectedByZone[block.zone] = (expectedByZone[block.zone] ?? 0) + 1;
  }

  const detected = {};
  const rejected = {};
  let total = 0;
  for (const [zone, fill] of Object.entries(ZONE_FILLS)) {
    const mask = buildMask(data, channels, width, height, fill);
    const sized = labelComponents(mask, width, height).filter(
      (box) =>
        box.x1 - box.x0 >= MIN_BLOCK_WIDTH && box.y1 - box.y0 >= MIN_BLOCK_HEIGHT,
    );
    const bounds = ZONE_BOUNDS[zone];
    const inside = [];
    const outside = [];
    for (const box of sized) {
      const contained =
        box.x0 >= bounds.x0 &&
        box.y0 >= bounds.y0 &&
        box.x1 <= bounds.x1 &&
        box.y1 <= bounds.y1;
      (contained ? inside : outside).push(box);
    }
    detected[zone] = inside;
    rejected[zone] = outside;
    total += inside.length;
  }

  console.log(`map ${width}x${height}\n`);
  console.log('zone  detected  expected  delta');
  for (const zone of Object.keys(ZONE_FILLS)) {
    const found = detected[zone].length;
    const want = expectedByZone[zone] ?? 0;
    const delta = found - want;
    console.log(
      `${zone.padEnd(5)} ${String(found).padStart(8)} ${String(want).padStart(9)} ${
        delta === 0 ? '    ok' : String(delta).padStart(6)
      }`,
    );
  }
  console.log(
    `\ntotal ${total} detected / ${expected.size} expected blocks (${
      [...expected.values()].reduce((n, b) => n + b.booths.length, 0)
    } booths)`,
  );

  for (const zone of Object.keys(ZONE_FILLS)) {
    if (!rejected[zone].length) continue;
    console.log(`\n${zone} rejected as outside the zone polygon:`);
    for (const box of rejected[zone]) {
      console.log(
        `   ${String(box.x1 - box.x0).padStart(3)}x${String(box.y1 - box.y0).padStart(3)} at (${box.x0},${box.y0})`,
      );
    }
  }

  // Size histogram -- sliver artefacts and merged double-width blocks both show
  // up here, so this is what the min-size thresholds get tuned against. DIAG=1
  // adds the coordinates of every rare size, which is how a stray legend swatch
  // or zone-header chip gets identified.
  console.log();
  for (const zone of Object.keys(ZONE_FILLS)) {
    const sizes = new Map();
    for (const box of detected[zone]) {
      const key = `${box.x1 - box.x0}x${box.y1 - box.y0}`;
      sizes.set(key, (sizes.get(key) ?? 0) + 1);
    }
    const ranked = [...sizes.entries()].sort((a, b) => b[1] - a[1]);
    const shown = process.env.DIAG === '1' ? ranked : ranked.slice(0, 6);
    console.log(`${zone}: ${shown.map(([s, n]) => `${s}×${n}`).join('  ')}`);
    if (process.env.DIAG !== '1') continue;
    const rare = detected[zone]
      .filter((box) => sizes.get(`${box.x1 - box.x0}x${box.y1 - box.y0}`) <= 2)
      .sort((a, b) => a.y0 - b.y0);
    for (const box of rare) {
      console.log(
        `   rare ${String(box.x1 - box.x0).padStart(3)}x${String(box.y1 - box.y0).padStart(3)} at (${box.x0},${box.y0})`,
      );
    }
  }

  // --- label each rect against the ledger's closed vocabulary -----------------
  const workDir = mkdtempSync(join(tmpdir(), 'expo-blocks-'));
  const assigned = new Map();
  const unreadable = [];
  try {
    for (const [zone, boxes] of Object.entries(detected)) {
      const candidates = new Set(
        [...expected.values()].filter((b) => b.zone === zone).map((b) => b.block),
      );
      for (const [index, box] of boxes.entries()) {
        const { code, raw } = await readBlockAt(
          box,
          candidates,
          zone,
          join(workDir, `${zone}-${index}`),
        );
        if (!code) {
          unreadable.push({ zone, box, raw });
          continue;
        }
        const previous = assigned.get(code);
        if (previous) {
          unreadable.push({ zone, box, raw, note: `duplicate of ${code}` });
          continue;
        }
        assigned.set(code, { box, zone });
      }
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  const missing = [...expected.keys()].filter((block) => !assigned.has(block));
  const unlisted = [...assigned.keys()].filter((block) => !expected.has(block));
  console.log(
    `\nledger blocks resolved ${expected.size - missing.length}/${expected.size}` +
      ` · ${unlisted.length} booths printed but not listed` +
      ` · ${unreadable.length} rects unlabelled`,
  );
  if (unlisted.length) {
    console.log(`   unlisted: ${unlisted.sort().join(' ')}`);
  }
  if (unreadable.length) {
    console.log('\nunlabelled rects (expected: one legend swatch per zone):');
    for (const { zone, box, raw, note } of unreadable) {
      console.log(
        `   ${zone} ${String(box.x1 - box.x0).padStart(3)}x${String(box.y1 - box.y0).padStart(3)} at (${box.x0},${box.y0}) ocr=${JSON.stringify(raw)}${note ? ` ${note}` : ''}`,
      );
    }
  }
  if (missing.length) {
    console.log(`\nledger blocks with no rect (${missing.length}):`);
    console.log(`   ${missing.join(' ')}`);
  }

  if (missing.length) {
    console.error('\nrefusing to write: every ledger block needs a rect');
    process.exitCode = 1;
    return;
  }

  // Every rect that resolved to a code goes in, including the booths the ledger
  // does not list -- those are real stands and render as unlisted ghosts, so
  // dropping them would leave holes in the floor plan.
  const blocks = [...assigned.entries()]
    .map(([code, { box, zone }]) => ({
      block: code,
      zone,
      x: box.x0,
      y: box.y0,
      width: box.x1 - box.x0,
      height: box.y1 - box.y0,
      booths: [...(expected.get(code)?.booths ?? [])].sort(),
    }))
    .sort((a, b) => a.block.localeCompare(b.block, 'en'));

  const ledger = JSON.parse(readFileSync(LEDGER, 'utf8'));
  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        eventSlug: ledger.eventSlug,
        source: {
          derivedFrom: 'public/images/events/taiwan-creative-expo-2026-floor-map.webp',
          script: 'scripts/extract-expo-block-geometry.mjs',
        },
        viewBox: `0 0 ${width} ${height}`,
        blocks,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\nwrote ${OUT} (${blocks.length} blocks)`);

  if (process.env.VERIFY === '1') await writeVerificationSheet(blocks, width, height);
}

/**
 * Render each rect outlined with the code that was *assigned* to it, over the
 * original map. Laid beside the real map this makes a mis-assignment visible at
 * a glance -- which matters because no automatic check can catch a swapped pair
 * of labels: it satisfies coverage, uniqueness, overlap and zone containment
 * alike, and this floor plan has no ordering invariant strong enough to test.
 */
async function writeVerificationSheet(blocks, width, height) {
  const escape = (value) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${blocks
    .map(
      (block) =>
        `<rect x="${block.x}" y="${block.y}" width="${block.width}" height="${block.height}" fill="none" stroke="${
          block.booths.length ? '#d81b60' : '#1e88e5'
        }" stroke-width="3"/>` +
        `<text x="${block.x + block.width / 2}" y="${block.y + block.height - 3}" font-family="monospace" font-size="13" font-weight="bold" text-anchor="middle" fill="#b00020">${escape(block.block)}</text>`,
    )
    .join('')}</svg>`;

  // Deliberately outside the repo: it is a review aid regenerated on demand,
  // not an artifact, and it is a full-size render of the map.
  const target = join(tmpdir(), 'expo-block-geometry-verify.png');
  await sharp(MAP_IMAGE)
    .composite([{ input: Buffer.from(overlay), top: 0, left: 0 }])
    .png()
    .toFile(target);
  console.log(`wrote ${target} (pink = listed, blue = unlisted)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
