import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getSubmissionsForReview } from "@/lib/services/submissions";
import { getBrandSlugsBatch } from "@/lib/services/brands";
import { getCuratedProductsByBrandBatch } from "@/lib/services/curated-products";
import {
  SubmissionsReviewList,
  type TabValue,
} from "./submissions-review-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.submissions");

  return { title: t("title") };
}

export default async function ReviewQueueSubmissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string | string[] }>;
}) {
  const t = await getTranslations("admin.submissions");
  const query = await searchParams;
  const stageParam = Array.isArray(query.stage) ? query.stage[0] : query.stage;
  const validStages = new Set<TabValue>([
    "all",
    "needs_data",
    "enriching",
    "skipped",
    "ready",
    "approved",
    "rejected",
  ]);
  const initialTab: TabValue =
    stageParam && validStages.has(stageParam as TabValue)
      ? (stageParam as TabValue)
      : "needs_data";
  const submissions = await getSubmissionsForReview();
  const brandIds = submissions
    .map((submission) => submission.brandId)
    .filter((brandId): brandId is string => Boolean(brandId));

  // NARROWED, unlike the slug lookup beside it. The curated products make the
  // review's proposal diff truthful (DEV-1469) — without them every proposal
  // renders as new and a rejected product is offered again — but ONLY the
  // drawer of a submission that actually carries proposals ever reads them.
  // `getSubmissionsForReview` has no status filter, so `brandIds` grows with
  // the lifetime submission count, and every row's products were being
  // serialized into the client payload on every navigation to be read by none
  // of them.
  const productBrandIds = submissions
    .filter((submission) => (submission.reviewData.products?.length ?? 0) > 0)
    .map((submission) => submission.brandId)
    .filter((brandId): brandId is string => Boolean(brandId));

  // Both batch reads are independent, so they run together.
  const [slugMap, existingProductMap] = await Promise.all([
    getBrandSlugsBatch(brandIds),
    getCuratedProductsByBrandBatch(productBrandIds),
  ]);

  const submissionsWithSlugs = submissions.map((submission) => ({
    ...submission,
    enriched_data: submission.enriched_data,
    brandSlug: slugMap.get(submission.brandId ?? "") ?? null,
  }));

  // A plain object, not the Map: this crosses the server/client boundary.
  const existingProductsByBrandId = Object.fromEntries(existingProductMap);

  return (
    <div>
      <h1 className="type-label">{t("title")}</h1>
      <p className="mt-2 type-body-sm">{t("description")}</p>

      <div className="mt-8">
        <SubmissionsReviewList
          submissions={submissionsWithSlugs}
          existingProductsByBrandId={existingProductsByBrandId}
          initialTab={initialTab}
        />
      </div>
    </div>
  );
}
