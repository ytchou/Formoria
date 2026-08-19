import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  PURCHASE_CHANNELS,
  PURCHASE_COLUMNS,
} from "@/lib/brands/purchase-channels";
import type { Database } from "@/lib/supabase/database.types";
import { describeWithDb } from "@/test/setup";

/**
 * Guards the registry/SQL boundary.
 *
 * `src/lib/brands/purchase-channels.ts` is the single source of truth for the
 * purchase channels, but SQL cannot import it: the column is re-listed by hand
 * in two tables, two CHECK constraints, and four functions. Adding a fourth
 * channel to the registry without touching SQL would silently drop the channel
 * at approval, refresh, correction, and link-check time.
 *
 * Every assertion below iterates `PURCHASE_COLUMNS` — never a hard-coded list —
 * so the suite passes on today's four channels and starts failing the moment a
 * registry entry is added without a matching migration.
 *
 * Catalog access goes through `public.purchase_channel_sql_surface()`: PostgREST
 * exposes only the `public` schema, so `information_schema` and `pg_catalog` are
 * unreachable from the JS client. That RPC is a fixed-literal, read-only
 * accessor added in `20260805120000_add_purchase_myship.sql`.
 */

// The `@supabase/supabase-js` generated types do not know about the
// introspection RPC (it is intentionally not part of the app's data surface),
// so this suite uses an untyped client.
const supabase =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
      )
    : null;

const typedSupabase =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
      )
    : null;

interface SqlSurface {
  columns: string[];
  constraints: Record<string, string>;
  functions: Record<string, string>;
}

/**
 * DEV-1510 Task 4 — the valid L1 set, in all four places.
 *
 * The L1 slug list is enumerated in four independent places that no compiler
 * relates to one another: `brands_category_check`,
 * `curated_products_category_check`, and the BODIES of `approve_submission`
 * and `apply_brand_refresh_with_protected_location_gate`. Splitting
 * `kids-pets` into `kids` + `pets` in only some of them produces a schema that
 * accepts a brand at insert and then rejects it at approval or refresh — the
 * failure surfaces hours later, in an admin queue, with no type error.
 *
 * `purchase_channel_sql_surface()` is the meta-guard: it re-materializes the
 * two function bodies from `pg_get_functiondef` at call time, so these
 * assertions read the LIVE catalog rather than a checked-in dump.
 *
 * `crafts` stays in every list on purpose. DEV-1507 retires it; DEV-1510 does
 * not, and 19 e2e files seed `category: 'crafts'`.
 */
const VALID_L1_SLUGS = [
  "fashion",
  "bags-accessories",
  "jewelry",
  "beauty",
  "home",
  "food-drink",
  "crafts",
  "stationery",
  "tech",
  "outdoor",
  "fitness",
  "kids",
  "pets",
] as const;

const RETIRED_L1_SLUG = "kids-pets";

/** Postgres SQLSTATE for a CHECK constraint violation. */
const CHECK_VIOLATION = "23514";

/**
 * Expected enumerations per channel, verified against the post-migration
 * bodies. These are deliberately single numbers, not per-channel numbers: the
 * migration normalized `approve_submission` so all four channels are extracted
 * through the same `jsonb_to_record` signature into a local variable, which
 * removed the pre-existing asymmetry (website 5 / pinkoi 4 / shopee 4). Baking
 * in that asymmetry would have let a new channel ship with the *lower* count
 * and still pass.
 */
const EXPECTED_OCCURRENCES = {
  // 1. first `select … into` projection
  // 2. first `jsonb_to_record` signature
  // 3. `insert into public.brands` column list
  // 4. `insert … select` projection
  // 5. second `jsonb_to_record` signature
  // (the publishable-link guard reads the extracted variable, not the column)
  approve_submission: 5,
  // 5 array allow-lists + 1 publishable-core guard arm
  apply_brand_refresh_with_protected_location_gate: 6,
  // raw arm key, raw arm `new.<column>` value, owner_data arm key
  correct_approved_submission_provenance: 3,
} as const;

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

