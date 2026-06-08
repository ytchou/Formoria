import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { canManageBrand } from "@/lib/auth/admin-mode";
import { getBrandBySlug } from "@/lib/services/brands";
import { computeBrandCompleteness } from "@/lib/services/brand-completeness";
import {
  getAnalytics,
  getDailySeries,
  getLinkClickBreakdown,
  getSourceBreakdown,
} from "@/lib/services/brand-analytics";
import { BrandCompletenessCard } from "@/components/dashboard/brand-completeness-card";
import { MitStatusCard } from "./mit-status-card";
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

type Props = {
  params: Promise<{ slug: string; locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "dashboard.manage" });
  return { title: t("metaTitle") };
}

export default async function BrandDashboardPage({ params }: Props) {
  const { slug } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/sign-in");

  const brand = await getBrandBySlug(slug);
  const completeness = computeBrandCompleteness(brand);
  const owner = await canManageBrand(user.id, user.email, brand.id);

  if (!owner) redirect("/dashboard");

  const [analytics, series, breakdown, sources] = await Promise.all([
    getAnalytics(brand.id, 30),
    getDailySeries(brand.id, 90),
    getLinkClickBreakdown(brand.id, 90),
    getSourceBreakdown(brand.id, 30),
  ]);

  const t = await getTranslations("dashboard.manage");

  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">
            {brand.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        <Link href={`/dashboard/brands/${slug}/edit`}>
          <Button>{t("editButton")}</Button>
        </Link>
      </div>

      <div className="mt-8 space-y-6">
        <h2 className="mb-4 text-sm font-semibold uppercase text-muted-foreground">
          {t("analyticsHeading")}
        </h2>
        <AnalyticsCards
          totalViews={analytics.totalViews}
          totalClicks={analytics.totalClicks}
          viewTrend={analytics.viewTrend}
          clickTrend={analytics.clickTrend}
        />
        <SourcesBreakdownCard sources={sources} />
      </div>

      <div className="mt-8">
        <BrandCompletenessCard completeness={completeness} slug={brand.slug} />
      </div>

      <div className="mt-8">
        <MitStatusCard brand={brand} />
      </div>

      <div className="mt-8 grid gap-6">
        <AnalyticsChart series={series} />
        <LinkBreakdown rows={breakdown} />
      </div>

      <div className="mt-8 grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("detailsCardTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">
                {t("descriptionLabel")}
              </p>
              <p className="mt-1 text-sm">
                {brand.description ?? t("noDescription")}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">
                {t("categoryLabel")}
              </p>
              <p className="mt-1 text-sm">
                {brand.category ?? t("noCategory")}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">
                {t("websiteLabel")}
              </p>
              <p className="mt-1 text-sm">
                {brand.socialLinks.officialWebsite ?? t("noWebsite")}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">
                {t("socialLinksLabel")}
              </p>
              <div className="mt-1 space-y-1 text-sm">
                {brand.socialLinks.instagram && (
                  <p>Instagram: {brand.socialLinks.instagram}</p>
                )}
                {brand.socialLinks.threads && (
                  <p>Threads: {brand.socialLinks.threads}</p>
                )}
                {brand.socialLinks.facebook && (
                  <p>Facebook: {brand.socialLinks.facebook}</p>
                )}
                {!brand.socialLinks.instagram &&
                  !brand.socialLinks.threads &&
                  !brand.socialLinks.facebook && <p>{t("socialLinksNone")}</p>}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("publicPageCardTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Link
              href={`/${slug}`}
              className="text-sm text-primary hover:underline"
            >
              {t("viewOnFormoria")}
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6">
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground hover:underline"
        >
          {t("backToDashboard")}
        </Link>
      </div>
    </div>
  );
}
