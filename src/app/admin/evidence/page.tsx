import { runWithAuditContext } from "@/lib/audit/context";
import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { reviewEvidenceBatchAction } from "@/app/admin/actions";
import { EvidenceQueue } from "@/components/admin/evidence-queue";
import { requireAdminPage } from "@/lib/auth/require-admin";
import {
  listAllEvidence,
  reviewEvidence,
  type OriginEvidenceDecision,
} from "@/lib/services/origin-evidence";
import { routes } from "@/lib/routes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.evidence");

  return { title: t("title") };
}

async function reviewEvidenceAction(
  id: string,
  decision: OriginEvidenceDecision,
  notes: string,
  tierAction?: "strip_declaration",
): Promise<{ error?: string } | undefined> {
  "use server";

  return runWithAuditContext({}, async () => {
    const user = await requireAdminPage(routes.admin.evidence());
    const result = await reviewEvidence(id, decision, notes, {
      reviewerId: user.id,
      ...(tierAction ? { tierAction } : {}),
    });

    if (!result.ok) return { error: result.code };

    revalidatePath(routes.admin.evidence());
    revalidatePath(routes.admin.index());
    return undefined;
  });
}

export default async function AdminEvidencePage() {
  await requireAdminPage(routes.admin.evidence());
  const [evidence, t] = await Promise.all([
    listAllEvidence(),
    getTranslations("admin.evidence"),
  ]);

  return (
    <div>
      <h1 className="type-page-title">{t("title")}</h1>
      <p className="mt-2 type-body-sm">{t("description")}</p>

      <div className="mt-8">
        <EvidenceQueue
          evidence={evidence}
          reviewAction={reviewEvidenceAction}
          bulkReviewAction={reviewEvidenceBatchAction}
        />
      </div>
    </div>
  );
}
