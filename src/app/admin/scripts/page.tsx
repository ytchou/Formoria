import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/card";
import { inkActionClassName } from "@/components/admin/ink-action";
import { cn } from "@/lib/utils";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Scripts | Admin" };

export default async function AdminScriptsPage() {
  const t = await getTranslations("admin.scripts");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="type-label">{t("title")}</h1>
        <p className="mt-1 type-body-sm">{t("description")}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <SurfaceCard padding="lg">
          <h2 className="type-label">{t("bulkSubmissions.title")}</h2>
          <p className="mt-2 type-body-sm">
            {t("bulkSubmissions.cardDescription")}
          </p>
          <Link
            href={routes.admin.bulkCommunitySubmissions()}
            className={buttonVariants({
              variant: "secondary",
              className: cn("mt-6", inkActionClassName),
            })}
          >
            {t("bulkSubmissions.openCta")}
          </Link>
        </SurfaceCard>
      </div>
    </div>
  );
}
