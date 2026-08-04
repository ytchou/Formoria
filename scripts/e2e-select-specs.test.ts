import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  buildReverseImportGraph,
  buildSelectionIndex,
  auditRouteCoverage,
  collectReachableImporters,
  collectSpecRoutes,
  extractImports,
  extractRoutes,
  countTestTags,
  hasTestTag,
  isPageEntrypoint,
  isCodeFile,
  isRouteEntrypoint,
  isSelectableSpec,
  isSubtreeEntrypoint,
  matchesRoute,
  parseRemovedI18nStrings,
  resolveImport,
  routePatternFor,
  selectSelection,
  selectChangedSpecs,
  selectDerivedSpecs,
  selectSpecsForRemovedStrings,
} from "./e2e-select-specs.mjs";

function selectionFixture() {
  const files = [
    "src/app/[locale]/(site)/page.tsx",
    "src/app/[locale]/(site)/brands/page.tsx",
    "src/app/[locale]/(site)/faq/page.tsx",
    "src/app/[locale]/layout.tsx",
    "src/components/brands/brand-list.tsx",
    "src/lib/format.ts",
    "src/proxy.ts",
    "e2e/tests/landing.spec.ts",
    "e2e/tests/directory.spec.ts",
  ];
  const sourceByFile = new Map([
    [
      "src/app/[locale]/(site)/page.tsx",
      "import '@/components/brands/brand-list'",
    ],
    [
      "src/app/[locale]/(site)/brands/page.tsx",
      "import '@/components/brands/brand-list'",
    ],
    [
      "src/app/[locale]/(site)/faq/page.tsx",
      "export default function Page() {}",
    ],
    ["src/app/[locale]/layout.tsx", "export default function Layout() {}"],
    [
      "src/components/brands/brand-list.tsx",
      "import { format } from '@/lib/format'",
    ],
    ["src/lib/format.ts", "export const format = (value) => value"],
    ["src/proxy.ts", "export function proxy() {}"],
    [
      "e2e/tests/landing.spec.ts",
      "import { test } from '@playwright/test'\ntest('@smoke landing renders', async ({ page }) => { await page.goto('/') })",
    ],
    [
      "e2e/tests/directory.spec.ts",
      "import { test } from '@playwright/test'\ntest('@smoke directory renders', async ({ page }) => { await page.goto('/brands') })",
    ],
  ]);
  const fileSet = new Set(files);
  return buildSelectionIndex(files, sourceByFile, (file: string) =>
    fileSet.has(file),
  );
}

