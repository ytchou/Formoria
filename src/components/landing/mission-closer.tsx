import { Link } from "@/i18n/navigation";
import { ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { PhotoBand } from "@/components/ui/photo-band";
import { buttonVariants } from "@/components/ui/button";
import { routes } from "@/lib/routes";
type MissionCloserProps = {
  brandCount: number;
};

export default async function MissionCloser({
  brandCount,
}: MissionCloserProps) {
  const t = await getTranslations("landing");

  return (
    <PhotoBand
      image="/images/mission-closer-bg.webp"
      alt=""
      scrim="flat"
      contentClassName="text-center"
    >
      <h2 className="type-page-title font-ming mx-auto prose-measure">
        {t("missionCloser.headline")}
      </h2>
      <p className="type-body text-ink-soft mt-3 mx-auto prose-measure">
        {t("missionCloser.subtitle", { count: brandCount })}
      </p>
      <Link
        href={routes.brands()}
        className={buttonVariants({
          variant: "primary",
          shape: "pill",
          className: "mt-6",
        })}
      >
        {t("missionCloser.cta")}
        <ArrowRight aria-hidden="true" />
      </Link>
    </PhotoBand>
  );
}
