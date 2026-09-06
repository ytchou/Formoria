/**
 * @formoria-script
 * purpose: Fails the build when a test mocks Supabase or the service layer, or uses placeholder fixtures.
 * class: ci-gate
 * invoke: pnpm check:test-boundaries
 * target: none
 * safety: read-only
 * owner: engineering
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { readdirSync } from "node:fs";

const ROOTS = ["src", "scripts", "supabase/functions"];
const TEST_FILE = /\.(?:test|spec)\.(?:ts|tsx)$/;
const FORBIDDEN_MOCK =
  /vi\.(?:doMock|mock)\(\s*['"](?:@\/lib\/services\/|@\/lib\/supabase\/|@supabase\/)/g;
const PLACEHOLDER_FIXTURE =
  /['"](?:brand-1|user-1|test-brand|test@example\.com)['"]/g;

function testFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...testFiles(path));
    else if (TEST_FILE.test(path) && [".ts", ".tsx"].includes(extname(path))) {
      files.push(path);
    }
  }
  return files;
}

const violations = [];
for (const root of ROOTS) {
  if (!existsSync(root)) continue;
  for (const file of testFiles(root)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(FORBIDDEN_MOCK)) {
      const line = source.slice(0, match.index).split("\n").length;
      violations.push(`${relative(".", file)}:${line}`);
    }
    if (file.includes(".integration.test.")) {
      for (const match of source.matchAll(PLACEHOLDER_FIXTURE)) {
        const line = source.slice(0, match.index).split("\n").length;
        violations.push(`${relative(".", file)}:${line} (placeholder fixture)`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error("Tests may not mock Supabase or internal services:");
  console.error(violations.join("\n"));
  process.exitCode = 1;
}
