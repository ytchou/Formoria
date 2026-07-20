import type { Metadata } from "next";
import { CommunitySubmissionsTable } from "@/components/admin/community-submissions-table";

export const metadata: Metadata = {
  title: "Bulk Community Submissions | Admin",
};

export default function CommunitySubmissionsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="type-section-title-large">Bulk community submissions</h1>
        <p className="mt-1 type-card-description">
          Preview and import up to 100 brand recommendations. Exact duplicates
          are blocked; similar matches require an explicit override.
        </p>
      </div>
      <CommunitySubmissionsTable />
    </div>
  );
}
