import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CommunitySubmissionsTable } from "@/components/admin/community-submissions-table";
import { MAX_COMMUNITY_SUBMISSIONS } from "@/lib/services/community-submissions.constants";

export const metadata: Metadata = {
  title: "Bulk Community Submissions | Admin",
};

export default async function CommunitySubmissionsPage() {
  const t = await getTranslations("admin.scripts.bulkSubmissions");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="type-tool-heading">{t("title")}</h1>
        {/*
          Reads the same constant the upload badge does. The copy used to say a
          hardcoded "100" while the badge two elements away rendered "Up to 500
          rows" from `MAX_COMMUNITY_SUBMISSIONS` — the page contradicted itself.
        */}
        <p className="mt-1 type-body-sm">
          {t("description", { max: MAX_COMMUNITY_SUBMISSIONS })}
        </p>
      </div>
      <CommunitySubmissionsTable />
    </div>
  );
}