describe("targeted PR selection contract", () => {
  it("recognizes page entrypoints and test tags", () => {
    expect(isPageEntrypoint("src/app/[locale]/brands/page.tsx")).toBe(true);
    expect(isPageEntrypoint("src/app/api/search/route.ts")).toBe(false);
    expect(hasTestTag("test('@smoke renders')", "@smoke")).toBe(true);
    expect(hasTestTag("test('renders')", "@smoke")).toBe(false);
    expect(
      countTestTags(
        [
          "test('@smoke first')",
          "test('unmarked')",
          "test.serial('@smoke second')",
          "test.describe('@smoke group', () => {})",
        ].join("\n"),
        "@smoke",
      ),
    ).toBe(2);
  });

  it("selects only the mapped smoke spec for a route-local page change", () => {
    const result = selectSelection(
      ["src/app/[locale]/(site)/brands/page.tsx"],
      selectionFixture(),
    );

    expect(result.affected_routes).toEqual(["/brands"]);
    expect(result.smoke_specs).toEqual(["e2e/tests/directory.spec.ts"]);
    expect(result.smoke_test_count).toBe(1);
    expect(result.uncovered_routes).toEqual([]);
    expect(result.cross_browser).toBe(false);
  });

  it("follows a transitive import to the affected route family", () => {
    const result = selectSelection(["src/lib/format.ts"], selectionFixture());

    expect(result.affected_routes).toContain("/brands");
    expect(result.smoke_specs).toContain("e2e/tests/directory.spec.ts");
  });

  it("uses the broad smoke fallback for a shared layout change", () => {
    const result = selectSelection(
      ["src/app/[locale]/layout.tsx"],
      selectionFixture(),
    );

    expect(result.smoke_specs).toEqual([
      "e2e/tests/directory.spec.ts",
      "e2e/tests/landing.spec.ts",
    ]);
    expect(result.smoke_test_count).toBe(2);
  });

  it("selects the compatibility journey for browser-sensitive shared changes", () => {
    const result = selectSelection(["src/proxy.ts"], selectionFixture());

    expect(result.cross_browser).toBe(true);
    expect(result.cross_browser_reasons).toEqual([
      "src/proxy.ts: navigation proxy behavior",
    ]);
  });

  it("does not select cross-browser for an ordinary route change", () => {
    const result = selectSelection(
      ["src/app/[locale]/(site)/faq/page.tsx"],
      selectionFixture(),
    );

    expect(result.cross_browser).toBe(false);
  });

  it.each([
    ["docs/e2e-policy.md"],
    ["scripts/reindex-brands.ts"],
    ["backend/providers/search/adapter.py"],
  ])("selects no E2E work for unrelated %s", (file) => {
    const result = selectSelection([file], selectionFixture());

    expect(result.smoke_specs).toEqual([]);
    expect(result.smoke_test_count).toBe(0);
    expect(result.affected_routes).toEqual([]);
    expect(result.cross_browser).toBe(false);
  });

  it("reports an affected route without smoke coverage", () => {
    const result = selectSelection(
      ["src/app/[locale]/(site)/faq/page.tsx"],
      selectionFixture(),
    );

    expect(result.uncovered_routes).toEqual(["/faq"]);
    expect(result.smoke_specs).toEqual([]);
  });

  it("keeps added and renamed page routes visible in the coverage audit", () => {
    const index = selectionFixture();
    const audit = auditRouteCoverage(index);

    expect(audit.routes).toContain("/");
    expect(audit.routes).toContain("/brands");

    const addedRouteIndex = buildSelectionIndex(
      ["src/app/[locale]/(site)/renamed/page.tsx", "e2e/tests/landing.spec.ts"],
      new Map([
        [
          "src/app/[locale]/(site)/renamed/page.tsx",
          "export default function Page() {}",
        ],
        [
          "e2e/tests/landing.spec.ts",
          "test('@smoke landing', async ({ page }) => { await page.goto('/') })",
        ],
      ]),
      (file: string) =>
        file === "src/app/[locale]/(site)/renamed/page.tsx" ||
        file === "e2e/tests/landing.spec.ts",
    );
    expect(auditRouteCoverage(addedRouteIndex).uncovered_routes).toEqual([
      "/renamed",
    ]);
  });
});

