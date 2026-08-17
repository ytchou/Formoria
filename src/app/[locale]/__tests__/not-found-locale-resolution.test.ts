import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Next renders a segment's `not-found` boundary as part of that segment's
 * static shell, so the boundary is evaluated on EVERY render — including the
 * successful ones. When a boundary resolves its locale implicitly, next-intl
 * falls back to `headers()`, and a dynamic API inside an on-demand static
 * render throws DYNAMIC_SERVER_USAGE: the page 500s even though `notFound()`
 * was never called. That is DEV-1493 on `/[locale]/discover/[slug]`.
 *
 * Neither a unit test nor an e2e test can execute that failure — `next dev`
 * does not enforce the static/dynamic boundary and served the broken page 200
 * throughout. So the guard is structural, in the style of
 * `src/lib/audit/module-purity.test.ts`.
 */

const LOCALE_DIR = join(process.cwd(), "src/app/[locale]");

/** Any next-intl import pulls in a translation API that can resolve a locale. */
const IMPORTS_NEXT_INTL = /^import\s[^;]*?\sfrom\s+["']next-intl(?:\/server)?["']/m;

/**
 * The directive must come before any statement, but comments may precede it —
 * and here one does, explaining why the boundary is a client component.
 */
const USE_CLIENT = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use client["']/;

/**
 * Implicit locale resolution. Both forms below reach for `headers()`:
 *   getTranslations("ns")      getTranslations()
 *   useTranslations("ns")      getTranslations({ namespace: "ns" })
 * Only `getTranslations({ locale, ... })` names the locale outright, so the
 * argument list has to mention `locale` for the call to be safe.
 */
const TRANSLATION_CALL = /\b(?:get|use)Translations\s*\(([^)]*)\)/g;

function notFoundFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...notFoundFiles(path));
    } else if (/^not-found\.tsx?$/.test(entry.name)) {
      files.push(path);
    }
  }

  return files;
}

function resolvesLocaleImplicitly(source: string): boolean {
  return [...source.matchAll(TRANSLATION_CALL)].some(
    (match) => !/\blocale\b/.test(match[1]!)
  );
}

describe("not-found boundaries resolve their locale without headers()", () => {
  const files = notFoundFiles(LOCALE_DIR);

  it("finds the boundaries to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("keeps every next-intl boundary client-side or explicitly localed", () => {
    const offenders = files
      .map((file) => ({ file, source: readFileSync(file, "utf8") }))
      .filter(({ source }) => IMPORTS_NEXT_INTL.test(source))
      .filter(({ source }) => !USE_CLIENT.test(source))
      .filter(({ source }) => resolvesLocaleImplicitly(source))
      .map(({ file }) => file.replace(`${process.cwd()}/`, ""));

    expect(offenders).toEqual([]);
  });
});
