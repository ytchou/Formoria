import { Link } from "@/i18n/navigation";
import { ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { PhotoBand } from "@/components/ui/photo-band";
import { buttonVariants } from "@/components/ui/button";
import { routes } from "@/lib/routes";
import { phraseBreaks } from "@/components/ui/phrase-breaks";

/**
 * THE MANIFESTO: A DARK PHOTOGRAPHIC BEAT BEFORE THE FOOTER.
 *
 * `scrim="dark"` with inverse copy, the same treatment as the selection band
 * (EL-03: a flat paper scrim washed the photograph out and the headline read
 * as a smaller echo of the h1). Left-aligned so every homepage header shares
 * one edge (DS-21), and vertically centred in a band that holds most of a
 * screen. Its 看品牌目錄 pill is the page's one directory CTA; the brand strip
 * links its count line instead of repeating the button.
 */
export default async function MissionCloser() {
  const t = await getTranslations("landing");

  return (
    <PhotoBand
      image="/images/mission-closer-bg.webp"
      alt=""
      scrim="dark"
      className="flex min-h-[min(70svh,40rem)] flex-col justify-center"
      contentClassName="text-on-ink"
    >
      <h2 className="type-page-title font-ming prose-measure break-keep text-on-ink">
        {phraseBreaks(t("missionCloser.headline"))}
      </h2>
      <p className="type-body text-on-ink mt-3 prose-measure">
        {t("missionCloser.subtitle")}
      </p>
      <Link
        href={routes.brands()}
        className={buttonVariants({
          variant: "primary",
          shape: "pill",
          className:
            "mt-6 focus-visible:ring-on-ink focus-visible:ring-offset-surface-dark",
        })}
      >
        {t("missionCloser.cta")}
        <ArrowRight aria-hidden="true" />
      </Link>
    </PhotoBand>
  );
}
