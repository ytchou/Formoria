import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  EVICTED_LABELS,
  L2_SUBCATEGORIES,
  OUT_OF_FRAME_LABELS,
} from "@/lib/taxonomy/ontology";
import {
  PRE_MIGRATION_CORPUS,
  REVERSE_MIGRATION_PATH,
  RESTORATION_OVERLAY,
  assertStagingRehearsalTarget,
  forwardSubcategories,
  parseReverseMigrationTables,
  reverseSubcategories,
  survivingLabels,
} from "../rehearse-slug-reverse";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

/**
 * The corpus is a production snapshot, so a per-brand loop is the only honest
 * shape here: an aggregate count would pass while one brand's array came back
 * reordered. Failures report brand slugs, because that is what an operator
 * needs to look the row up.
 */
function roundTrip(brandSlug: string, labels: readonly string[]): string[] {
  return reverseSubcategories(brandSlug, forwardSubcategories(labels));
}

describe("slug storage reverse migration", () => {
  it("reverse_restores_labels_for_every_non_evicted_row", () => {
    const drifted: Array<{
      brandSlug: string;
      expected: string[];
      actual: string[];
    }> = [];

    for (const [brandSlug, labels] of Object.entries(PRE_MIGRATION_CORPUS)) {
      const expected = survivingLabels(labels);
      const actual = roundTrip(brandSlug, labels);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        drifted.push({ brandSlug, expected, actual });
      }
    }

    expect(drifted).toEqual([]);
    // The corpus is the whole production catalogue at export time. A shrunk
    // fixture would let this case pass while covering a fraction of the rows.
    expect(Object.keys(PRE_MIGRATION_CORPUS)).toHaveLength(795);
  });

  it("reverse_is_lossy_only_for_evicted_labels", () => {
    const lost = new Set<string>();
    for (const [brandSlug, labels] of Object.entries(PRE_MIGRATION_CORPUS)) {
      const restored = new Set(roundTrip(brandSlug, labels));
      for (const label of labels) if (!restored.has(label)) lost.add(label);
    }

    const declared = new Set<string>([
      ...EVICTED_LABELS,
      ...OUT_OF_FRAME_LABELS,
    ]);
    const carried = new Set(Object.values(PRE_MIGRATION_CORPUS).flat());

    // Nothing outside the two declared sets is lost: an alias spelling, a
    // collision partner or a cross-L1 tag coming back wrong would land here.
    expect([...lost].filter((label) => !declared.has(label))).toEqual([]);
    // And every declared label the corpus actually carries IS lost — the
    // reverse must not quietly resurrect vocabulary the ontology closed.
    expect(
      [...declared].filter((label) => carried.has(label) && !lost.has(label)),
    ).toEqual([]);
    // Seven of the 14 out-of-frame labels never appear in the corpus, so the
    // lossy set is the 44 declared labels the catalogue actually carried: all
    // 37 evicted — 28 from the storage swap plus the 9 composite technique
    // labels DEV-1507 retired with the `crafts` L1 — and 7 out-of-frame.
    expect(lost.size).toBe(44);
  });

  it("reverse_migration_sql_matches_the_typescript_tables", () => {
    const sql = readFileSync(resolve(ROOT, REVERSE_MIGRATION_PATH), "utf8");
    const { labelBySlug, restoration } = parseReverseMigrationTables(sql);

    expect(labelBySlug.size).toBe(L2_SUBCATEGORIES.length);
    for (const subcategory of L2_SUBCATEGORIES) {
      expect(labelBySlug.get(subcategory.slug)).toBe(subcategory.nameZh);
    }
    expect(restoration).toEqual(RESTORATION_OVERLAY);
  });

  it("rehearsal_refuses_every_target_but_staging", () => {
    const staging = {
      FORMORIA_DEPLOYMENT_ENV: "staging",
      SUPABASE_PROJECT_REF: "xwkigpvnheecihpxyvsl",
      SUPABASE_DB_URL:
        "postgresql://postgres.xwkigpvnheecihpxyvsl:secret@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres",
    };
    expect(assertStagingRehearsalTarget(staging).projectRef).toBe(
      "xwkigpvnheecihpxyvsl",
    );

    expect(() =>
      assertStagingRehearsalTarget({
        FORMORIA_DEPLOYMENT_ENV: "production",
        SUPABASE_PROJECT_REF: "xkcayngbttpxyibgzern",
        SUPABASE_DB_URL:
          "postgresql://postgres.xkcayngbttpxyibgzern:secret@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres",
      }),
    ).toThrow(/staging/i);

    // A staging label over a production connection string must fail too:
    // the declared environment is not evidence about the target.
    expect(() =>
      assertStagingRehearsalTarget({
        ...staging,
        SUPABASE_DB_URL:
          "postgresql://postgres.xkcayngbttpxyibgzern:secret@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres",
      }),
    ).toThrow(/xkcayngbttpxyibgzern/);
  });
});
