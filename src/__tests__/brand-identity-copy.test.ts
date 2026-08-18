import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

import en from "../../messages/en.json";
import zhTW from "../../messages/zh-TW.json";

const USER_FACING_ROOTS = [
  // The voice pack feeds AI story drafting, so a stale mission sentence there
  // reproduces itself into every future draft. `configs/` is covered as a whole
  // directory, not one file: a sixth copy of the retired sentence hid in
  // `configs/discovery-trail.md` and was found only during DEV-1486.
  ".claude/skills/write-stories/configs",
  ".claude/skills/write-stories/voice/brand-rules.md",
  "README.md",
  "content",
  "docs/designs/newsletter-capture",
  "docs/designs/pen",
  "docs/designs/ux/DESIGN.md",
  "docs/designs/wireframe",
  "emails",
  "marketing",
  "messages",
  "public",
  "scripts/fonts",
  "scripts/normalize-product-tags.ts",
  "src/app",
  "src/components",
  "src/lib",
];

const TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".json",
  ".md",
  ".mdx",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
]);

const RETIRED_IDENTITY_PATTERNS = [
  /島藏/u,
  /岛藏/u,
  /community-curated Taiwanese brand directory/iu,
  /Made in Taiwan Brand Directory/iu,
  /台灣製造品牌目錄/u,
];

/**
 * The retired mission sentence (DEV-1486). It described a funnel — 靈感 → 購買 —
 * and implied Formoria owns the purchase step, which the mission refuses. It was
 * removed from six locations at once.
 *
 * Matched by fragment, not by full sentence, because inflection is exactly what
 * hid two of those six copies: `README.md` said "Formoria **reconnects** the
 * broken path" and `configs/discovery-trail.md` said "**repairs** the broken
 * path". Banning the noun phrase "broken path" catches every verb.
 *
 * The sanctioned replacement is 「把相遇之後的路接起來」 / "reconnects the path after
 * that moment" — so the bare word "reconnects" is deliberately NOT banned here.
 */
const RETIRED_MISSION_PATTERNS = [
  /把從靈感走到購買中間斷掉的路/u,
  /斷掉的路/u,
  /broken path/iu,
];

/**
 * Unmethodised superlatives and urgency CTAs (`docs/strategy/brand-voice.md`,
 * hard vocabulary rules). All five have ZERO occurrences in either catalogue
 * today — this is a forward-looking regression guard, not a finder of current
 * problems.
 *
 * 限時, 最好 and 最佳 are deliberately EXCLUDED, and re-adding them is a
 * regression, not an improvement: 限時 false-positives on 「限時動態」 (Instagram
 * Stories) and 最好 on `feedback.submit.detailsHint`, where it means
 * "preferably". Banning an ambiguous term would force an allowlist; these five
 * unambiguous phrases need none. They stay editorially discouraged either way —
 * they are simply not machine-gated.
 */
const BANNED_SALES_PHRASES = ["必買", "首選", "人氣第一", "立即購買", "搶購"];

/** The canonical promise derivative that ships in the footer. */
const FOOTER_PROMISE = {
  "zh-TW": "生活可以更像自己一點",
  en: "Life can look a little more like you",
} as const;

const CATALOGUES = {
  "zh-TW": zhTW as unknown as Record<string, unknown>,
  en: en as unknown as Record<string, unknown>,
} as const;

function catalogueStrings(node: unknown, path = ""): [string, string][] {
  if (typeof node === "string") return [[path, node]];
  if (Array.isArray(node)) {
    return node.flatMap((value, index) =>
      catalogueStrings(value, `${path}[${index}]`),
    );
  }
  if (node && typeof node === "object") {
    return Object.entries(node).flatMap(([key, value]) =>
      catalogueStrings(value, path ? `${path}.${key}` : key),
    );
  }
  return [];
}

function textFiles(root: string): string[] {
  if (!existsSync(root)) return [];

  if (!statSync(root).isDirectory()) {
    return TEXT_EXTENSIONS.has(extname(root)) ? [root] : [];
  }

  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return textFiles(path);
    return TEXT_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
  });
}

describe("Formoria brand identity", () => {
  it("uses Formoria as the sole name across public and generated copy", () => {
    const matches = USER_FACING_ROOTS.flatMap((root) =>
      textFiles(root).flatMap((path) => {
        const content = readFileSync(path, "utf8");
        return RETIRED_IDENTITY_PATTERNS.flatMap((pattern) =>
          pattern.test(content) ? [`${path}: ${pattern.source}`] : [],
        );
      }),
    );

    expect(matches).toEqual([]);
  });

  it("bans unmethodised superlatives and urgency CTAs", () => {
    const matches = Object.entries(CATALOGUES).flatMap(([locale, catalogue]) =>
      catalogueStrings(catalogue).flatMap(([key, value]) =>
        BANNED_SALES_PHRASES.filter((phrase) => value.includes(phrase)).map(
          (phrase) => `${locale} ${key}: ${phrase}`,
        ),
      ),
    );

    expect(matches).toEqual([]);
  });

  it("retired identity phrasing is absent", () => {
    const matches = USER_FACING_ROOTS.flatMap((root) =>
      textFiles(root).flatMap((path) => {
        const content = readFileSync(path, "utf8");
        return RETIRED_MISSION_PATTERNS.flatMap((pattern) =>
          pattern.test(content) ? [`${path}: ${pattern.source}`] : [],
        );
      }),
    );

    expect(matches).toEqual([]);
  });

  it("the canonical promise ships in the footer", () => {
    for (const [locale, promise] of Object.entries(FOOTER_PROMISE)) {
      const footer = CATALOGUES[locale as keyof typeof CATALOGUES]
        .footer as Record<string, string>;
      expect(footer.tagline, `${locale} footer.tagline`).toBe(promise);
    }
  });
});
