import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getBrandBySlug } from "@/lib/services/brands";
import { computeBrandCompleteness } from "@/lib/services/brand-completeness";
import { isOwnerOf } from "@/lib/services/brand-owners";
import {
  getAnalytics,
  getDailySeries,
  getLinkClickBreakdown,
} from "@/lib/services/brand-analytics";
import { AnalyticsCards } from "@/components/dashboard/analytics-cards";
import { AnalyticsChart } from "@/components/dashboard/analytics-chart";
import { LinkBreakdown } from "@/components/dashboard/link-breakdown";
import { BrandCompletenessCard } from "@/components/dashboard/brand-completeness-card";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "品牌管理",
};

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function BrandDashboardPage({ params }: Props) {
  const { slug } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/sign-in");

  const brand = await getBrandBySlug(slug);
  const completeness = computeBrandCompleteness(brand);
  const owner = await isOwnerOf(user.id, brand.id);

  if (!owner) redirect("/dashboard");

  const [analytics, series, breakdown] = await Promise.all([
    getAnalytics(brand.id, 30),
    getDailySeries(brand.id, 90),
    getLinkClickBreakdown(brand.id, 90),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">
            {brand.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            管理您的品牌頁面
          </p>
        </div>
        <Link href={`/dashboard/brands/${slug}/edit`}>
          <Button>編輯品牌</Button>
        </Link>
      </div>

      <div className="mt-8">
        <h2 className="mb-4 text-sm font-semibold uppercase text-muted-foreground">
          Analytics
        </h2>
        <AnalyticsCards
          totalViews={analytics.totalViews}
          totalClicks={analytics.totalClicks}
          viewTrend={analytics.viewTrend}
          clickTrend={analytics.clickTrend}
        />
      </div>

      <div className="mt-8">
        <BrandCompletenessCard completeness={completeness} slug={brand.slug} />
      </div>

      <div className="mt-8 grid gap-6">
        <AnalyticsChart series={series} />
        <LinkBreakdown rows={breakdown} />
      </div>

      <div className="mt-8 grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Description
              </p>
              <p className="mt-1 text-sm">
                {brand.description ?? "尚未填寫介紹"}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Category
              </p>
              <p className="mt-1 text-sm">
                {brand.category ?? "未分類"}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Website
              </p>
              <p className="mt-1 text-sm">
                {brand.socialLinks.officialWebsite ?? "未設定"}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Social Links
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
                  !brand.socialLinks.facebook && <p>None set</p>}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Public Page
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Link
              href={`/${slug}`}
              className="text-sm text-primary hover:underline"
            >
              在 Formoria 查看您的品牌
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6">
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground hover:underline"
        >
          返回品牌管理
        </Link>
      </div>
    </div>
  );
}
