import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  allowedMatches,
  collectFrontendTokenFailures,
} from "./check-frontend-type-tokens.mjs";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function writeFixture(cwd: string, file: string, source: string) {
  const path = join(cwd, file);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, source);
}

describe("check-frontend-type-tokens", () => {
  it("flags direct frontend typography and raw color drift", () => {
    const cwd = mkdtempSync(join(tmpdir(), "frontend-tokens-"));

    writeFixture(
      cwd,
      "src/components/example.tsx",
      '<p className="font-heading text-[22px] bg-[#FFFFFF]">Bad</p>',
    );

    expect(collectFrontendTokenFailures({ cwd })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "direct heading font" }),
        expect.objectContaining({ name: "arbitrary numeric text size" }),
        expect.objectContaining({ name: "raw hex color class" }),
      ]),
    );
  });

  it("scans TypeScript design source files", () => {
    const cwd = mkdtempSync(join(tmpdir(), "frontend-tokens-"));

    writeFixture(
      cwd,
      "src/components/ui/text-styles.ts",
      'export const bad = "font-heading text-[22px] bg-[#FFFFFF]"',
    );

    expect(collectFrontendTokenFailures({ cwd })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "src/components/ui/text-styles.ts",
          name: "direct heading font",
        }),
        expect.objectContaining({
          file: "src/components/ui/text-styles.ts",
          name: "arbitrary numeric text size",
        }),
      ]),
    );
  });

  it("allows only explicit platform and brand-accent exceptions", () => {
    const cwd = mkdtempSync(join(tmpdir(), "frontend-tokens-"));

    writeFixture(
      cwd,
      "src/components/auth/google-button.tsx",
      '<path fill="#4285F4" />',
    );
    writeFixture(
      cwd,
      "src/lib/mdx/components.ts",
      // Proves a LIVE allowlist row still suppresses a real match. The
      // em-relative MDX code face is an "arbitrary numeric text size" that only
      // the `src/lib/mdx/components.ts` row permits; delete that row and the
      // assertion below goes to three. This fixture used to manufacture
      // `text-[13px]` in `microsite/contact-cta.tsx`, which kept passing after
      // the literal — and then the row — left the real tree, so the test was
      // guarding a permission the codebase no longer had.
      '<code className="text-[0.85em]">x</code>',
    );
    writeFixture(
      cwd,
      "src/components/brands/share-dialog-content.tsx",
      // Exercises every allowlisted value for this file (both brand-disc hex
      // classes, all four Instagram gradient hexes, and the arbitrary text
      // size) so deleting any of them from the allowlist turns this red.
      '<span className="bg-[#06C755] bg-[#1877F2] md:text-[13px] text-[#123456]" ' +
        'style={{ backgroundImage: "radial-gradient(#FDF497, #FD5949, #D6249F, #285AEB)" }} />',
    );

    expect(collectFrontendTokenFailures({ cwd })).toEqual([
      expect.objectContaining({
        file: "src/components/brands/share-dialog-content.tsx",
        name: "raw hex color class",
        value: "text-[#123456]",
      }),
      expect.objectContaining({
        file: "src/components/brands/share-dialog-content.tsx",
        name: "raw hex color literal",
        value: "#123456",
      }),
    ]);
  });

  it("flags hand-picked text-size + font-weight combos outside ui/", () => {
    const cwd = mkdtempSync(join(tmpdir(), "frontend-tokens-"));

    writeFixture(
      cwd,
      "src/components/brands/sample.tsx",
      '<span className="text-sm font-medium text-foreground">x</span>',
    );

    const failures = collectFrontendTokenFailures({ cwd });
    expect(failures.some((f) => f.name === "raw-type-combo")).toBe(true);
  });

  it("flags direct standard text sizes outside ui/", () => {
    const cwd = mkdtempSync(join(tmpdir(), "frontend-tokens-"));

    writeFixture(
      cwd,
      "src/components/brands/sample.tsx",
      '<span className="text-sm text-muted-foreground">x</span>',
    );

    const failures = collectFrontendTokenFailures({ cwd });
    expect(failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "direct text size",
          value: "text-sm",
        }),
      ]),
    );
  });

  it("accepts type-label as a compliant role (no raw-type-combo flag)", () => {
    const cwd = mkdtempSync(join(tmpdir(), "frontend-tokens-"));
    writeFixture(
      cwd,
      "src/components/admin/sample.tsx",
      '<span className="type-label">高風險</span>',
    );
    const failures = collectFrontendTokenFailures({ cwd });
    expect(failures.some((f) => f.name === "raw-type-combo")).toBe(false);
    expect(failures.some((f) => f.name === "direct text size")).toBe(false);
  });

  it("does not flag combos inside ui/ primitives", () => {
    const cwd = mkdtempSync(join(tmpdir(), "frontend-tokens-"));

    writeFixture(cwd, "src/components/ui/button.tsx", '"text-sm font-medium"');

    const failures = collectFrontendTokenFailures({ cwd });
    expect(failures.some((f) => f.name === "raw-type-combo")).toBe(false);
  });
});

/**
 * An allowlist entry for a file that no longer exists fails nothing — which is
 * exactly why three of them rotted here and in `eslint.config.mjs` unnoticed.
 * A stale entry is not inert: it is a standing permission that will silently
 * apply again the day someone recreates the path.
 */
describe("allowlist hygiene", () => {
  it("no frontend-token allowlist entry points at a missing file", () => {
    const missing = allowedMatches
      .map((entry: { file: string }) => entry.file)
      .filter((file: string) => !existsSync(join(projectRoot, file)));

    expect(missing).toEqual([]);
  });

  it("no eslint grandfather entry points at a missing file", () => {
    // Read as text rather than imported: loading the flat config pulls in every
    // eslint plugin, and this assertion needs one array of strings.
    const config = readFileSync(join(projectRoot, "eslint.config.mjs"), "utf8");
    const block = config.slice(config.indexOf("Grandfather block:"));
    const files = [...block.matchAll(/"(src\/[^"]+\.tsx?)"/g)].map(
      (match) => match[1],
    );

    expect(files.length).toBeGreaterThan(0);
    expect(
      files.filter((file) => !existsSync(join(projectRoot, file))),
    ).toEqual([]);
  });
});
