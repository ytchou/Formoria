"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { trackSubmissionPathSelected } from "@/lib/analytics";
import { buttonVariants } from "@/components/ui/button";
import { surfaceCardStyles } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { routes } from "@/lib/routes";

/**
 * The selling points under the path, as a plain list. No border or fill per
 * row: boxed rows read as input fields and invited clicks that went nowhere.
 */
function PathPoints({ points }: { points: string[] }) {
  return (
    <ul className="mt-5 space-y-2.5">
      {points.map((point) => (
        <li key={point} className="flex items-start gap-2">
          <Check
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-accent"
          />
          <span className="type-body-sm">{point}</span>
        </li>
      ))}
    </ul>
  );
}

type SubmitOverviewProps = {
  recommendPath?: string;
  isLoggedIn?: boolean;
};

export default function SubmitOverview({
  recommendPath = routes.submit.recommend(),
  isLoggedIn = false,
}: SubmitOverviewProps) {
  const t = useTranslations("submit.overview");

  return (
    <PageShell as="main" measure="form" className="py-20">
      <div className="prose-measure">
        <h1 className="text-balance type-page-title">{t("heading")}</h1>
        <p className="mt-4 type-body-sm">{t("description")}</p>
      </div>

      {/* One path. The owner fork was removed (DEV-1570); a coming-soon card
          for it dead-ended brand owners, so they get one plain line instead,
          pointing at the same form. */}
      <div className="mt-10 prose-measure">
        <section className={surfaceCardStyles({ padding: "lg" })}>
          <p className="type-eyebrow">{t("recommendEyebrow")}</p>
          <h2 className="mt-2 type-section text-ink">{t("recommendTitle")}</h2>
          <p className="mt-3 type-body-sm">{t("recommendDescription")}</p>
          <PathPoints
            points={[
              t("recommendPoint1"),
              t("recommendPoint2"),
              t("recommendPoint3"),
            ]}
          />
          <Link
            href={recommendPath}
            data-ph-no-autocapture
            onClick={() => trackSubmissionPathSelected("recommend", isLoggedIn)}
            className={cn(buttonVariants({ variant: "primary" }), "mt-6")}
          >
            {t("recommendCta")}
          </Link>
        </section>
        <p className="mt-6 type-body-sm text-ink-muted">{t("ownerNote")}</p>
      </div>
    </PageShell>
  );
}
