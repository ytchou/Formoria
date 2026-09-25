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
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { readdirSync } from "node:fs";

const ROOTS = ["src", "scripts", "supabase/functions"];
const TEST_FILE = /\.(?:test|spec)\.(?:ts|tsx)$/;
const MOCK_CALL = /vi\.(?:doMock|mock)\(\s*['"]([^'"]+)['"]/g;
const FORBIDDEN_TARGET = /^src\/lib\/(?:services|supabase)(?:\/|$)/;

// Modules that ARE the external boundary and may be mocked.
// llm-audit wraps the OpenAI client adapter, so mocking it stands in for the
// network call, not for internal business logic.
const BOUNDARY_ALLOWLIST = new Set(["src/lib/services/llm-audit"]);

// Pre-existing relative-path mocks of internal modules, recorded when the
// guard learned to resolve relative specifiers (DEV-1864). Listed per file AND
// specifier so new mocks in these files still fail. Shrink this, never grow it.
const PRE_EXISTING_VIOLATIONS = new Map(
  Object.entries({
    "src/lib/services/__tests__/brand-embeddings.test.ts": ["../brands"],
    "src/lib/services/__tests__/curation-operations-waves.test.ts": [
      "../category-classifier",
      "../enrich-phases/scraper/search",
      "../enrich-phases/scraper",
      "../search-results",
      "../enrich-phases/acquire",
      "../enrich-phases/editorial/graph",
      "../enrich-phases/descriptions",
      "../enrich-phases/stockists",
      "../enrich-phases/faq",
      "../enrich-phases/discover",
      "../enrich-phases/site-identity",
      "../enrich-phases/gather",
      "../enrich-phases/link-expansion",
      "../enrich-phases/scraper/serper",
      "../_shared/ai-results",
      "../enrich-phases/scraper/fetch-guards",
      "../enrich-phases/names",
      "../enrich-phases/products",
      "../_shared/concurrency",
      "../enrich-blocks/phase-outputs",
    ],
    "src/lib/services/__tests__/curation-operations.test.ts": ["../category-classifier"],
    "src/lib/services/brand-images.test.ts": ["./image-upload"],
    "src/lib/services/enrich-phases/__tests__/acquire.test.ts": [
      "../scraper",
      "../acquisition/graph",
    ],
    "src/lib/services/enrich-phases/__tests__/detect.test.ts": ["../../category-classifier"],
    "src/lib/services/enrich-phases/__tests__/discover.test.ts": ["../scraper/search"],
    "src/lib/services/enrich-phases/__tests__/faq.test.ts": [
      "../../brands",
      "../../brand-peer-stats",
      "../descriptions",
      "../../brand-faq",
      "../../stockists",
    ],
    "src/lib/services/enrich-phases/__tests__/image-search.test.ts": ["../scraper/search"],
    "src/lib/services/enrich-phases/__tests__/images-catalog.test.ts": [
      "../scraper",
      "../acquisition/graph",
    ],
    "src/lib/services/enrich-phases/__tests__/names.test.ts": ["../../name-arbiter"],
    "src/lib/services/enrich-phases/__tests__/site-identity.test.ts": ["../../site-identity-arbiter"],
    "src/lib/services/enrich-phases/scraper/__tests__/platform-adapter.test.ts": ["../fetch-guards"],
    "src/lib/services/llm-audit.test.ts": ["./llm-pricing"],
  }).map(([file, specifiers]) => [file, new Set(specifiers)]),
);

/** Repo-relative module path a mock specifier points at, or null if external. */
function mockTarget(file, specifier) {
  let target;
  if (specifier.startsWith("@/")) target = join("src", specifier.slice(2));
  else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    target = relative(".", resolve(dirname(file), specifier));
  } else return null;
  return target.split(sep).join("/").replace(/\.(?:[cm]?[jt]sx?)$/, "");
}

function isForbiddenMock(file, specifier) {
  if (specifier.startsWith("@supabase/")) return true;
  const target = mockTarget(file, specifier);
  if (!target || !FORBIDDEN_TARGET.test(target)) return false;
  if (BOUNDARY_ALLOWLIST.has(target)) return false;
  const known = PRE_EXISTING_VIOLATIONS.get(relative(".", file).split(sep).join("/"));
  return !known?.has(specifier);
}
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
    for (const match of source.matchAll(MOCK_CALL)) {
      if (!isForbiddenMock(file, match[1])) continue;
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
