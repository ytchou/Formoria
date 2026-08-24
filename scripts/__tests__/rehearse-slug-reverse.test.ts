import { describe, expect, it } from "vitest";

import {
  EVICTED_LABELS,
  OUT_OF_FRAME_LABELS,
} from "@/lib/taxonomy/ontology";
import {
  PRE_MIGRATION_CORPUS,
  assertStagingRehearsalTarget,
  forwardSubcategories,
  reverseSubcategories,
  survivingLabels,
} from "../rehearse-slug-reverse";

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
    // The lossy set is the declared labels the catalogue actually carried.
    expect(lost.size).toBeGreaterThan(0);
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
