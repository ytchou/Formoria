import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BASELINE_COMMIT,
  LEGACY_SNAPSHOT_PATH,
  NEXT_CONFIG_PATH,
  NO_SUCCESSOR_DESTINATION,
  RELOCATED_L2,
  buildL2RedirectRows,
  formatConfig,
  parseLegacySnapshot,
  readLegacySubcategories,
  renderNextConfig,
} from "../generate-category-redirects";

/**
 * The two defects this suite exists for are both silent: a redirect map that
 * quietly shrinks (every dropped row is an indexed URL that starts 404ing) and
 * a generator that cannot run any more (so the block freezes while the ontology
 * moves). Neither shows up in a build, a status check, or a page render.
 *
 * The first is what `BASELINE_REF = "origin/main"` guaranteed: `main` is the
 * branch this cutover promotes into, so the baseline vocabulary would be gone
 * the moment it shipped. Hence the frozen snapshot, and hence the first case.
 */
describe("category redirect generator", () => {
  it("baseline_is_a_frozen_commit_not_a_branch", () => {
    expect(BASELINE_COMMIT).toMatch(/^[0-9a-f]{40}$/);

    // The snapshot is the input `--check` actually reads, so `--check` needs no
    // git at all: it survives the promotion, and it survives CI's shallow
    // `fetch-depth: 2` clone, which holds no historical commit either.
    const snapshot = parseLegacySnapshot(
      readFileSync(LEGACY_SNAPSHOT_PATH, "utf8"),
    );
    expect(snapshot.baselineCommit).toBe(BASELINE_COMMIT);
    expect(snapshot.exportName).toBe("PRODUCT_SUBCATEGORIES");
    expect(snapshot.subcategories.length).toBeGreaterThan(100);
  });

  it("derives_a_structurally_valid_redirect_map", () => {
    const rows = buildL2RedirectRows();

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).toHaveProperty("from");
      expect(row).toHaveProperty("to");
      expect(row).toHaveProperty("kind");
      expect(["deleted", "relocated", "reparented"]).toContain(row.kind);
      // `to` is either NO_SUCCESSOR_DESTINATION or a path starting with `/`
      if (row.to !== NO_SUCCESSOR_DESTINATION) {
        expect(row.to).toMatch(/^\//);
      }
    }
  });

  it("keys_every_row_by_parent_and_slug", () => {
    // `beverages` is a retired L1 `from` AND a live L2 under `food-drink`, so a
    // bare-slug key would shadow a page that renders.
    for (const row of buildL2RedirectRows()) {
      expect(row.from).toMatch(/^[a-z0-9-]+\/[a-z0-9-]+$/);
    }
  });

  it("refuses_a_snapshot_that_names_another_commit", () => {
    const foreign = JSON.stringify({
      baselineCommit: "0".repeat(40),
      ontologyPath: "src/lib/taxonomy/ontology.ts",
      exportName: "PRODUCT_SUBCATEGORIES",
      subcategories: [{ slug: "ceramics", category: "crafts" }],
    });
    expect(() => parseLegacySnapshot(foreign)).toThrow(/re-run --snapshot/);
  });

  it("refuses_an_emptied_snapshot", () => {
    // The failure with no symptom: an empty baseline diffs to zero rows, and
    // `--write` would then delete all 87 committed rules without complaint.
    const emptied = JSON.stringify({
      baselineCommit: BASELINE_COMMIT,
      ontologyPath: "src/lib/taxonomy/ontology.ts",
      exportName: "PRODUCT_SUBCATEGORIES",
      subcategories: [],
    });
    expect(() => parseLegacySnapshot(emptied)).toThrow(/parsed to 0 entries/);
  });

  it("refuses_a_stale_relocation_override", () => {
    const legacy = readLegacySubcategories().filter(
      ({ slug, category }) =>
        `${category}/${slug}` !== Object.keys(RELOCATED_L2)[0],
    );
    expect(() => buildL2RedirectRows(legacy)).toThrow(
      /override table is stale/,
    );
  });

  it("emits_a_prettier_stable_block", async () => {
    // The generator and `pnpm format` used to fight: over-long pair lines were
    // rewrapped by the formatter, `--check` then reported permanent drift, and
    // `--write` un-formatted the file again. Both must now be fixpoints of the
    // same bytes.
    const current = readFileSync(NEXT_CONFIG_PATH, "utf8");
    const generated = await renderNextConfig(current, buildL2RedirectRows());

    expect(await formatConfig(generated)).toBe(generated);
  });
});
