import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getBrands, toAdminListContract } from "@/lib/services/brands";
import { BrandList } from "@/components/admin/brand-list";
import { getAdminBrandReviewImages } from "@/lib/services/admin-brand-review";

export const metadata: Metadata = {
  title: "Brands | Admin",
};

type BrandsPageProps = {
  searchParams: Promise<{
    edit?: string | string[];
    search?: string | string[];
    status?: string | string[];
  }>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function BrandsPage({ searchParams }: BrandsPageProps) {
  const t = await getTranslations("admin.brands");
  // Admin table renders brand.mitEvidence, which the narrow directory
  // projection omits — opt back into the full column list here.
  const { brands: internalBrands } = await getBrands({
    includeTestBrands: true,
    sort: "newest",
    includeDetailColumns: true,
  });
  const brands = internalBrands.map(toAdminListContract);
  const reviewImagesByBrandId = await getAdminBrandReviewImages(
    brands.map((brand) => brand.id),
  );
  const query = await searchParams;
  const requestedStatus = first(query.status);
  const initialTab =
    requestedStatus === "approved" || requestedStatus === "hidden"
      ? requestedStatus
      : "all";

  return (
    <div>
      <h1 className="type-tool-heading">{t("title")}</h1>
      <p className="mt-2 type-body-sm">{t("description")}</p>

      <div className="mt-8">
        <BrandList
          brands={brands}
          reviewImagesByBrandId={reviewImagesByBrandId}
          initialEditingBrandId={first(query.edit)}
          initialSearchQuery={first(query.search)}
          initialTab={initialTab}
        />
      </div>
    </div>
  );
}
