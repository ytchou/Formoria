import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `CURATED_PRODUCT_COLUMNS` in remove-brand.ts is a hand-written 25-column
 * select on the BACKUP path, and the service client there is untyped — so
 * nothing in the type system holds it to the table.
 *
 * A rename already fails loudly (PostgREST rejects the select). The direction
 * that fails SILENTLY is an ADDED column: the snapshot simply omits it, and the
 * restore re-inserts an incomplete row with no error at all. That is a data
 * loss with no signal, which is why the invariant needs a test rather than the
 * "keep in sync" comment it used to have.
 *
 * Both sides are read as TEXT, in the style of staging-curated-fixture.test.ts:
 * importing remove-brand.ts would run its `main()` (it opens a service client
 * and parses argv at import time), and `Row` is a type with no runtime keys to
 * enumerate. The generated types file is the closest runtime-readable proxy for
 * the live schema, and it is regenerated from it.
 */
const script = readFileSync(
  resolve(import.meta.dirname, "./remove-brand.ts"),
  "utf8",
);
const databaseTypes = readFileSync(
  resolve(import.meta.dirname, "../src/lib/supabase/database.types.ts"),
  "utf8",
);

function listedColumns(): string[] {
  const match = script.match(
    /const CURATED_PRODUCT_COLUMNS\s*=\s*'([^']+)'\s*as const/,
  );
  if (!match?.[1])
    throw new Error(
      "CURATED_PRODUCT_COLUMNS literal not found in scripts/remove-brand.ts",
    );
  return match[1].split(",");
}

function rowColumns(): string[] {
  // The first `Row: {` block after the table key, up to its closing brace.
  const table = databaseTypes.slice(
    databaseTypes.indexOf("      curated_products: {"),
  );
  const rowStart = table.indexOf("Row: {");
  const rowEnd = table.indexOf("\n        }", rowStart);
  if (rowStart === -1 || rowEnd === -1)
    throw new Error(
      "curated_products Row block not found in database.types.ts — regenerate the types",
    );
  const body = table.slice(rowStart, rowEnd);
  return [...body.matchAll(/^\s{10}(\w+)\??:/gm)].map(([, name]) => name!);
}

describe("remove-brand curated_products backup columns", () => {
  it("selects exactly the columns of the curated_products row", () => {
    const listed = listedColumns();
    const actual = rowColumns();

    expect(actual.length).toBeGreaterThan(0);
    // Sorted comparison: the select string is ordered for readability, the
    // generated type is alphabetical, and ORDER is not part of the invariant.
    expect([...listed].sort()).toEqual([...actual].sort());
  });

  it("lists every column once", () => {
    const listed = listedColumns();

    expect(new Set(listed).size).toBe(listed.length);
  });
});
