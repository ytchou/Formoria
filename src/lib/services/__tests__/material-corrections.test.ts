import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EVICTED_LABELS,
  MATERIALS,
  matchSubcategory,
  normalizeSubcategoryKey,
} from "@/lib/taxonomy/ontology";
import {
  applyMaterialDelta,
  isCorrectionField,
  isMaterialDelta,
  normalizeProposedValue,
  reviewCorrection,
  sameMaterialSet,
  type CorrectionSupabase,
} from "../brand-corrections";
import { PRE_MIGRATION_CORPUS } from "../../../../scripts/rehearse-slug-reverse";

/**
 * DEV-1510 Task 10 made `material` the SECOND array-valued correctable field,
 * with a closed CHECK on both columns and a backfill derived from the craft L2s
 * DEV-1507 has since retired. DEV-1525 then moved the axis off zh-TW labels:
 * the column, the CHECK and the corrections gate all speak SLUGS now, and 陶瓷
 * is a display string on the `MATERIALS` entry that nothing stores or filters
 * by. The material axis outlives the use nodes it was seeded from — that is the
 * point of a separate axis, and this file is where the two stop being coupled.
 *
 * The counts below are sized against PRODUCTION — 795 approved brands — and are
 * asserted over the committed corpus rather than a live query. Staging holds
 * 104 of those brands, so a live assertion could only ever be a smaller number
 * that means nothing; its actual result (11 brands: wood 4, textile 2, metal 2,
 * ceramic 2, wool 1) is recorded in the backfill migration header instead, so
 * neither figure stands in for the other.
 */

const MIGRATION_PATH =
  "supabase/migrations/20260820170000_material_slugs.sql";

/** The stored vocabulary. `nameZh` / `nameEn` are display-only. */
const MATERIAL_SLUGS = MATERIALS.map((material) => material.slug);

/**
 * The mapping the backfill implemented, in TypeScript — keyed to slugs by
 * DEV-1525, then back to LABELS by DEV-1507. Nine stored labels onto eight
 * terms; two of them share `textile`, which is why the backfill needs a
 * DISTINCT and this fixture needs a Set.
 *
 * The key is the stored label, not an L2 slug, because the ten craft L2s the
 * lookup used to route through left the vocabulary with the `crafts` L1. That
 * is not a workaround: a transform that already ran against a recorded corpus
 * must state its own inputs, never re-derive them through a vocabulary written
 * afterwards. Resolving these through `matchSubcategory` would silently zero
 * the plan the moment a node moved — which is exactly what DEV-1507 did.
 *
 * 藍染・植物染 is absent because no corpus row carries it, and 插畫・畫作 and
 * 乾燥花・花藝設計 because they name a medium of expression, not a material the
 * object is made of — guessing `paper` for an illustration would put a wrong
 * fact behind a public filter. Both of the latter survived the retirement, as
 * `wall-art` and inside `floral-arrangements`, and neither gained a material.
 */
const MATERIAL_BY_RETIRED_LABEL: Record<string, string> = {
  "陶瓷・陶藝": "ceramic",
  "木藝・木作": "wood",
  刺繡: "textile",
  "編織・鉤織": "textile",
  "玻璃・琉璃": "glass",
  金工: "metal",
  "竹編・竹藝": "bamboo",
  羊毛氈: "wool",
  皮革工藝: "leather",
};

/** Matched on the ontology's own basis, so a ・ variant resolves identically. */
const MATERIAL_BY_NORMALIZED_LABEL = new Map(
  Object.entries(MATERIAL_BY_RETIRED_LABEL).map(([label, material]) => [
    normalizeSubcategoryKey(label),
    material,
  ]),
);

function backfillPlan(): Map<string, string[]> {
  const plan = new Map<string, string[]>();
  for (const [brandSlug, labels] of Object.entries(PRE_MIGRATION_CORPUS)) {
    const materials = new Set<string>();
    for (const label of labels) {
      const material = MATERIAL_BY_NORMALIZED_LABEL.get(
        normalizeSubcategoryKey(label),
      );
      if (material) materials.add(material);
    }
    if (materials.size > 0) plan.set(brandSlug, [...materials]);
  }
  return plan;
}

