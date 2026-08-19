import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { describeWithDb } from "@/test/setup";
import { getBrands } from "../brands";

/**
 * DEV-1510 Task 12 — `filter_materials` on both search RPCs.
 *
 * With a text query active, `getBrands` leaves the PostgREST query builder for
 * `search_brand_page`, which applies every filter INSIDE the function. A
 * material filter added only to the builder is therefore silently ignored the
 * moment a user types — the same defect class as the `?sub=` no-op this ticket
 * exists to fix. The first two cases are the same assertion on the two paths,
 * and they only pass together if both carry the filter.
 *
 * The third case guards the deploy step, not the feature. Parameter names are
 * the PostgREST contract, so adding one means DROP and CREATE rather than
 * CREATE OR REPLACE — and dropping a function re-applies Supabase's default
 * privileges, handing `anon` EXECUTE on a `SECURITY DEFINER` function that
 * reads unpublished rows. Revoking from `public` does not undo that; only a
 * revoke by role name does.
 */

const supabase =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
      )
    : null;

type MaterialFixture = {
  ceramicId: string;
  woodId: string;
  /** A Latin token carried by both names and by nothing else in the corpus. */
  token: string;
};

/**
 * Two approved, non-demo brands that differ ONLY in `material` and share a
 * nonsense name token. Same token, same status, same category: whatever
 * separates them in a result set is the material filter and nothing else.
 */
async function withMaterialFixtures(
  assertions: (fixture: MaterialFixture) => Promise<void>,
): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const token = `zzmaterialprobe${suffix.replace(/[^a-z0-9]/g, "")}`;
  const ceramicId = randomUUID();
  const woodId = randomUUID();
  const approvedAt = new Date().toISOString();

  const { error } = await supabase!.from("brands").insert([
    {
      id: ceramicId,
      name: `DEV-1510 ${token} Ceramic`,
      slug: `dev-1510-material-ceramic-${suffix}`,
      status: "approved",
      approved_at: approvedAt,
      is_demo: false,
      category: "crafts",
      // Deliberately NO subcategories. `ceramics` expands to 陶瓷・陶藝 through
      // `taxonomy_terms`, which would put this fixture into the `陶藝` result
      // set that `search-cjk-recall.integration.test.ts` pins — a fixture that
      // perturbs another file's whole-corpus baseline while both run.
      subcategories: [],
      material: ["ceramic"],
    },
    {
      id: woodId,
      name: `DEV-1510 ${token} Wood`,
      slug: `dev-1510-material-wood-${suffix}`,
      status: "approved",
      approved_at: approvedAt,
      is_demo: false,
      category: "crafts",
      subcategories: [],
      material: ["wood"],
    },
  ]);
  expect(error).toBeNull();

  try {
    await assertions({ ceramicId, woodId, token });
  } finally {
    const { error: cleanupError } = await supabase!
      .from("brands")
      .delete()
      .in("id", [ceramicId, woodId]);
    expect(cleanupError).toBeNull();
  }
}

describeWithDb("material filter on both read paths", () => {
  // Bug caught: `?material=ceramic` works while browsing and quietly returns every
  // material the moment the user also types a search term.
  it("material_filter_applies_under_an_active_text_query", async () => {
    await withMaterialFixtures(async ({ ceramicId, woodId, token }) => {
      const unfiltered = await supabase!.rpc("search_brand_page", {
        search_query: token,
      });
      expect(unfiltered.error).toBeNull();
      const unfilteredIds = (unfiltered.data ?? []).map((row) => row.id);
      // The control: without the filter the query matches BOTH, so the
      // exclusion below is the filter's doing and not a search miss.
      expect(unfilteredIds).toContain(ceramicId);
      expect(unfilteredIds).toContain(woodId);

      const filtered = await supabase!.rpc("search_brand_page", {
        search_query: token,
        filter_materials: ["ceramic"],
      });
      expect(filtered.error).toBeNull();
      const filteredIds = (filtered.data ?? []).map((row) => row.id);
      expect(filteredIds).toContain(ceramicId);
      expect(filteredIds).not.toContain(woodId);

      // `&&` is an overlap, so a multi-term filter is a union of terms.
      const union = await supabase!.rpc("search_brand_page", {
        search_query: token,
        filter_materials: ["ceramic", "wood"],
      });
      expect(union.error).toBeNull();
      expect((union.data ?? []).map((row) => row.id)).toEqual(
        expect.arrayContaining([ceramicId, woodId]),
      );
    });
  });

  // The browse path: no search term, so this one runs through the PostgREST
  // query builder's `.overlaps("material", …)` instead of the RPC.
  it("material_filter_applies_on_the_browse_path", async () => {
    await withMaterialFixtures(async ({ ceramicId, woodId }) => {
      const unfiltered = await getBrands({
        status: "approved",
        category: ["crafts"],
        sort: "newest",
        limit: 200,
      });
      const unfilteredIds = unfiltered.brands.map((brand) => brand.id);
      expect(unfilteredIds).toContain(ceramicId);
      expect(unfilteredIds).toContain(woodId);

      const filtered = await getBrands({
        status: "approved",
        category: ["crafts"],
        materials: ["ceramic"],
        sort: "newest",
        limit: 200,
      });
      const filteredIds = filtered.brands.map((brand) => brand.id);
      expect(filteredIds).toContain(ceramicId);
      expect(filteredIds).not.toContain(woodId);

      // Every returned row really carries the term. `material` is not on the
      // card projection, so this reads it back from the table rather than
      // trusting the two fixture ids — a filter that happened to return them
      // while leaking other rows would fail here.
      const { data: rows, error: rowsError } = await supabase!
        .from("brands")
        .select("id, material")
        .in("id", filteredIds);
      expect(rowsError).toBeNull();
      expect(rows).toHaveLength(filteredIds.length);
      for (const row of rows ?? []) {
        expect(row.material, row.id).toContain("ceramic");
      }
    });
  });

  // Bug caught: the drop-and-recreate silently re-grants EXECUTE to `anon`,
  // exposing a SECURITY DEFINER function that reads every brand row.
  it("rpc_grants_are_restored_after_recreate", async () => {
    const anonymous = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    const asService = await supabase!.rpc("search_brand_page", {
      search_query: "zzgrantprobe",
      filter_materials: ["ceramic"],
    });
    expect(asService.error).toBeNull();

    const asAnon = await anonymous.rpc("search_brand_page", {
      search_query: "zzgrantprobe",
      filter_materials: ["ceramic"],
    });
    expect(asAnon.error).not.toBeNull();

    // The sibling RPC is recreated by the same migration and inherits the same
    // hazard, so it is asserted here rather than left to a second file.
    const siblingAsAnon = await anonymous.rpc("search_brands", {
      search_query: "zzgrantprobe",
      filter_materials: ["ceramic"],
    });
    expect(siblingAsAnon.error).not.toBeNull();

    const siblingAsService = await supabase!.rpc("search_brands", {
      search_query: "zzgrantprobe",
      filter_materials: ["ceramic"],
    });
    expect(siblingAsService.error).toBeNull();
  });
});
