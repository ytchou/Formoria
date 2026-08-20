import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { StockistQueue } from "@/components/admin/stockist-queue";
import { requireAdminPage } from "@/lib/auth/require-admin";
import { listPendingCommunityStockists } from "@/lib/services/brand-channels";
import { routes } from "@/lib/routes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.stockists");

  return { title: t("title") };
}

export default async function AdminStockistsPage() {
  await requireAdminPage(routes.admin.stockists());
  const [stockists, t] = await Promise.all([
    listPendingCommunityStockists(),
    getTranslations("admin.stockists"),
  ]);

  return (
    <div>
      <h1 className="type-label">{t("title")}</h1>
      <p className="mt-2 type-body-sm">{t("description")}</p>

      <div className="mt-8">
        <StockistQueue stockists={stockists} />
      </div>
    </div>
  );
}
