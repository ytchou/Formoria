import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/card";

export const metadata: Metadata = { title: "Scripts | Admin" };

export default function AdminScriptsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="type-section-title-large">Scripts</h1>
        <p className="mt-1 type-card-description">
          Run guarded administrative utilities without leaving the dashboard.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <SurfaceCard padding="lg">
          <h2 className="type-card-title">Bulk community submissions</h2>
          <p className="mt-2 type-card-description">
            Bulk create pending community recommendations from brand names and
            official websites.
          </p>
          <Link
            href="/admin/scripts/bulk-community-submissions"
            className={buttonVariants({ className: "mt-6 min-h-12" })}
          >
            Open tool
          </Link>
        </SurfaceCard>
      </div>
    </div>
  );
}
