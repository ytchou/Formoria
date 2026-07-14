import type { Metadata } from "next";
import { getSubmissionsForReview } from "@/lib/services/submissions";
import { getModerationFlagsBatch } from "@/lib/services/moderation";
import type { ModerationFlag, RiskLevel } from "@/lib/services/moderation";
import { getBrandSlugsBatch } from "@/lib/services/brands";
import {
  SubmissionsReviewList,
  type TabValue,
} from "./submissions-review-list";

export const metadata: Metadata = {
  title: "Pending Submissions | Admin",
};

function getRiskLevel(flags: ModerationFlag[]): RiskLevel {
  if (flags.some((flag) => flag.tier === "block")) return "high";
  if (flags.some((flag) => flag.tier === "flag")) return "medium";
  return "clean";
}

export default async function ReviewQueueSubmissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string | string[] }>;
}) {
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

  const moderationFlagsByBrandId = await getModerationFlagsBatch(brandIds);
  const slugMap = await getBrandSlugsBatch(brandIds);

  const submissionsWithRisk = submissions.map((submission) => ({
    ...submission,
    moderationRiskLevel: getRiskLevel(
      submission.brandId
        ? (moderationFlagsByBrandId.get(submission.brandId) ?? [])
        : [],
    ),
    enriched_data: submission.enriched_data,
    brandSlug: slugMap.get(submission.brandId ?? "") ?? null,
  }));

  return (
    <div>
      <h1 className="type-page-title-large">Brand Submissions</h1>
      <p className="mt-2 type-body-muted">
        Complete data enrichment before manual approval or rejection.
      </p>

      <div className="mt-8">
        <SubmissionsReviewList
          submissions={submissionsWithRisk}
          initialTab={initialTab}
        />
      </div>
    </div>
  );
}