const REVIEWER_ID = "7d2c1a94-3b60-4f18-9e52-8c41d0b7a396";
const STALE_CORRECTION_ID = "5a3e9c07-42d1-4b86-9f30-1e72b8c5d04a";
const STALE_BRAND_ID = "c81b6f25-0d73-49ae-b514-6a92f3e70dc8";

type ReviewWriteBuilder = {
  eq: () => ReviewWriteBuilder;
  then: (
    resolve: (result: { error: null; count: number }) => unknown,
  ) => Promise<unknown>;
};

type ReviewReadBuilder = {
  select: () => ReviewReadBuilder;
  eq: () => ReviewReadBuilder;
  maybeSingle: () => Promise<{ data: unknown; error: null }>;
  update: (patch: Record<string, unknown>) => ReviewWriteBuilder;
};

/**
 * Client double for `reviewCorrection`, passed through its `client` seam:
 * `scripts/check-test-boundaries.mjs` hard-fails on any vi.mock of
 * `@/lib/supabase/`, so injection IS the test strategy here (same shape as the
 * `deps` seam in `brand-corrections-bulk.test.ts`).
 *
 * The stored row is deliberately UNCONVERTED — `{add:['陶瓷']}` is what the
 * queue held the moment before DEV-1525 ran, and the whole case is about what
 * the reviewer can still do with it.
 */
function createReviewClientDouble() {
  const updates: Array<Record<string, unknown>> = [];
  const row = {
    id: STALE_CORRECTION_ID,
    brand_id: STALE_BRAND_ID,
    field: "material",
    proposed_value: { add: ["陶瓷"], remove: [] },
    status: "pending",
    brands: {
      id: STALE_BRAND_ID,
      name: "窯物所",
      slug: "yao-wu-suo",
      category: "home-living",
      subcategories: ["tableware"],
      material: ["ceramic"],
      social_instagram: null,
      social_threads: null,
      social_facebook: null,
    },
  };

  const client = {
    from(table: string): ReviewReadBuilder {
      expect(table).toBe("brand_field_corrections");
      const builder: ReviewReadBuilder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: row, error: null }),
        update: (patch: Record<string, unknown>) => {
          updates.push(patch);
          // Thenable, not a promise: `markReviewed` awaits the filtered builder
          // itself rather than a terminal method, so the chain has to resolve
          // to `{ error, count }` on await.
          const write: ReviewWriteBuilder = {
            eq: () => write,
            then: (resolve) => Promise.resolve(resolve({ error: null, count: 1 })),
          };
          return write;
        },
      };
      return builder;
    },
  };

  return { client: client as unknown as CorrectionSupabase, updates };
}

