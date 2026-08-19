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
 * supplies the frontmatter and the products it already read.
 */

/**
 * `unplaced_section` is a rename, not a port, of the old render-time blocker for
 * a section with no products. The old name described a render defect (a section
 * box with nothing in it) that no longer happens. What is left is an authoring
 * gap — a section the editor declared and never filled.
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

/** Every authoring gap worth telling an editor about, in declaration order. */
export function trailAuthoringWarnings({
  frontmatter,
  products,
}: {
  frontmatter: TrailAuthoringFrontmatter;
  products: readonly TrailAuthoringProduct[];
}): TrailAuthoringWarning[] {
  const warnings: TrailAuthoringWarning[] = [];

  if (frontmatter.draft) warnings.push("draft");

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
