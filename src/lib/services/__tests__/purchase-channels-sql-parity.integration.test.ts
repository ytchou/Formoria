import { beforeAll, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  PURCHASE_CHANNELS,
  PURCHASE_COLUMNS,
} from "@/lib/brands/purchase-channels";
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
 * so the suite passes on today's three channels and starts failing the moment a
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

interface SqlSurface {
  columns: string[];
  constraints: Record<string, string>;
  functions: Record<string, string>;
}

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
    const { data, error } = await supabase!.rpc(
      "purchase_channel_sql_surface",
    );
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
    const definition =
      surface.functions.correct_approved_submission_provenance;
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
});