describe("DEV-1525 material axis", () => {
  it("material_terms_gate_accepts_slugs_only", () => {
    // The service layer holds the same closed set the column does, so an
    // unlisted term fails at submit with `invalid_value` rather than as a 23514
    // at apply time.
    expect(
      normalizeProposedValue("material", { add: ["ceramic"], remove: [] }),
    ).toEqual({ ok: true, value: { add: ["ceramic"], remove: [] } });

    // 陶瓷 is what the column stored BEFORE the slug migration, and it is now
    // exactly as invalid as a term the vocabulary never held. That is the whole
    // point of the gate: a stale admin form or a replayed payload carrying the
    // old spelling must not reach `apply_brand_patch`.
    expect(
      normalizeProposedValue("material", { add: ["陶瓷"], remove: [] }),
    ).toEqual({ ok: false, error: "invalid_value" });
    expect(
      normalizeProposedValue("material", { add: ["不明材質"], remove: [] }),
    ).toEqual({ ok: false, error: "invalid_value" });

    // `remove` is validated too — there is no legacy material value left to
    // repair, so an unlisted removal is a malformed request, not a cleanup.
    expect(
      normalizeProposedValue("material", { add: [], remove: ["陶瓷"] }),
    ).toEqual({ ok: false, error: "invalid_value" });

    // Every slug in, every display label out — asserted across the whole
    // vocabulary so a thirteenth term cannot be admitted on one side only.
    for (const material of MATERIALS) {
      expect(
        normalizeProposedValue("material", {
          add: [material.slug],
          remove: [],
        }),
      ).toEqual({ ok: true, value: { add: [material.slug], remove: [] } });
      expect(
        normalizeProposedValue("material", {
          add: [material.nameZh],
          remove: [],
        }),
      ).toEqual({ ok: false, error: "invalid_value" });
    }
  });

  it("material_delta_writes_in_canonical_order", () => {
    // Canonical `MATERIALS` order, not first-seen. The migration writes that
    // order (rank 1..12), so a corrected row and a converted row holding the
    // same set have to compare equal by array equality.
    expect(applyMaterialDelta([], { add: ["wood", "ceramic"], remove: [] })).toEqual(
      ["ceramic", "wood"],
    );
    expect(
      applyMaterialDelta([], { add: ["leather", "ceramic", "wood"], remove: [] }),
    ).toEqual(["ceramic", "wood", "leather"]);

    // Applies as a DELTA over the stored array, not as a scalar replacement:
    // two visitors correcting different terms must compose, and a scalar branch
    // would make the second overwrite the first.
    expect(applyMaterialDelta(["ceramic"], { add: ["wood"], remove: [] })).toEqual(
      ["ceramic", "wood"],
    );
    expect(
      applyMaterialDelta(["ceramic", "wood"], { add: [], remove: ["ceramic"] }),
    ).toEqual(["wood"]);

    // The rank IS the `MATERIALS` index, for all twelve — a reordering of the
    // ontology array that the sort no longer tracked would fail here.
    expect(
      applyMaterialDelta([], {
        add: [...MATERIAL_SLUGS].toReversed(),
        remove: [],
      }),
    ).toEqual(MATERIAL_SLUGS);
  });

  it("same_material_set_ignores_input_order", () => {
    // Set equality, so a proposal that merely re-orders the stored array is not
    // a change and never reaches `apply_brand_patch`.
    expect(sameMaterialSet(["ceramic", "wood"], ["wood", "ceramic"])).toBe(true);
    expect(sameMaterialSet([], [])).toBe(true);
    expect(sameMaterialSet(["wood"], ["ceramic", "wood"])).toBe(false);
    expect(sameMaterialSet(["ceramic", "wood"], ["ceramic", "glass"])).toBe(
      false,
    );
  });

  it("migration_check_matches_the_ontology", () => {
    const migration = readFileSync(MIGRATION_PATH, "utf8");

    // Both columns, not one. `curated_products.material` is written by a
    // different code path, so a CHECK on `brands` alone leaves half the axis
    // open — and half of it still spelled in Chinese.
    expect(migration).toContain("add constraint brands_material_check");
    expect(migration).toContain(
      "add constraint curated_products_material_check",
    );

    // `<@` is ELEMENT containment. `=` or `&&` would accept an unlisted term as
    // long as one listed term were present, which is the whole failure this
    // constraint exists to stop.
    const checkBodies = [
      ...migration.matchAll(
        /check \(\s*material <@ array\[([\s\S]*?)\]::text\[\]\)/g,
      ),
    ].map((match) => match[1] ?? "");
    expect(checkBodies).toHaveLength(2);

    for (const body of checkBodies) {
      // Quoted, so `wood` cannot pass on being a substring of another term, and
      // the count is exact: an extra term in one CHECK and not the other is the
      // asymmetry this whole case exists to catch.
      const quoted = [...body.matchAll(/'([^']+)'/g)].map(
        (match) => match[1] ?? "",
      );
      expect(quoted).toEqual(MATERIAL_SLUGS);
    }

    // The conversion is a bijection whose rank matches the `MATERIALS` index
    // element for element. `sameMaterialSet` compares sets, but a stored order
    // that disagreed with `MATERIAL_ORDER` would make every admin diff read as
    // a pending change.
    MATERIALS.forEach((material, index) => {
      expect(migration).toMatch(
        new RegExp(
          `\\('${material.nameZh}',\\s*'${material.slug}',\\s*${index + 1}\\)`,
        ),
      );
    });

    // A vocabulary migration changes how a fact is spelled, not the fact: the
    // use axis must not move with it.
    expect(migration).not.toMatch(/set\s+subcategories\s*=/);
  });

  it("backfill_writes_67_brands_across_8_terms", () => {
    const plan = backfillPlan();
    expect(plan.size).toBe(67);

    const distribution = new Map<string, number>();
    for (const materials of plan.values()) {
      for (const material of materials) {
        distribution.set(material, (distribution.get(material) ?? 0) + 1);
      }
    }
    // Same brands, same counts as the zh-keyed original — only the key changed.
    expect(
      Object.fromEntries(
        [...distribution.entries()].toSorted((a, b) => b[1] - a[1]),
      ),
    ).toEqual({
      ceramic: 29,
      wood: 15,
      textile: 14,
      metal: 7,
      glass: 7,
      bamboo: 4,
      wool: 3,
      leather: 2,
    });
    expect(distribution.size).toBe(8);

    // `paper` / `stone` / `rattan` / `lacquer` have ZERO production evidence and
    // are admitted anyway: the vocabulary is a closed agreement, not a summary
    // of the catalogue.
    const written = new Set([...distribution.keys()]);
    for (const slug of ["paper", "stone", "rattan", "lacquer"]) {
      expect(MATERIAL_SLUGS).toContain(slug);
      expect(written.has(slug)).toBe(false);
    }
  });

  it("craft_labels_are_evicted_not_reclaimed", () => {
    // The nodes the backfill read left the vocabulary with the `crafts` L1
    // (DEV-1507), so each input label must now resolve to nothing AND be
    // recorded as evicted. Either half alone is a silent failure: a label that
    // resolves again has been reclaimed by a surviving node and would re-tag
    // these brands by accident, and a label that resolves to nothing without an
    // eviction row is a production value the next backfill aborts on.
    const evicted = new Set<string>(EVICTED_LABELS);
    for (const label of Object.keys(MATERIAL_BY_RETIRED_LABEL)) {
      expect(matchSubcategory(label), `${label} must not resolve`).toBeNull();
      expect(evicted.has(label), `${label} must be an evicted label`).toBe(true);
    }
  });

  it("material_is_correctable_as_an_array_field", () => {
    expect(isCorrectionField("material")).toBe(true);
    expect(isMaterialDelta({ add: ["ceramic"], remove: [] })).toBe(true);
    expect(isMaterialDelta({ add: "ceramic", remove: [] })).toBe(false);
  });

  it("stale_material_correction_can_still_be_rejected", async () => {
    // The queue outlives the vocabulary. A row submitted before the slug
    // conversion still holds 陶瓷, which `normalizeProposedValue` now refuses —
    // and a reject that ran through that gate would refuse too, stranding the
    // row as pending forever with no admin action able to clear it. Rejecting
    // is a decision about the ROW, so it must not depend on the proposed value
    // still being spellable.
    const stale = createReviewClientDouble();
    await expect(
      reviewCorrection(
        STALE_CORRECTION_ID,
        "rejected",
        "pre-migration spelling",
        { reviewerId: REVIEWER_ID },
        stale.client,
      ),
    ).resolves.toEqual({ ok: true });
    // Claimed as rejected, exactly once, with the reviewer's own notes.
    expect(stale.updates).toEqual([
      {
        status: "rejected",
        reviewed_at: expect.any(String),
        reviewed_by: REVIEWER_ID,
        reviewer_notes: "pre-migration spelling",
      },
    ]);

    // Approval keeps refusing, and that is the correct half: writing 陶瓷 back
    // is exactly what `brands_material_check` bounces. The row is claimed by
    // neither decision path before the refusal, so nothing is left half-done.
    const approval = createReviewClientDouble();
    await expect(
      reviewCorrection(
        STALE_CORRECTION_ID,
        "approved",
        "",
        { reviewerId: REVIEWER_ID },
        approval.client,
      ),
    ).resolves.toEqual({ ok: false, code: "invalid_value" });
    expect(approval.updates).toEqual([]);
  });
});