describe("selective E2E workflow project routing", () => {
  it("runs canonical smoke cases in Chromium and the dedicated journey in all three browsers", () => {
    const workflow = readFileSync(".github/workflows/e2e-pr.yml", "utf8");
    const config = readFileSync("playwright.config.ts", "utf8");

    expect(workflow).toContain(
      "playwright test --project=deep --grep '@smoke'",
    );
    expect(workflow).toContain(
      "SMOKE_TEST_COUNT=$(jq -r '.smoke_test_count' <<< \"$SELECTION\")",
    );
    expect(workflow).toContain("printf -- '- `%s`\\n' \"$spec\"");
    expect(workflow).not.toContain("for spec in $SPECS; do echo");
    expect(workflow).toContain(
      "printf 'Selected @smoke test count: %s\\n' \"$SMOKE_TEST_COUNT\"",
    );
    expect(workflow).not.toContain("Selected smoke spec count:");
    expect(workflow).toContain("--project=cross-browser-chromium");
    expect(workflow).toContain(
      "e2e/tests/landing-search-cross-browser.spec.ts",
    );
    expect(workflow).toContain(
      "cross_browser: ${{ steps.select-specs.outputs.cross_browser }}",
    );
    expect(workflow).toContain("if: needs.select.outputs.has_work == 'true'");
    expect(workflow).not.toContain("smoke-cross-browser");

    expect(config).toMatch(
      /testMatch:\s*["']e2e\/tests\/\*\*\/\*\.spec\.ts["']/,
    );
    expect(config).toMatch(
      /testMatch:\s*["']e2e\/tests\/landing-search-cross-browser\.spec\.ts["']/,
    );
    expect(config).toContain("grep: /@cross-browser/");
    expect(config).not.toMatch(
      /testMatch:\s*["']e2e\/tests\/directory-sort\.spec\.ts["']/,
    );
    expect(config).not.toContain("e2e/smoke");
  });
});

describe("resolveImport", () => {
  const files = new Set([
    "src/components/button.tsx",
    "src/lib/format.ts",
    "src/lib/forms/index.ts",
    "src/app/page.tsx",
  ]);
  const exists = (file: string) => files.has(file);

  it("resolves the repo alias, relative paths, extensions, and index files", () => {
    expect(
      resolveImport("src/app/page.tsx", "@/components/button", exists),
    ).toBe("src/components/button.tsx");
    expect(resolveImport("src/app/page.tsx", "../lib/format", exists)).toBe(
      "src/lib/format.ts",
    );
    expect(resolveImport("src/app/page.tsx", "../lib/forms", exists)).toBe(
      "src/lib/forms/index.ts",
    );
  });

  it("returns null for bare, missing, and outside-repository imports", () => {
    expect(resolveImport("src/app/page.tsx", "next/link", exists)).toBeNull();
    expect(resolveImport("src/app/page.tsx", "./missing", exists)).toBeNull();
    expect(
      resolveImport("src/app/page.tsx", "../../../outside", exists),
    ).toBeNull();
  });
});

describe("extractImports", () => {
  it("extracts static, side-effect, re-export, and dynamic imports", () => {
    const source = [
      "import Button from '@/components/button'",
      "import './globals.css'",
      "export { format } from '../lib/format'",
      "export * from '../lib/forms'",
      "const module = import('./lazy')",
    ].join("\n");

    expect(extractImports(source)).toEqual([
      "@/components/button",
      "./globals.css",
      "../lib/format",
      "../lib/forms",
      "./lazy",
    ]);
  });
});

describe("buildReverseImportGraph", () => {
  it("maps each importee to its importers", () => {
    const files = new Set(["src/page.tsx", "src/card.tsx", "src/format.ts"]);
    const sources = new Map([
      ["src/page.tsx", "import Card from './card'"],
      ["src/card.tsx", "export { format } from './format'"],
      ["src/format.ts", "export const format = () => null"],
    ]);

    expect(
      buildReverseImportGraph([...files], sources, (file: string) =>
        files.has(file),
      ),
    ).toEqual(
      new Map([
        ["src/card.tsx", new Set(["src/page.tsx"])],
        ["src/format.ts", new Set(["src/card.tsx"])],
      ]),
    );
  });
});

describe("collectReachableImporters", () => {
  it("uses breadth-first traversal to include transitive importers and the start file", () => {
    const graph = new Map([
      ["src/format.ts", new Set(["src/card.tsx"])],
      ["src/card.tsx", new Set(["src/app/page.tsx"])],
    ]);

    expect(collectReachableImporters(["src/format.ts"], graph)).toEqual(
      new Set(["src/format.ts", "src/card.tsx", "src/app/page.tsx"]),
    );
  });
});

describe("isRouteEntrypoint", () => {
  it.each([
    ["src/app/[locale]/brands/page.tsx", true],
    ["src/app/api/share-card/[slug]/route.tsx", true],
    ["src/app/layout.tsx", true],
    ["src/app/[locale]/brands/brand-list.tsx", false],
    ["src/app/robots.ts", false],
    ["src/components/brands/page-header.tsx", false],
  ])("classifies %s as %s", (file, expected) => {
    expect(isRouteEntrypoint(file)).toBe(expected);
  });
});

describe("isCodeFile", () => {
  it("accepts supported source extensions and rejects other tracked files", () => {
    expect(isCodeFile("src/app/page.tsx")).toBe(true);
    expect(isCodeFile("e2e/utils/navigation.js")).toBe(true);
    expect(isCodeFile("src/app/globals.css")).toBe(false);
  });
});

describe("isSelectableSpec", () => {
  it("accepts deep and mobile specs and rejects unsupported paths", () => {
    expect(isSelectableSpec("e2e/tests/directory.spec.ts")).toBe(true);
    expect(isSelectableSpec("e2e/tests/mobile.spec.ts")).toBe(true);
    // The selective workflow does not run smoke projects, so a smoke path
    // would filter every selected test out and fail the run.
    expect(isSelectableSpec("e2e/smoke/landing.spec.ts")).toBe(false);
    expect(isSelectableSpec("e2e/utils/submit-form.ts")).toBe(false);
  });
});

describe("routePatternFor", () => {
  it.each([
    ["src/app/[locale]/brands/[slug]/page.tsx", "/brands/[slug]"],
    ["src/app/[locale]/(protected)/dashboard/layout.tsx", "/dashboard"],
    ["src/app/(marketing)/about/template.tsx", "/about"],
    ["src/app/admin/brands/page.tsx", "/admin/brands"],
    ["src/app/api/search/route.ts", "/api/search"],
    ["src/app/page.tsx", "/"],
  ])("turns %s into %s", (entrypoint, pattern) => {
    expect(routePatternFor(entrypoint)).toBe(pattern);
  });
});

describe("extractRoutes", () => {
  it("extracts supported URL calls and normalizes query strings and locales", () => {
    const source = [
      "await page.goto('/brands?sort=name')",
      'await request.get("/en/brands")',
      "await request.post(`/admin/jobs/${jobId}/runlog`)",
      "await request.put('/api/brands/one')",
      "await request.delete('/api/brands/two')",
      "await fetch('/zh-TW/stats?period=week')",
    ].join("\n");

    expect(extractRoutes(source)).toEqual([
      "/brands",
      "/admin/jobs/*/runlog",
      "/api/brands/one",
      "/api/brands/two",
      "/stats",
    ]);
  });

  it("drops the fragment so a section link matches its page", () => {
    // e2e/tests/faq.spec.ts visits '/faq#claim', served by /faq.
    expect(extractRoutes("await page.goto('/faq#claim')")).toEqual(["/faq"]);
  });

  it("reads a URL argument written on its own line", () => {
    const source = [
      "const resp = await userPage.goto(",
      "  `/dashboard/brands/${brandSlug}/analytics`,",
      "  { timeout: 60_000 },",
      ")",
    ].join("\n");

    expect(extractRoutes(source)).toEqual(["/dashboard/brands/*/analytics"]);
  });

  it("ignores non-literal and non-route first arguments", () => {
    expect(extractRoutes("page.goto(path)\nclient.get('brands')")).toEqual([]);
  });
});

describe("matchesRoute", () => {
  it.each([
    ["/brands/acme", "/brands/[slug]", true],
    ["/brands/*", "/brands/[slug]", true],
    ["/admin/jobs/*/runlog", "/admin/jobs/[jobId]/runlog", true],
    ["/guides/design/history", "/guides/[...slug]", true],
    ["/guides/design", "/guides/[[...slug]]", true],
    ["/guides", "/guides/[...slug]", false],
    ["/brands/acme/edit", "/brands/[slug]", false],
    ["/brand/acme", "/brands/[slug]", false],
  ])("matches %s against %s as %s", (route, pattern, expected) => {
    expect(matchesRoute(route, pattern)).toBe(expected);
  });

  // A layout wraps its whole subtree, so its pattern has to match descendants
  // too. Exact-matching it made a root-layout change select only the specs
  // visiting `/` — the under-selection this mechanism exists to prevent.
  it.each([
    ["/admin/brands", "/admin", true],
    ["/admin/jobs/queue", "/admin", true],
    ["/admin", "/admin", true],
    ["/brands", "/", true],
    ["/dashboard/brands/acme/info", "/dashboard", true],
    ["/administration", "/admin", false],
    ["/brands", "/admin", false],
  ])("subtree-matches %s against %s as %s", (route, pattern, expected) => {
    expect(matchesRoute(route, pattern, { subtree: true })).toBe(expected);
  });

  it("does not subtree-match unless asked", () => {
    expect(matchesRoute("/admin/brands", "/admin")).toBe(false);
  });
});

describe("isSubtreeEntrypoint", () => {
  it.each([
    ["src/app/layout.tsx", true],
    ["src/app/admin/layout.tsx", true],
    ["src/app/[locale]/template.tsx", true],
    ["src/app/[locale]/@modal/default.tsx", true],
    ["src/app/admin/brands/page.tsx", false],
    ["src/app/api/search/route.ts", false],
    ["src/components/layout.tsx", false],
  ])("classifies %s as %s", (file, expected) => {
    expect(isSubtreeEntrypoint(file)).toBe(expected);
  });
});

describe("collectSpecRoutes", () => {
  it("includes routes from every transitively imported e2e helper", () => {
    const files = [
      "e2e/tests/submit.spec.ts",
      "e2e/utils/form.ts",
      "e2e/utils/nav.ts",
    ];
    const sources = new Map([
      ["e2e/tests/submit.spec.ts", "import { submit } from '../utils/form'"],
      ["e2e/utils/form.ts", "export { navigate } from './nav'"],
      ["e2e/utils/nav.ts", "page.goto('/submit/recommend')"],
    ]);
    const fileSet = new Set(files);
    const graph = buildReverseImportGraph(files, sources, (file: string) =>
      fileSet.has(file),
    );

    expect(
      collectSpecRoutes(["e2e/tests/submit.spec.ts"], files, sources, graph),
    ).toEqual(
      new Map([["e2e/tests/submit.spec.ts", new Set(["/submit/recommend"])]]),
    );
  });
});

// Regression tests against the real source tree, not a fixture. The map this
// mechanism replaced was 92% blind while its fixture-based tests were green,
// so these assert against files that actually exist in the repository.
describe("selectDerivedSpecs against the repository", () => {
  const sourceFiles = execFileSync("rg", ["--files", "src", "e2e"], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  const sourceSet = new Set(sourceFiles);
  const files = sourceFiles.filter(
    (file) => isCodeFile(file) && existsSync(file),
  );
  const sourceByFile = new Map(
    files.map((file) => [file, readFileSync(file, "utf8")] as const),
  );
  const selectionIndex = buildSelectionIndex(
    files,
    sourceByFile,
    (file: string) => sourceSet.has(file),
  );
  const select = (changedFiles: string[]) =>
    selectDerivedSpecs(changedFiles, selectionIndex);

  it("selects dashboard coverage for a real dashboard component", () => {
    expect(
      select(["src/components/dashboard/dashboard-hero-card.tsx"]),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^e2e\/tests\/dashboard-.*\.spec\.ts$/),
      ]),
    );
  });

  it("selects dashboard coverage for the redesigned dashboard routes", () => {
    // The two commits that exposed the old map: both selected zero specs.
    expect(
      select([
        "src/app/[locale]/(protected)/dashboard/brands/[slug]/(dashboard)/page.tsx",
        "src/components/dashboard/dashboard-hero-card.tsx",
      ]),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^e2e\/tests\/dashboard-.*\.spec\.ts$/),
      ]),
    );
  });

  it("selects brands coverage for a real brands component", () => {
    expect(select(["src/components/brands/brand-header.tsx"])).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^e2e\/tests\/brand.*\.spec\.ts$/),
      ]),
    );
  });

  it("selects at least one spec for the brands service", () => {
    expect(select(["src/lib/services/brands.ts"]).length).toBeGreaterThan(0);
  });

  it("selects nothing for a real file imported by no route", () => {
    expect(select(["src/lib/services/brands.test.ts"])).toEqual([]);
  });

  it("selects the canonical getting-started smoke spec in the deep project", () => {
    expect(
      select(["src/app/[locale]/(site)/getting-started/page.tsx"]),
    ).toContain("e2e/tests/getting-started.spec.ts");

    const everySpec = select(["src/components/ui/button.tsx"]);
    expect(everySpec.length).toBeGreaterThan(0);
    expect(everySpec.every(isSelectableSpec)).toBe(true);
  });

  it("reaches a route through a helper the spec imports rather than a literal", () => {
    // submit-name-suggestion.spec.ts has no URL of its own — it navigates via
    // gotoSubmitRecommend() in e2e/utils/submit-form.ts.
    expect(
      select(["src/app/[locale]/(site)/submit/recommend/page.tsx"]),
    ).toContain("e2e/tests/submit-name-suggestion.spec.ts");
  });
});

