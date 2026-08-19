/**
 * Authoring-time warnings for a discovery trail (DEV-1518).
 *
 * This is the ADMIN-ONLY successor to the old render-time indexability gate. It
 * decides nothing about what a visitor sees: no metadata, sitemap, or route
 * reads it. A warning is a note to the editor working in the curated-product
 * queue, which is why the list is short and why nothing here can hide a trail.
 *
 * What deliberately did NOT survive the move:
 * - the frontmatter contract (promise, exclusions, editorialOwner, reviewedAt)
 *   is now a CI checker, so a missing field fails a build rather than quietly
 *   suppressing a page;
 * - the two subcategory heuristics (dominance of one subcategory over half the
 *   slate, and a floor on distinct subcategories) were editorial judgment
 *   expressed as arithmetic, and produced false positives on real trails;
 * - the supply floor is gone entirely — a small trail is a small trail, not a
 *   defective one.
 *
 * Kept pure and Supabase-free, exactly like the module it replaces: the caller
 * supplies the frontmatter and the products it already read — or `null` when
 * that read failed.
 */

/**
 * `unplaced_section` is a rename, not a port, of the old render-time blocker for
 * a section with no products. The rendering did not change — only the gate that
 * used to 404 such a trail was removed — so the state is now MORE reachable, not
 * less. It is not a blank box either: the section still emits its MDX heading
 * and the prose promising a slate, and only the product list under it renders
 * nothing. That is the defect — a promised slate that renders nothing. It is now
 * surfaced to the editor as an authoring warning instead of being hidden from
 * visitors by a render-time 404, and NO automated gate blocks publishing one.
 */
export type TrailAuthoringWarning = "draft" | "unplaced_section";

type TrailAuthoringFrontmatter = {
  draft?: boolean;
  sections: ReadonlyArray<{ key: string; title?: string }>;
};

type TrailAuthoringProduct = {
  sectionKey?: string | null;
};

function present(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Every authoring gap worth telling an editor about, in declaration order.
 *
 * `products: null` means the caller could not read the placements. Only the
 * section check consumes them, so only that check is skipped: a failed read
 * never fabricates an unfilled section, and never costs the editor the
 * frontmatter-derived `draft` flag, which no product row has a say in.
 */
export function trailAuthoringWarnings({
  frontmatter,
  products,
}: {
  frontmatter: TrailAuthoringFrontmatter;
  products: readonly TrailAuthoringProduct[] | null;
}): TrailAuthoringWarning[] {
  const warnings: TrailAuthoringWarning[] = [];

  if (frontmatter.draft) warnings.push("draft");

  if (products === null) return warnings;

  const productSections = new Set(
    products
      .map((product) => product.sectionKey)
      .filter((sectionKey): sectionKey is string => present(sectionKey)),
  );
  if (
    frontmatter.sections.some((section) => !productSections.has(section.key))
  ) {
    warnings.push("unplaced_section");
  }

  return warnings;
}
