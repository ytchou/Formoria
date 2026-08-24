import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ClaimRequestsList } from "@/components/admin/claim-requests-list";
import { approveClaimAction, rejectClaimAction } from "@/app/admin/actions";
import { requireAdminPage } from "@/lib/auth/require-admin";
import {
  attachSignedProofUrls,
  listClaimRequests,
} from "@/lib/services/claim-requests";
import { routes } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Claim Requests | Admin",
};

export default async function ClaimRequestsPage() {
  await requireAdminPage(routes.admin.claims());
  const t = await getTranslations("admin.claimRequests");
  const claimRequests = await attachSignedProofUrls(await listClaimRequests());

  return (
    <div>
      <h1 className="type-tool-heading">{t("title")}</h1>
      <p className="mt-2 type-body-sm">{t("description")}</p>

      <div className="mt-8">
        <ClaimRequestsList
          claimRequests={claimRequests}
          approveAction={approveClaimAction}
          rejectAction={rejectClaimAction}
        />
      </div>
    </div>
  );
}
