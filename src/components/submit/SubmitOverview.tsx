"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { trackSubmissionPathSelected } from "@/lib/analytics";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { surfaceCardStyles } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { routes } from "@/lib/routes";

/**
 * The three selling points under each path. `muted` drops the CTA accent so the
 * retired owner card reads as inactive without dimming the whole surface with
 * opacity, which would wash out its border too.
 */
function PathPoints({ points, muted }: { points: string[]; muted?: boolean }) {
  return (
    <ul className="mt-5 space-y-2.5">
      {points.map((point) => (
        <li
          key={point}
          className="flex items-start gap-2 rounded-surface border border-rule/70 bg-ground/50 px-3 py-2.5"
        >
          <span
            aria-hidden="true"
            className={cn(
              "mt-0.5 inline-flex size-5 items-center justify-center rounded-full border",
              muted
                ? "border-rule bg-surface text-ink-muted"
                : "border-accent/25 bg-accent/10 text-accent",
            )}
          >
            <Check className="size-3" />
          </span>
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

      {/* Two columns: the owner fork was removed (DEV-1570), and its card stays
          in place as a coming-soon placeholder so the page keeps its layout. */}
      <div className="mt-10 grid gap-6 md:grid-cols-2">
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

        {/* No CTA at all rather than a disabled button: a control that can
            never enable is noise for pointer and screen-reader users alike.
            The badge states the same thing and stays out of the tab order. */}
        <section
          className={cn(surfaceCardStyles({ padding: "lg" }), "bg-surface/30")}
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="type-eyebrow">{t("ownerEyebrow")}</p>
            <Badge variant="declared">{t("ownerComingSoon")}</Badge>
          </div>
          <h2 className="mt-2 type-section text-ink-muted">
            {t("ownerTitle")}
          </h2>
          <p className="mt-3 type-body-sm">{t("ownerDescription")}</p>
          <PathPoints
            points={[t("ownerPoint1"), t("ownerPoint2"), t("ownerPoint3")]}
            muted
          />
        </section>
      </div>
    </PageShell>
  );
}
