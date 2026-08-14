import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { getAdminBrandOptions } from "@/lib/services/brands";
import {
  getPublishedCuratedProductsForTrail,
  listCuratedProductsForAdmin,
  type TrailCuratedProduct,
} from "@/lib/services/curated-products";
import { getAllTrailsForAdmin } from "@/lib/services/trails";
import { trailIndexBlockers } from "@/lib/seo/trail-indexability";
import {
  CuratedProductsList,
  type CuratedProductTab,
} from "./curated-products-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.curatedProducts");

  return { title: t("title") };
}

const VALID_TABS = new Set<CuratedProductTab>([
  "candidate",
  "needs_review",
  "published",
  "retired",
]);

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.at(0) : value;
}

/**
 * The curated-product review queue (DEV-1465).
 *
 * No auth guard of its own: `src/app/admin/layout.tsx` already redirects
 * non-admins away from every route under /admin. The SERVER ACTIONS in
 * `./actions.ts` carry their own `requireAdminAction()` because that layout
 * check does not cover them.
 *
 * Renders with zero rows: the queue's own empty message is the whole body in
 * that case, so the admin nav sweep still finds `<main>` and no error text.
 */
export default async function CuratedProductsPage({
  searchParams,
}: {
  searchParams: Promise<{
    stage?: string | string[];
    brand?: string | string[];
  }>;
}) {
  const t = await getTranslations("admin.curatedProducts");
  const query = await searchParams;
  const stageParam = firstParam(query.stage);
  const initialTab: CuratedProductTab =
    stageParam && VALID_TABS.has(stageParam as CuratedProductTab)
      ? (stageParam as CuratedProductTab)
      : "candidate";
  // `?brand=<slug>` is the deep link from the brand list; it seeds the search
  // filter rather than the query, so an editor can widen it without navigating.
  const initialBrandSlug = firstParam(query.brand) ?? null;

  const [products, brands, trails] = await Promise.all([
    listCuratedProductsForAdmin(),
    getAdminBrandOptions(),
    getAllTrailsForAdmin("zh-TW"),
  ]);
  const trailOptions =
    trails.ok
      ? await Promise.all(
          trails.trails.map(async (trail) => {
            let productsForTrail: TrailCuratedProduct[] = [];
            let placementReadError = false;
            try {
              productsForTrail = await getPublishedCuratedProductsForTrail(trail.slug);
            } catch {
              // Keep a failed read distinct from an empty result. The editor
              // can still place a product, but must not suggest that missing
              // data is a real indexability blocker.
              placementReadError = true;
            }
            return {
              slug: trail.slug,
              title: trail.frontmatter.title,
              sections: trail.frontmatter.sections,
              blockers: placementReadError
                ? []
                : trailIndexBlockers({
                    frontmatter: trail.frontmatter,
                    products: productsForTrail,
                  }),
              placementReadError,
            };
          }),
        )
      : [];

  return (
    <div>
      <h1 className="type-page-title-large">{t("title")}</h1>
      <p className="mt-2 type-body-muted">{t("description")}</p>

      <div className="mt-8">
        <CuratedProductsList
          products={products}
          brands={brands}
          initialTab={initialTab}
          initialBrandSlug={initialBrandSlug}
          trailOptions={trailOptions}
        />
      </div>
    </div>
  );
}