describeWithDb("purchase channel registry / SQL parity", () => {
  let surface: SqlSurface;

  beforeAll(async () => {
    const { data, error } = await supabase!.rpc("purchase_channel_sql_surface");
    expect(error).toBeNull();
    expect(data).toBeTruthy();
    surface = data as SqlSurface;
  });

  it("every registry column exists on brands and brand_submissions", () => {
    for (const column of PURCHASE_COLUMNS) {
      expect(surface.columns).toContain(`brands.${column}`);
      expect(surface.columns).toContain(`brand_submissions.${column}`);
    }
  });

  it("every registry column appears in link_check_results_field_check", () => {
    const definition = surface.constraints.link_check_results_field_check;
    expect(definition).toBeTruthy();
    for (const column of PURCHASE_COLUMNS) {
      expect(definition).toContain(`'${column}'`);
    }
  });

  it("every registry column appears in brand_field_corrections_field_check", () => {
    const definition = surface.constraints.brand_field_corrections_field_check;
    expect(definition).toBeTruthy();
    for (const column of PURCHASE_COLUMNS) {
      expect(definition).toContain(`'${column}'`);
    }
    // DEV-1525: the two correctable fields that are not purchase channels are
    // pinned here because their only assertion moved out of
    // `material-corrections.test.ts` when it retargeted its migration path.
    for (const field of ["material", "subcategories"]) {
      expect(definition).toContain(`'${field}'`);
    }
  });

  it("approve_submission enumerates every registry column the expected number of times", () => {
    const definition = surface.functions.approve_submission;
    expect(definition).toBeTruthy();
    const counts = Object.fromEntries(
      PURCHASE_COLUMNS.map((column) => [
        column,
        countOccurrences(definition, column),
      ]),
    );
    expect(counts).toEqual(
      Object.fromEntries(
        PURCHASE_COLUMNS.map((column) => [
          column,
          EXPECTED_OCCURRENCES.approve_submission,
        ]),
      ),
    );
  });

  it("apply_brand_refresh enumerates every registry column in all allow-lists", () => {
    const definition =
      surface.functions.apply_brand_refresh_with_protected_location_gate;
    expect(definition).toBeTruthy();
    const counts = Object.fromEntries(
      PURCHASE_COLUMNS.map((column) => [
        column,
        countOccurrences(definition, column),
      ]),
    );
    expect(counts).toEqual(
      Object.fromEntries(
        PURCHASE_COLUMNS.map((column) => [
          column,
          EXPECTED_OCCURRENCES.apply_brand_refresh_with_protected_location_gate,
        ]),
      ),
    );
  });

  it("correct_approved_submission_provenance enumerates every registry column", () => {
    const definition = surface.functions.correct_approved_submission_provenance;
    expect(definition).toBeTruthy();

    for (const channel of PURCHASE_CHANNELS) {
      // Raw arm: the submission column is read directly. `purchase_website` is
      // wrapped in `coalesce(new.purchase_website, new.website_url)`, which
      // still contains the `new.<column>` reference asserted here.
      expect(definition).toContain(`new.${channel.column}`);
      // owner_data arm: the camelCase key the owner wizard writes.
      expect(definition).toContain(`new.owner_data -> '${channel.camel}'`);
    }

    const counts = Object.fromEntries(
      PURCHASE_COLUMNS.map((column) => [
        column,
        countOccurrences(definition, column),
      ]),
    );
    expect(counts).toEqual(
      Object.fromEntries(
        PURCHASE_COLUMNS.map((column) => [
          column,
          EXPECTED_OCCURRENCES.correct_approved_submission_provenance,
        ]),
      ),
    );
  });

  it("purchase_channel_sql_surface_matches_after_repin", () => {
    // Sites 3 and 4 of 4. Both bodies are read live through the meta-guard, so
    // this fails if the migration patched one function and missed the other.
    const patched = [
      "approve_submission",
      "apply_brand_refresh_with_protected_location_gate",
    ] as const;

    for (const name of patched) {
      const definition = surface.functions[name];
      expect(definition).toBeTruthy();

      for (const slug of VALID_L1_SLUGS) {
        // Quoted on purpose: `'kids'` is NOT a substring of `'kids-pets'`, so
        // an unpatched body fails here instead of passing on the prefix.
        expect(definition).toContain(`'${slug}'`);
      }
      expect(definition).not.toContain(`'${RETIRED_L1_SLUG}'`);
    }

    // The third surface this RPC snapshots. DEV-1502 moves it; nothing in this
    // task should, so its purchase-channel contract above must still hold.
    expect(
      surface.constraints.brand_field_corrections_field_check,
    ).toBeTruthy();
  });

  describe("category CHECK constraints", () => {
    const brandIds: string[] = [];

    afterEach(async () => {
      if (brandIds.length === 0) return;
      const { error } = await typedSupabase!
        .from("brands")
        .delete()
        .in("id", brandIds);
      expect(error).toBeNull();
      brandIds.length = 0;
    });

    async function insertBrand(category: string) {
      const id = randomUUID();
      const result = await typedSupabase!.from("brands").insert({
        id,
        name: `DEV-1510 ${category}`,
        slug: `dev-1510-${category}-${id.slice(0, 8)}`,
        // `brands_status_check` allows only approved/hidden. `hidden` keeps the
        // fixture off every public read while the CHECK under test still fires.
        status: "hidden",
        is_demo: true,
        category,
      });
      if (!result.error) brandIds.push(id);
      return result;
    }

    it("category_check_accepts_kids_and_pets_and_rejects_kids_pets", async () => {
      // Site 1 of 4 — brands_category_check.
      for (const category of ["kids", "pets"]) {
        const { error } = await insertBrand(category);
        expect(error, `brands should accept category '${category}'`).toBeNull();
      }

      const { error: retired } = await insertBrand(RETIRED_L1_SLUG);
      expect(retired?.code).toBe(CHECK_VIOLATION);

      // Site 2 of 4 — curated_products_category_check. Its 12-slug list was
      // written inline and unnamed, then renamed by 20260819120000, so it is
      // the site most likely to be forgotten.
      const brandId = brandIds[0];
      expect(brandId).toBeTruthy();

      const productKey = `dev-1510-${randomUUID().slice(0, 8)}`;
      const { error: accepted } = await typedSupabase!
        .from("curated_products")
        .insert({
          brand_id: brandId,
          key: productKey,
          name_zh: "DEV-1510 pets",
          product_description_zh: "DEV-1510 fixture",
          category: "pets",
        });
      expect(accepted).toBeNull();

      const { error: rejected } = await typedSupabase!
        .from("curated_products")
        .insert({
          brand_id: brandId,
          key: `${productKey}-retired`,
          name_zh: "DEV-1510 kids-pets",
          product_description_zh: "DEV-1510 fixture",
          category: RETIRED_L1_SLUG,
        });
      expect(rejected?.code).toBe(CHECK_VIOLATION);

      // curated_products cascades on brand delete, so afterEach covers both.
    });
  });
});
