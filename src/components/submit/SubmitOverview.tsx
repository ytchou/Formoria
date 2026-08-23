"use client";

import { useState, useTransition } from "react";
import NextLink from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import { signInHref } from "@/i18n/locale-preference";
import { trackSubmissionPathSelected } from "@/lib/analytics";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { surfaceCardStyles } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import { Check, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { routes } from "@/lib/routes";

/**
 * The three selling points under each path. `muted` drops the CTA accent so the
 * gated owner card reads as inactive without dimming the whole surface with
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
  ownerPath?: string;
  recommendPath?: string;
  isLoggedIn?: boolean;
  hasOwnedBrand?: boolean;
  /**
   * Owner-features kill switch, resolved server-side and passed down: this stays
   * a presentational component and never reads the flag itself. Defaults closed
   * so a caller that forgets the prop hides the owner fork rather than exposing
   * a route that 404s.
   */
  ownerFeaturesEnabled?: boolean;
};

export default function SubmitOverview({
  ownerPath = routes.submit.owner(),
  recommendPath = routes.submit.recommend(),
  isLoggedIn = false,
  hasOwnedBrand = false,
  ownerFeaturesEnabled = false,
}: SubmitOverviewProps) {
  const t = useTranslations("submit.overview");
  const locale = useLocale();
  const router = useRouter();
  const [isOwnerLimitOpen, setIsOwnerLimitOpen] = useState(false);
  const [isNavigating, startNavigation] = useTransition();

  function handleRecommendationNavigation() {
    startNavigation(() => {
      try {
        router.push(recommendPath);
      } catch {
        toast.error(t("ownerLimitNavigationError"));
      }
    });
  }

  return (
    <PageShell as="main" measure="form" className="py-20">
      <div className="prose-measure">
        <h1 className="text-balance type-page-title">{t("heading")}</h1>
        <p className="mt-4 type-body-sm">{t("description")}</p>
      </div>

      {/* Two columns in both flag states: while the owner fork is gated its card
          stays in place as a coming-soon placeholder, so turning the flag on is
          a content change and never a re-layout. */}
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

        {ownerFeaturesEnabled ? (
          <section className={surfaceCardStyles({ padding: "lg" })}>
            <p className="type-eyebrow">{t("ownerEyebrow")}</p>
            <h2 className="mt-2 type-section text-ink">{t("ownerTitle")}</h2>
            <p className="mt-3 type-body-sm">{t("ownerDescription")}</p>
            <PathPoints
              points={[t("ownerPoint1"), t("ownerPoint2"), t("ownerPoint3")]}
            />
            {hasOwnedBrand ? (
              <>
                <Button
                  type="button"
                  className="mt-6"
                  size="large"
                  data-ph-no-autocapture
                  onClick={() => {
                    trackSubmissionPathSelected("claim", true);
                    setIsOwnerLimitOpen(true);
                  }}
                >
                  {t("ownerCtaLoggedIn")}
                </Button>
                <AlertDialog
                  open={isOwnerLimitOpen}
                  onOpenChange={setIsOwnerLimitOpen}
                >
                  {/* NO X, AND NO `!` OVERRIDES. The width is the shared size
                      axis now; the important-flagged width pair existed only
                      to defeat the `data-[size=…]` hoisting that the size prop
                      now spells properly, so removing one of the two
                      without the other would silently drop the new sizing.
                      This dialog is informational, so it is NOT `destructive`
                      — Escape, the backdrop and the footer Cancel are the
                      exits, and an icon button beside them would be a fourth. */}
                  <AlertDialogContent size="form">
                    {/* NO `alert-dialog-media` SLOT, AND THE CENTRING IS
                        RESTORED. `AlertDialogHeader`'s media layout puts the
                        title in column 2 from `sm` up but declares no
                        `grid-cols`, so the description auto-places back into
                        column 1 under the icon. This header is a centred
                        icon/title/description stack at every width, which the
                        default (non-media) layout already renders — the two
                        `sm:` classes below only hold the centring the shell
                        drops at `sm`, and tailwind-merge replaces the shell's
                        own pair because the modifiers match. */}
                    <AlertDialogHeader className="sm:place-items-center sm:text-center">
                      <span
                        aria-hidden="true"
                        className="flex size-12 items-center justify-center rounded-full bg-accent/10 text-accent"
                      >
                        <Info className="size-5" />
                      </span>
                      <AlertDialogTitle className="type-section">
                        {t("ownerLimitTitle")}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {t("ownerLimitDescription")}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="sm:[&>*]:flex-1">
                      <AlertDialogCancel size="large">
                        {t("ownerLimitCancelCta")}
                      </AlertDialogCancel>
                      <Button
                        type="button"
                        size="large"
                        disabled={isNavigating}
                        onClick={handleRecommendationNavigation}
                      >
                        {t("ownerLimitRecommendCta")}
                      </Button>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            ) : isLoggedIn ? (
              <Link
                href={ownerPath}
                data-ph-no-autocapture
                onClick={() => trackSubmissionPathSelected("claim", true)}
                className={cn(buttonVariants({ variant: "primary" }), "mt-6")}
              >
                {t("ownerCtaLoggedIn")}
              </Link>
            ) : (
              <NextLink
                href={signInHref(ownerPath, locale)}
                data-ph-no-autocapture
                onClick={() => trackSubmissionPathSelected("claim", false)}
                className={cn(buttonVariants({ variant: "primary" }), "mt-6")}
              >
                {t("ownerCta")}
              </NextLink>
            )}
          </section>
        ) : (
          // No CTA at all rather than a disabled button: a control that can
          // never enable is noise for pointer and screen-reader users alike.
          // The badge states the same thing and stays out of the tab order.
          <section
            className={cn(
              surfaceCardStyles({ padding: "lg" }),
              "bg-surface/30",
            )}
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
        )}
      </div>
    </PageShell>
  );
}
