import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/card";
import { inkActionClassName } from "@/components/admin/ink-action";
import { cn } from "@/lib/utils";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Scripts | Admin" };

export default function AdminScriptsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="type-label">Scripts</h1>
        <p className="mt-1 type-body-sm">
          Run guarded administrative utilities without leaving the dashboard.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <SurfaceCard padding="lg">
          <h2 className="type-label">Bulk community submissions</h2>
          <p className="mt-2 type-body-sm">
            Bulk create pending community recommendations from brand names and
            official websites.
          </p>
          <Link
            href={routes.admin.bulkCommunitySubmissions()}
            className={buttonVariants({
              variant: "secondary",
              className: cn("mt-6 min-h-12", inkActionClassName),
            })}
          >
            Open bulk community submissions
          </Link>
        </SurfaceCard>
      </div>
    </div>
  );
}
