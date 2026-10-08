import { getTranslations } from "next-intl/server";
import { Typography } from "@/components/ui/typography";
import type { AppLocale } from "@/i18n/locale-preference";
import type { Stockist } from "@/lib/types";
import { StockistList } from "./stockist-list";

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
      className="space-y-4"
      data-brand-id={brandId}
      data-brand-slug={brandSlug}
      data-stockists-section
    >
      {/* The 提供實體通路 flow lives in `BrandChannelCorrections`, the one
          correction line at the end of the where-to-buy block. */}
      <Typography as="h3" variant="cardTitle">
        {t("sections.retailLocations")}
      </Typography>
      {/* "May be available, partly community-supplied" is only true while
          some entry is still unconfirmed. */}
      {possible.length > 0 ? (
        <p className="type-body-sm">{t("channels.subtitle")}</p>
      ) : null}

      <StockistList confirmed={confirmed} possible={possible} />
    </section>
  );
}
