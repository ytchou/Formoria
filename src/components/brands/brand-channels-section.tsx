import { getTranslations } from "next-intl/server";
import { Typography } from "@/components/ui/typography";
import { CHANNEL_CONFIRMATION_THRESHOLD } from "@/lib/brands/channels";
import type { AppLocale } from "@/i18n/locale-preference";
import type { BrandChannel } from "@/lib/types";
import { BrandChannelList } from "./brand-channel-list";
import { ProvideChannelInfoDialog } from "./provide-channel-info-dialog";

export type BrandChannelsSectionProps = {
  locale: AppLocale;
  confirmed: BrandChannel[];
  possible: BrandChannel[];
  brandId: string;
  brandSlug: string;
};

export async function BrandChannelsSection({
  locale,
  confirmed,
  possible,
  brandId,
  brandSlug,
}: BrandChannelsSectionProps) {
  const t = await getTranslations({ locale, namespace: "brandDetail" });
  return (
    <section
      className="space-y-6"
      data-brand-id={brandId}
      data-brand-slug={brandSlug}
      data-brand-channels-section
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Typography as="h2" variant="sectionTitleLarge">
            {t("sections.locationsAndRetailChannels")}
          </Typography>
          <p className="type-body-sm">
            {possible.length > 0
              ? t("channels.unconfirmed.thresholdNote", {
                  threshold: CHANNEL_CONFIRMATION_THRESHOLD,
                })
              : t("channels.subtitle")}
          </p>
        </div>
        <ProvideChannelInfoDialog brandId={brandId} brandSlug={brandSlug} />
      </div>

      <BrandChannelList
        confirmed={confirmed}
        possible={possible}
        brandId={brandId}
        brandSlug={brandSlug}
        threshold={CHANNEL_CONFIRMATION_THRESHOLD}
      />
    </section>
  );
}
