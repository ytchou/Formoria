import { runWithAuditContext } from "@/lib/audit/context";
import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import {
  FeatureRequestsQueue,
  type FeatureRequestQueueItem,
} from "@/components/admin/feature-requests-queue";
import { requireAdminPage } from "@/lib/auth/require-admin";
import {
  isFeatureRequestStatus,
  listAllFeatureRequests,
  mergeFeatureRequests,
  setFeatureRequestStatus,
  type FeatureRequestStatus,
} from "@/lib/services/feature-requests";
import { routes } from "@/lib/routes";

const ADMIN_PATH = routes.admin.featureRequests();

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.featureRequests");

  return { title: t("title") };
}

async function setStatusAction(
  id: string,
  status: FeatureRequestStatus,
  adminNote: string,
): Promise<{ error?: string } | undefined> {
  "use server";

  return runWithAuditContext({}, async () => {
    // Re-checked inside the mutation, not just at page load: a Server Action is
    // its own network entry point and never inherits the page's auth.
    await requireAdminPage(ADMIN_PATH);

    if (!isFeatureRequestStatus(status)) return { error: "invalid_status" };

    const result = await setFeatureRequestStatus(id, status, adminNote.trim() || null);
    if (!result.ok) return { error: result.code };

    revalidatePath(ADMIN_PATH);
    return undefined;
  });
}

async function mergeAction(
  sourceId: string,
  targetId: string,
): Promise<{ error?: string } | undefined> {
  "use server";

  return runWithAuditContext({}, async () => {
    await requireAdminPage(ADMIN_PATH);

    const result = await mergeFeatureRequests(sourceId, targetId);
    if (!result.ok) return { error: result.code };

    revalidatePath(ADMIN_PATH);
    return undefined;
  });
}

export default async function AdminFeatureRequestsPage() {
  await requireAdminPage(ADMIN_PATH);
  const [requests, t] = await Promise.all([
    listAllFeatureRequests(),
    getTranslations("admin.featureRequests"),
  ]);
  // Narrow projection: `submitted_by` must never reach the client payload.
  const queueItems: FeatureRequestQueueItem[] = requests.map((request) => ({
    id: request.id,
    title: request.title,
    status: request.status,
    voteCount: request.voteCount,
    adminNote: request.adminNote,
    mergedIntoId: request.mergedIntoId,
  }));

  return (
    <div>
      <h1 className="type-label">{t("title")}</h1>
      <p className="mt-2 type-body-sm">{t("description")}</p>

      <div className="mt-8">
        <FeatureRequestsQueue
          requests={queueItems}
          setStatusAction={setStatusAction}
          mergeAction={mergeAction}
        />
      </div>
    </div>
  );
}
