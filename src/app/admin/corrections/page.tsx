import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { CorrectionsQueue } from "@/components/admin/corrections-queue";
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

  const user = await requireAdminPage("/admin/corrections");
  const result = await reviewCorrection(id, decision, notes, {
    reviewerId: user.id,
  });

  if (!result.ok) return { error: result.code };

  revalidatePath("/admin/corrections");
  revalidatePath("/admin");
  return undefined;
}

export default async function AdminCorrectionsPage() {
  await requireAdminPage("/admin/corrections");
  const [corrections, t] = await Promise.all([
    listCorrections({ status: "pending" }),
    getTranslations("admin.corrections"),
  ]);

  return (
    <div>
      <h1 className="type-page-title-large">{t("title")}</h1>
      <p className="mt-2 type-body-muted">{t("description")}</p>

      <div className="mt-8">
        <CorrectionsQueue
          corrections={corrections}
          reviewAction={reviewCorrectionAction}
        />
      </div>
    </div>
  );
}
