import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A `not-found` boundary without its own metadata inherits the homepage
 * title, canonical and hreflang from `[locale]/(site)/layout.tsx`, so a 404
 * claims `/` as its canonical (SP-34, SP2-03). Every boundary under
 * `[locale]` must therefore export `generateMetadata` built from
 * `buildNotFoundMetadata`. Structural, like `not-found-locale-resolution`:
 * no unit test can render a boundary's merged metadata.
 */

const LOCALE_DIR = join(process.cwd(), "src/app/[locale]");

function notFoundFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return notFoundFiles(path);
    return /^not-found\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("not-found boundaries replace the inherited homepage metadata", () => {
  const files = notFoundFiles(LOCALE_DIR);

  it("finds the story and style boundaries", () => {
    const relative = files.map((file) => file.replace(`${LOCALE_DIR}/`, ""));
    expect(relative).toEqual(
      expect.arrayContaining([
        "(site)/stories/[slug]/not-found.tsx",
        "(site)/style/[slug]/not-found.tsx",
      ]),
    );
  });

  it("gives every boundary not-found metadata", () => {
    const offenders = files
      .map((file) => ({ file, source: readFileSync(file, "utf8") }))
      .filter(
        ({ source }) =>
          !/export\s+async\s+function\s+generateMetadata\b/.test(source) ||
          !/\bbuildNotFoundMetadata\(/.test(source),
      )
      .map(({ file }) => file.replace(`${process.cwd()}/`, ""));

    expect(offenders).toEqual([]);
  });
});
