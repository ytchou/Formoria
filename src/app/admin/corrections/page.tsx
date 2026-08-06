import { runWithAuditContext } from "@/lib/audit/context";
import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { reviewCorrectionsAction } from "@/app/admin/actions";
import {
  CorrectionsQueue,
  type CorrectionQueueItem,
} from "@/components/admin/corrections-queue";
import { requireAdminPage } from "@/lib/auth/require-admin";
import {
  listCorrections,
  reviewCorrection,
  type CorrectionDecision,
} from "@/lib/services/brand-corrections";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.corrections");

  return { title: t("title") };
}

async function reviewCorrectionAction(
  id: string,
  decision: CorrectionDecision,
  notes: string,
): Promise<{ error?: string } | undefined> {
  "use server";

  return runWithAuditContext({}, async () => {
    const user = await requireAdminPage("/admin/corrections");
    const result = await reviewCorrection(id, decision, notes, {
      reviewerId: user.id,
    });

    if (!result.ok) return { error: result.code };

    revalidatePath("/admin/corrections");
    revalidatePath("/admin");
    return undefined;
  });
}

export default async function AdminCorrectionsPage() {
  await requireAdminPage("/admin/corrections");
  const [corrections, t] = await Promise.all([
    listCorrections({ status: "pending" }),
    getTranslations("admin.corrections"),
  ]);
  // Keep visitor hashes and review metadata out of the client payload.
  const queueItems: CorrectionQueueItem[] = corrections.map((correction) => ({
    id: correction.id,
    brandName: correction.brandName,
    field: correction.field,
    currentValue: correction.currentValue,
    proposedValue: correction.proposedValue,
    stale: correction.stale,
    createdAt: correction.createdAt,
  }));

  return (
    <div>
      <h1 className="type-page-title-large">{t("title")}</h1>
      <p className="mt-2 type-body-muted">{t("description")}</p>

      <div className="mt-8">
        <CorrectionsQueue
          corrections={queueItems}
          reviewAction={reviewCorrectionAction}
          bulkReviewAction={reviewCorrectionsAction}
        />
      </div>
    </div>
  );
}
