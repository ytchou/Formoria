import { getTranslations } from "next-intl/server";
import { Typography } from "@/components/ui/typography";
import type { AppLocale } from "@/i18n/locale-preference";
import type { Stockist } from "@/lib/types";
import { StockistList } from "./stockist-list";
import { ProvideStockistInfoDialog } from "./provide-stockist-info-dialog";

export type StockistsSectionProps = {
  locale: AppLocale;
  confirmed: Stockist[];
  possible: Stockist[];
  brandId: string;
  brandSlug: string;
};

export async function StockistsSection({
  locale,
  confirmed,
  possible,
  brandId,
  brandSlug,
}: StockistsSectionProps) {
  const t = await getTranslations({ locale, namespace: "brandDetail" });
  return (
    <section
      className="space-y-6"
      data-brand-id={brandId}
      data-brand-slug={brandSlug}
      data-stockists-section
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Typography as="h2" variant="sectionTitleLarge">
            {t("sections.retailLocations")}
          </Typography>
          <p className="type-body-sm">{t("channels.subtitle")}</p>
        </div>
        <ProvideStockistInfoDialog brandId={brandId} brandSlug={brandSlug} />
      </div>

      <StockistList
        confirmed={confirmed}
        possible={possible}
        brandId={brandId}
        brandSlug={brandSlug}
      />
    </section>
  );
}
