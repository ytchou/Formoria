import { revalidatePath } from "next/cache";
import { setRequestLocale } from "next-intl/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getBrandBySlug } from "@/lib/services/brands";
import { computeProfileCompleteness } from "@/lib/services/profile-completeness";
import { canManageDashboardBrand } from "@/lib/auth/admin-mode";
import { requireBrandEditor } from "@/lib/auth/require-brand-editor";
import { ProfileCompletenessCard } from "@/components/dashboard/profile-completeness-card";
import { InlineVerification } from "@/components/dashboard/inline-verification";
import { OwnerBrandOverview } from "@/components/dashboard/owner-brand-overview";
import { WelcomeBanner } from "@/components/dashboard/welcome-banner";
import { BrandDashboardShell } from "@/components/dashboard/brand-dashboard-shell";

type Props = {
  params: Promise<{ locale: string; slug: string }>;
};

export default async function BrandOverviewPage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const brand = await getBrandBySlug(slug);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const ownerCheck = user
    ? await canManageDashboardBrand(user.id, user.email, brand.id, slug)
    : false;
  const completeness = computeProfileCompleteness(brand);

  async function dismissWelcome() {
    "use server";

    const editor = await requireBrandEditor(slug);
    if ("error" in editor) return;

    const supabase = createServiceClient();
    await supabase
      .from("brands")
      .update({ onboarding_dismissed_at: new Date().toISOString() })
      .eq("id", brand.id);
    revalidatePath(`/dashboard/brands/${slug}`);
  }

  const content = (
    <div className="w-full space-y-8" data-testid="brand-profile">
      <div className="space-y-8">
        <ProfileCompletenessCard completeness={completeness} slug={slug} />
        <OwnerBrandOverview
          brand={brand}
          verification={
            <InlineVerification
              brandId={brand.id}
              embedded
              mitStatus={brand.mitStatus ?? "unverified"}
              mitEvidence={brand.mitEvidence ?? undefined}
            />
          }
        />
      </div>
    </div>
  );

  return (
    <BrandDashboardShell brandName={brand.name} brandSlug={brand.slug}>
      <div className="space-y-8">
        {ownerCheck && !brand.onboardingDismissedAt ? (
          <WelcomeBanner brandSlug={slug} dismissAction={dismissWelcome} />
        ) : null}
        {content}
      </div>
    </BrandDashboardShell>
  );
}
