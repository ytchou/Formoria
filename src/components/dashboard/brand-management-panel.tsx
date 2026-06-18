import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getBrandBySlug } from "@/lib/services/brands";
import { computeBrandCompleteness } from "@/lib/services/brand-completeness";
import { computeBrandHealth } from "@/lib/services/brand-health";
import {
  getAnalytics,
  getDailySeries,
  getLinkClickBreakdown,
  getSourceBreakdown,
} from "@/lib/services/brand-analytics";
import { getLatestEditReview } from "@/lib/services/pending-edits";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AnalyticsCards } from "@/components/dashboard/analytics-cards";
import { AnalyticsChart } from "@/components/dashboard/analytics-chart";
import { LinkBreakdown } from "@/components/dashboard/link-breakdown";
import { SourcesBreakdownCard } from "@/components/dashboard/sources-breakdown-card";
import { MitStatusCard } from "@/components/dashboard/mit-status-card";
import { BrandHealthCard } from "./brand-health-card";
import { WelcomeBanner } from "./welcome-banner";
import { EditReviewBanner } from "@/components/brands/edit-review-banner";

type Props = {
  slug: string;
  claimedAt: string | null;
  userId: string;
};

export async function BrandManagementPanel({ slug, claimedAt, userId }: Props) {
  const brand = await getBrandBySlug(slug);
  const completeness = computeBrandCompleteness(brand);

  const [analytics, series, breakdown, sources, latestReview] = await Promise.all([
    getAnalytics(brand.id, 30),
    getDailySeries(brand.id, 90),
    getLinkClickBreakdown(brand.id, 90),
    getSourceBreakdown(brand.id, 30),
    getLatestEditReview(brand.id, userId),
  ]);
  const health = computeBrandHealth(brand, analytics, new Date(brand.createdAt));

  const t = await getTranslations("dashboard.manage");

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-2xl font-bold tracking-tight">
            {brand.name}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/brands/${slug}`}>
            <Button variant="outline">{t("viewButton")}</Button>
          </Link>
          <Link href={`/dashboard/brands/${slug}/edit`}>
            <Button>{t("editButton")}</Button>
          </Link>
        </div>
      </div>

      <div className="mt-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("detailsCardTitle")}
            </CardTitle>
            <Link href={`/dashboard/brands/${slug}/edit`} className="text-sm text-primary hover:underline">
              {t("editButton")}
            </Link>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                {t("descriptionLabel")}
              </p>
              <p className="mt-1 text-sm">
                {brand.description ?? t("noDescription")}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">
                {t("categoryLabel")}
              </p>
              <p className="mt-1 text-sm">
                {brand.category ?? t("noCategory")}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">
                {t("websiteLabel")}
              </p>
              <p className="mt-1 text-sm">
                {brand.purchaseWebsite ?? t("noWebsite")}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">
                {t("socialLinksLabel")}
              </p>
              <div className="mt-1 space-y-1 text-sm">
                {brand.socialInstagram && (
                  <p>Instagram: {brand.socialInstagram}</p>
                )}
                {brand.socialThreads && (
                  <p>Threads: {brand.socialThreads}</p>
                )}
                {brand.socialFacebook && (
                  <p>Facebook: {brand.socialFacebook}</p>
                )}
                {!brand.socialInstagram &&
                  !brand.socialThreads &&
                  !brand.socialFacebook && <p>{t("socialLinksNone")}</p>}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-8 space-y-6">
        <WelcomeBanner
          claimedAt={claimedAt}
          completionFraction={completeness.fraction}
          slug={brand.slug}
          topAction={health.topActions[0]}
        />
        <EditReviewBanner edit={latestReview ?? null} brandSlug={brand.slug} />
        <h3 className="mb-4 text-sm font-semibold text-muted-foreground">
          {t("analyticsHeading")}
        </h3>
        <AnalyticsCards
          totalViews={analytics.totalViews}
          totalClicks={analytics.totalClicks}
          viewTrend={analytics.viewTrend}
          clickTrend={analytics.clickTrend}
        />
        <SourcesBreakdownCard sources={sources} />
      </div>

      <div className="mt-8">
        <BrandHealthCard
          health={health}
          completeness={completeness}
          slug={brand.slug}
        />
      </div>

      <div className="mt-8">
        <MitStatusCard brand={brand} />
      </div>

      <div className="mt-8 grid gap-6">
        <AnalyticsChart series={series} />
        <LinkBreakdown rows={breakdown} />
      </div>



    </div>
  );
}
