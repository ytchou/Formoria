import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

const USER_FACING_ROOTS = [
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

function textFiles(root: string): string[] {
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
});
