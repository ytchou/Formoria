/**
 * The cache and audit consequences of one curated-product save, as a pure
 * function of the stored visibility and the posted one.
 *
 * Extracted from `updateCuratedProductAction` because that module is
 * `"use server"`: every export there must be an async server action, so the
 * decision cannot be exported from it, and it cannot be unit-tested through the
 * action either (`scripts/check-test-boundaries.mjs` forbids mocking
 * `@/lib/services/`, and the action reads the row through one).
 *
 * The bug this pins: the action read its write context BEFORE the update and
 * then asked `context.visible` whether to purge `/brands/[slug]`. A
 * hidden -> visible save therefore answered "hidden", purged nothing, and the
 * freshly published product stayed missing from the brand page for the whole
 * ISR window. Both edges of the transition need the purge — one to make the
 * product appear, the other to make it disappear.
 */
export type VisibilityChange = {
  /** The visibility TRANSITION, not the posted value. */
  changed: boolean;
  /** What the row will hold once the update lands. */
  isVisibleAfter: boolean;
  /** Whether `/brands/[slug]` must be purged for this save. */
  revalidateBrand: boolean;
};

export function planVisibilityChange({
  before,
  after,
}: {
  before: boolean;
  /** `undefined` = the payload omitted the key, so the column is untouched. */
  after: boolean | undefined;
}): VisibilityChange {
  const isVisibleAfter = after ?? before;
  return {
    changed: after !== undefined && after !== before,
    isVisibleAfter,
    // An edit to an already-visible product changes what the brand page
    // renders, so a purge is owed even when visibility itself did not move.
    revalidateBrand: before || isVisibleAfter,
  };
}
