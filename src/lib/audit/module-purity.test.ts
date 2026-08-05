import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const AUDIT_DIR = join(process.cwd(), "src/lib/audit");

/**
 * Matches top-level import statements only:
 *   import "x";
 *   import a from "x";
 *   import { a,
 *            b } from "x";
 *
 * Deliberately does NOT match dynamic `await import("next/server")` — the `^`
 * anchor plus the required whitespace after `import` excludes call-expression
 * form, which is the permitted escape hatch for Next-only APIs.
 */
const TOP_LEVEL_IMPORT = /^import\s+(?:[^;]*?\sfrom\s+)?["']([^"']+)["']/gm;

function sourceFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (entry.name.endsWith(".ts") && !entry.name.includes(".test.")) {
      files.push(path);
    }
  }

  return files;
}

function topLevelImports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(TOP_LEVEL_IMPORT)].map((match) => match[1]!);
}

function offenders(isViolation: (specifier: string) => boolean): string[] {
  const found: string[] = [];

  for (const file of sourceFiles(AUDIT_DIR)) {
    for (const specifier of topLevelImports(file)) {
      if (isViolation(specifier)) {
        found.push(`${file.slice(AUDIT_DIR.length + 1)}: ${specifier}`);
      }
    }
  }

  return found;
}

describe("audit module purity", () => {
  it("audit module has no static next imports", () => {
    // The audit module must load in a plain `tsx` worker process, where
    // `next/*` is unavailable. Dynamic import inside a function body is fine.
    expect(offenders((specifier) => specifier === "next" || specifier.startsWith("next/"))).toEqual([]);
  });

  it("audit module has no formoria-specific imports", () => {
    // The audit module must stay formoria-agnostic: no reaching into the
    // service layer or UI components.
    expect(
      offenders(
        (specifier) => specifier.startsWith("@/lib/services/") || specifier.startsWith("@/components/"),
      ),
    ).toEqual([]);
  });
});
