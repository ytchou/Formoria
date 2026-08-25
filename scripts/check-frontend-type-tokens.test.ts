import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { collectSources } from "../src/test/source-scan";
import {
  allowedMatches,
  collectFrontendTokenFailures,
  collectRetiredNameFailures,
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
      // `text-[13px]` in a microsite component (parked in DEV-1570), which
      // kept passing after the literal — and then the row — left the tree, so
      // it was guarding a permission the codebase no longer had.
      '<code className="text-[0.85em]">x</code>',
    );
    writeFixture(
      cwd,
      "src/components/brands/share-dialog-content.tsx",
      // Exercises the brand-mark values allowlisted for this file (both
      // brand-disc hex classes, all four Instagram gradient hexes, and the
      // arbitrary text size) so deleting any of them from the allowlist turns
      // this red. It no longer carries a `max-w-[…]`: the share panel names its
      // width with `size="compact"` and holds no width literal to permit.
      '<span className="bg-[#06C755] bg-[#1877F2] md:text-[13px] text-[#123456]" ' +
        'style={{ backgroundImage: "radial-gradient(#FDF497, #FD5949, #D6249F, #285AEB)" }} />',
    );
    writeFixture(
      cwd,
      "src/components/ui/dialog.tsx",
      // The width half of the same proof, repointed here when the three share
      // rows went. `max-w-[calc(100%-2rem)]` is a real "unnamed page width"
      // match that only the surviving `ui/dialog.tsx` row suppresses — delete
      // that row and the assertion below goes to three. The width allowlist is
      // down to two rows, so it needs a live fixture of its own or nothing
      // would notice the last one rotting.
      '<div className="sm:max-w-[calc(100%-2rem)]" />',
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

  /**
   * The same rule, spelled the other way: an inline `ui-exception` disable is a
   * grandfather block of one. `src/components/ui/**` is exempt from the lint
   * rule outright, so a primitive there never needs a directive either.
   */
  it("no ui-exception disable comments survive anywhere in src", () => {
    const offenders = collectSources("src").filter((file) =>
      readFileSync(file, "utf8").includes("ui-exception"),
    );

    expect(offenders.map((file) => relative(projectRoot, file))).toEqual([]);
  });
});

/**
 * DESIGN.md: "No monospace face ships." v2 dropped Geist Mono rather than carry
 * an undocumented third face, and admin renders field identifiers in 黑體.
 *
 * Code is the single amendment: character alignment is what a code block is
 * for. That exception is bounded to the MDX renderers and this keeps it there —
 * it had already leaked to a verification code chip, a share URL field and a
 * chart tooltip, none of which is code, and all of which wanted `tabular-nums`.
 */
describe("type faces", () => {
  it("monospace appears only in the MDX code renderers", () => {
    const offenders = collectSources("src")
      .filter((file) => readFileSync(file, "utf8").includes("font-mono"))
      .map((file) => relative(projectRoot, file));

    expect(offenders.every((f) => f.startsWith("src/lib/mdx/"))).toBe(true);
    expect(offenders.length).toBeGreaterThan(0);
  });
});

describe("retired design-system names", () => {
  it("flags retired v1 type names in source files", () => {
    const cwd = mkdtempSync(join(tmpdir(), "frontend-tokens-"));
    writeFixture(
      cwd,
      "src/components/example.tsx",
      '<p className="type-hero">Bad</p>',
    );
    writeFixture(
      cwd,
      "src/components/clean.tsx",
      '<p className="type-body">Good</p>',
    );

    const failures = collectRetiredNameFailures({ cwd });
    expect(failures).toEqual([
      expect.objectContaining({ name: "retired type name", value: "type-hero" }),
    ]);
  });

  it("flags retired color utilities in source files", () => {
    const cwd = mkdtempSync(join(tmpdir(), "frontend-tokens-"));
    writeFixture(
      cwd,
      "src/components/example.tsx",
      '<div className="bg-primary text-cta-foreground">Bad</div>',
    );
    writeFixture(
      cwd,
      "src/components/clean.tsx",
      '<div className="bg-accent">Good</div>',
    );

    const failures = collectRetiredNameFailures({ cwd });
    expect(
      failures.some(
        (f) => f.name === "retired color utility" && f.value === "bg-primary",
      ),
    ).toBe(true);
    expect(
      failures.some(
        (f) =>
          f.name === "retired color utility" &&
          f.value === "text-cta-foreground",
      ),
    ).toBe(true);
  });
});