describe("selectChangedSpecs", () => {
  it("selects spec files that changed", () => {
    expect(
      selectChangedSpecs([
        "e2e/tests/seo.spec.ts",
        "src/app/[locale]/brands/page.tsx",
      ]),
    ).toEqual(["e2e/tests/seo.spec.ts"]);
  });

  it("ignores non-spec files under e2e/", () => {
    expect(
      selectChangedSpecs(["e2e/fixtures/auth.ts", "e2e/helpers/seed.ts"]),
    ).toEqual([]);
  });

  it("returns empty when nothing under e2e/ changed", () => {
    expect(selectChangedSpecs(["src/lib/utils.ts"])).toEqual([]);
  });

  // The selective workflow does not run smoke projects. Passing it a smoke path
  // filters every test out, and Playwright exits non-zero with "no tests found".
  it("ignores smoke specs the selective projects cannot run", () => {
    expect(
      selectChangedSpecs([
        "e2e/smoke/landing.spec.ts",
        "e2e/tests/seo.spec.ts",
      ]),
    ).toEqual(["e2e/tests/seo.spec.ts"]);
  });
});

describe("parseRemovedI18nStrings", () => {
  const diff = [
    "--- a/messages/en.json",
    "+++ b/messages/en.json",
    "@@ -12 +12 @@",
    '-    "title": "Formoria — Discover Taiwanese Brands",',
    '+    "title": "Brand Directory — Browse Taiwanese Brands | Formoria",',
  ].join("\n");

  it("captures removed values and ignores added ones", () => {
    expect(parseRemovedI18nStrings(diff)).toEqual([
      "Formoria — Discover Taiwanese Brands",
    ]);
  });

  it("ignores the --- file header line", () => {
    expect(parseRemovedI18nStrings(diff)).not.toContain("a/messages/en.json");
  });

  it("skips values shorter than the grep threshold", () => {
    expect(parseRemovedI18nStrings('-    "close": "關閉",')).toEqual([]);
  });

  it("decodes JSON escapes in removed values", () => {
    expect(parseRemovedI18nStrings('-    "note": "Line\\nbreak",')).toEqual([
      "Line\nbreak",
    ]);
  });

  it("deduplicates a value removed from both locale files", () => {
    const twoFiles = [
      '-    "title": "Shared Copy Value",',
      '-    "heading": "Shared Copy Value",',
    ].join("\n");
    expect(parseRemovedI18nStrings(twoFiles)).toEqual(["Shared Copy Value"]);
  });
});

