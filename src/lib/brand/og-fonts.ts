import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImageResponse } from "next/og";

type ImageResponseOptions = NonNullable<
  ConstructorParameters<typeof ImageResponse>[1]
>;

type OgFonts = NonNullable<ImageResponseOptions["fonts"]>;

const MARK_PATH = "src/assets/brand/formoria-mark.png";
const BRICOLAGE_PATH = "src/assets/fonts/BricolageGrotesque-Latin.ttf";
const NOTO_SANS_TC_PATH = "src/assets/fonts/NotoSansTC-subset.ttf";

/**
 * THESE ASSETS ARE READ ONCE PER PROCESS, NOT ONCE PER RENDER.
 *
 * Before the design system v2 rebuild, every OG render re-read a 958,836-byte
 * TTF and a 69,889-byte PNG, and re-ran `toString("base64")` over the PNG.
 * Five routes do this — the site card, the brand card, the trust card, the
 * share-card API and the share-card tree — so the cost landed on every social
 * crawl and every share. Nothing about the files varies per request, so the
 * only reason it was per-render is that `readFileSync` sat inside the function.
 *
 * The cache holds a PROMISE rather than a value, which is what makes
 * concurrent renders share one read instead of racing into several.
 *
 * A FAILURE IS NEVER CACHED. A permanently cached `[]` would turn one bad
 * read — a momentary EMFILE under load is the realistic one — into a process
 * that serves fontless OG images until it is restarted.
 */
let markCache: Promise<string> | null = null;
let fontsCache: Promise<OgFonts> | null = null;

export function getOgMarkDataUri(): Promise<string> {
  if (!markCache) {
    const pending = readFile(join(process.cwd(), MARK_PATH)).then(
      (data) => `data:image/png;base64,${data.toString("base64")}`,
    );

    // Attached only to clear the cache. The caller still sees the rejection,
    // because it is `pending` that is returned, not this handler's promise.
    pending.catch(() => {
      if (markCache === pending) markCache = null;
    });

    markCache = pending;
  }

  return markCache;
}

export function getOgFonts(): Promise<OgFonts> {
  if (!fontsCache) {
    fontsCache = loadOgFonts().then((fonts) => {
      if (fonts.length === 0) fontsCache = null;
      return fonts;
    });
  }

  return fontsCache;
}

/**
 * D17 — sans only. Satori has to be handed font FILES, so a 明體 face here is
 * not a stylesheet line but a third megabyte on disk and in memory. The OG
 * routes align with v2 through colour, spacing and layout instead.
 */
async function loadOgFonts(): Promise<OgFonts> {
  try {
    const [bricolageData, notoSansTcData] = await Promise.all([
      readFile(join(process.cwd(), BRICOLAGE_PATH)),
      readFile(join(process.cwd(), NOTO_SANS_TC_PATH)),
    ]);

    return [
      {
        name: "Bricolage Grotesque",
        data: bricolageData,
        style: "normal",
        weight: 700,
      },
      {
        name: "Noto Sans TC",
        data: notoSansTcData,
        style: "normal",
        weight: 700,
      },
    ];
  } catch (error) {
    console.warn("Failed to load OG fonts; falling back to []", error);
    return [];
  }
}
