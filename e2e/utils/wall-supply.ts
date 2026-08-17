import { test } from "@playwright/test";

/**
 * Whether an absent homepage wall means "regression" rather than "low supply".
 *
 * Staging renders the seeded curated-product fixture
 * (`supabase/fixtures/staging-curated-products.sql`), and
 * `scripts/staging-curated-fixture.test.ts` asserts that fixture clears the
 * homepage publication gate. Supply there is therefore a known quantity, not
 * something a spec has to discover from the page.
 */
const WALL_SUPPLY_IS_GUARANTEED =
  process.env.FORMORIA_DEPLOYMENT_ENV === "staging";

/**
 * Gate a wall spec on SUPPLY, never on the rendered DOM alone.
 *
 * `test.skip(count === 0)` cannot tell "the wall is legitimately below its
 * supply floor" from "the wall regressed out of the page" — both are an empty
 * selector, and both report green. That is not hypothetical: in DEV-1490 the
 * staging landing shipped with no selection zone while the database held 99
 * qualifying products, and every wall spec would have skipped past it.
 *
 * So where supply is guaranteed, an absent wall FAILS. Everywhere else the skip
 * stands, because below `MIN_HOME_CURATED_PRODUCTS` a hidden wall is correct
 * behaviour rather than a defect.
 */
export function requireWallOrSkip(wallIsAbsent: boolean): void {
  if (wallIsAbsent && WALL_SUPPLY_IS_GUARANTEED) {
    throw new Error(
      "The homepage selection zone is missing while the staging fixture "
        + "guarantees supply above MIN_HOME_CURATED_PRODUCTS. The wall regressed "
        + "— it did not fall below its supply gate. See DEV-1490 for the last "
        + "cause: a build that prerendered against a pre-migration schema.",
    );
  }
  test.skip(
    wallIsAbsent,
    "The homepage product wall is hidden below its public supply gate.",
  );
}