describe("selectSpecsForRemovedStrings", () => {
  it("selects every spec referencing a removed string", () => {
    const index: Record<string, string[]> = {
      "Old Title": ["e2e/tests/seo.spec.ts", "e2e/tests/directory.spec.ts"],
    };
    expect(
      selectSpecsForRemovedStrings(
        ["Old Title"],
        (v: string) => index[v] ?? [],
      ),
    ).toEqual(["e2e/tests/seo.spec.ts", "e2e/tests/directory.spec.ts"]);
  });

  it("deduplicates specs matched by more than one removed string", () => {
    const result = selectSpecsForRemovedStrings(
      ["Old Title", "Old Subtitle"],
      () => ["e2e/tests/seo.spec.ts"],
    );
    expect(result).toEqual(["e2e/tests/seo.spec.ts"]);
  });

  it("returns empty when no spec references the removed strings", () => {
    expect(selectSpecsForRemovedStrings(["Old Title"], () => [])).toEqual([]);
  });

  it("drops a generic token that matches more than five specs", () => {
    const many = Array.from({ length: 6 }, (_, i) => `e2e/tests/s${i}.spec.ts`);
    expect(selectSpecsForRemovedStrings(["owner"], () => many)).toEqual([]);
  });

  it("keeps a string matching exactly the fan-out limit", () => {
    const five = Array.from({ length: 5 }, (_, i) => `e2e/tests/s${i}.spec.ts`);
    expect(selectSpecsForRemovedStrings(["Distinct Copy"], () => five)).toEqual(
      five,
    );
  });
});
