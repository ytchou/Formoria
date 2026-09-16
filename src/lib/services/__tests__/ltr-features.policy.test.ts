import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FEATURE_SPEC,
  LTR_ALLOWED_COLUMNS,
  LTR_DOC_SELECT,
} from "../ltr-features";

// ---------------------------------------------------------------------------
// Denied patterns — regex literals, not derived strings
// ---------------------------------------------------------------------------

const DENIED_PATTERNS = [
  /\bproposed_by\b/,
  /\bbrand_owners\b/,
  /\bbrand_field_state\b/,
  /\bbrand_field_corrections\b/,
  /\bbrand_content_provenance\b/,
  /\bsource_type\b/,
  /\bcontact_email\b/,
  /\bsubmitted_at\b/,
  /\bapproved_at\b/,
  /\bbrand_enriched_at\b/,
  /\bprice\b/,
  /\binventory\b/,
  /\bstock\b/,
];

const ID_PATTERN = /\b(product_id|brand_id|id)\b/;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = join(__dirname, "..", "..", "..", "..");
const FEATURE_MODULE = join(ROOT, "src/lib/services/ltr-features.ts");
const MIGRATION = join(
  ROOT,
  "supabase/migrations/20260916120000_situation_search_ltr_columns.sql",
);
const SCORER_MODULE = join(ROOT, "src/lib/services/ltr-scorer.ts");
const TRAIN_SCRIPT = join(ROOT, "scripts/ltr/train.py");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("feature source allowlist", () => {
  it("every feature source is allowlisted", () => {
    const validSources = new Set(["rpc", "derived"]);
    for (const spec of FEATURE_SPEC) {
      expect(
        validSources.has(spec.source) || LTR_ALLOWED_COLUMNS.has(spec.source),
        `Feature '${spec.name}' has unexpected source '${spec.source}'`,
      ).toBe(true);
    }
  });
});

describe("LTR_DOC_SELECT column allowlist", () => {
  it("references only allowlisted columns plus the id join key", () => {
    // Extract column names from the select string
    // Format: "col1, col2, ..., relation:table!fk(col_a, col_b)"
    const select = LTR_DOC_SELECT;

    // Extract top-level columns (before the brand join)
    const joinIdx = select.indexOf("brand:");
    const topLevel = joinIdx >= 0 ? select.slice(0, joinIdx) : select;
    const topCols = topLevel
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);

    // 'id' is the join key — allowed
    for (const col of topCols) {
      if (col === "id") continue;
      expect(
        LTR_ALLOWED_COLUMNS.has(`curated_products.${col}`),
        `Top-level column '${col}' is not in LTR_ALLOWED_COLUMNS`,
      ).toBe(true);
    }

    // Extract joined columns from brand:brands!...(col_a, col_b, col_c)
    const joinMatch = select.match(
      /brand:brands![^(]+\(([^)]+)\)/,
    );
    if (joinMatch) {
      const joinCols = joinMatch[1]!
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      for (const col of joinCols) {
        expect(
          LTR_ALLOWED_COLUMNS.has(`brands.${col}`),
          `Brand join column '${col}' is not in LTR_ALLOWED_COLUMNS`,
        ).toBe(true);
      }
    }
  });
});

describe("denied token scan", () => {
  const filesToScan: Array<{ path: string; label: string }> = [
    { path: FEATURE_MODULE, label: "ltr-features.ts" },
    { path: MIGRATION, label: "migration SQL" },
  ];

  // Include scorer and train.py when they exist
  if (existsSync(SCORER_MODULE)) {
    filesToScan.push({ path: SCORER_MODULE, label: "ltr-scorer.ts" });
  }
  if (existsSync(TRAIN_SCRIPT)) {
    filesToScan.push({ path: TRAIN_SCRIPT, label: "train.py" });
  }

  for (const { path, label } of filesToScan) {
    it(`no denied token appears in ${label}`, () => {
      const content = readFileSync(path, "utf8");
      for (const pattern of DENIED_PATTERNS) {
        expect(
          pattern.test(content),
          `Denied pattern ${pattern} found in ${label}`,
        ).toBe(false);
      }
    });
  }

  it("no FEATURE_SPEC name or source matches id columns", () => {
    for (const spec of FEATURE_SPEC) {
      expect(
        ID_PATTERN.test(spec.name),
        `Feature name '${spec.name}' matches id pattern`,
      ).toBe(false);
      expect(
        ID_PATTERN.test(spec.source),
        `Feature source '${spec.source}' matches id pattern`,
      ).toBe(false);
    }
  });
});

describe("migration column references", () => {
  it("the migration's added expressions read only rank and score columns", () => {
    const sql = readFileSync(MIGRATION, "utf8");

    // Extract vector_arm CTE content
    const vectorArmMatch = sql.match(
      /vector_arm\s+as\s*\(([\s\S]*?)\)\s*,/i,
    );
    expect(vectorArmMatch, "vector_arm CTE not found").toBeTruthy();
    const vectorArm = vectorArmMatch![1]!;

    // Extract lexical_arm CTE content
    const lexicalArmMatch = sql.match(
      /lexical_arm\s+as\s*\(([\s\S]*?)\)\s*,/i,
    );
    expect(lexicalArmMatch, "lexical_arm CTE not found").toBeTruthy();
    const lexicalArm = lexicalArmMatch![1]!;

    // Allowed column references in the CTEs
    const allowedCteRefs = [
      "pe.embedding",
      "query_embedding",
      "ls.score",
      "ls.product_id",
      "e.product_id",
    ];

    // Check that every table.column reference in each CTE is in the allowed set
    // Match patterns like alias.column_name
    const refPattern = /\b([a-z_]+)\.([a-z_]+)\b/g;

    for (const [label, cte] of [
      ["vector_arm", vectorArm],
      ["lexical_arm", lexicalArm],
    ] as const) {
      let match: RegExpExecArray | null;
      refPattern.lastIndex = 0;
      const refs = new Set<string>();
      while ((match = refPattern.exec(cte)) !== null) {
        refs.add(`${match[1]}.${match[2]}`);
      }

      for (const ref of refs) {
        expect(
          allowedCteRefs.includes(ref),
          `${label} CTE references '${ref}' which is not in the allowed set: ${allowedCteRefs.join(", ")}`,
        ).toBe(true);
      }
    }
  });
});
