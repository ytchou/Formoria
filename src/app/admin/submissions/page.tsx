import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getSubmissionsForReview } from "@/lib/services/submissions";
import { getBrandSlugsBatch } from "@/lib/services/brands";
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

  const slugMap = await getBrandSlugsBatch(brandIds);

  const submissionsWithSlugs = submissions.map((submission) => ({
    ...submission,
    enriched_data: submission.enriched_data,
    brandSlug: slugMap.get(submission.brandId ?? "") ?? null,
  }));

  return (
    <div>
      <h1 className="type-page-title-large">{t("title")}</h1>
      <p className="mt-2 type-body-muted">{t("description")}</p>

      <div className="mt-8">
        <SubmissionsReviewList
          submissions={submissionsWithSlugs}
          initialTab={initialTab}
        />
      </div>
    </div>
  );
}
