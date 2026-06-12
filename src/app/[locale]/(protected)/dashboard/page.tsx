import type { Metadata } from "next";
import { Link as IntlLink } from "@/i18n/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Heart } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getUserBrands } from "@/lib/services/brand-owners";
import { getUserSubmissions } from "@/lib/services/submissions";
import { getUserSavedBrands } from "@/lib/services/saved-brands";
import { Badge } from "@/components/ui/badge";
import { BrandManagementPanel } from "@/components/dashboard/brand-management-panel";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; tab?: string }>;
};

const SUBMISSIONS_TAB = "submissions";
const SAVED_TAB = "saved";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-[#F5F4F1] text-[#7C7570] border-[#D4CFC9]",
  approved: "bg-green-50 text-green-700 border-green-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("dashboard");
  return {
    title: t("metadata.title"),
  };
}

export default async function DashboardPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("dashboard");
  const submissionsT = await getTranslations("mySubmissions");
  const saveBrandT = await getTranslations("saveBrand");

  const resolvedSearchParams = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [brands, submissions, savedBrands] = user
    ? await Promise.all([
        getUserBrands(user.id),
        getUserSubmissions(user.email ?? ""),
        getUserSavedBrands(user.id),
      ])
    : [[], [], []];

  const ERROR_KEYS: Record<string, "errors.invalidClaim" | "errors.emailMismatch" | "errors.claimFailed"> = {
    "invalid-claim": "errors.invalidClaim",
    "email-mismatch": "errors.emailMismatch",
    "claim-failed": "errors.claimFailed",
  };

  const errorKey = resolvedSearchParams.error ? ERROR_KEYS[resolvedSearchParams.error] : undefined;
  const errorMessage = errorKey ? t(errorKey) : null;

  const hasBrands = brands.length > 0;
  const requestedTab = resolvedSearchParams.tab;
  const showSavedTab = savedBrands.length > 0 || requestedTab === SAVED_TAB;
  const hasTabbedContent = hasBrands || showSavedTab;
  const defaultTab = brands.at(0)?.brandSlug ?? (showSavedTab ? SAVED_TAB : SUBMISSIONS_TAB);
  const selectedTab =
    requestedTab && brands.some((brand) => brand.brandSlug === requestedTab)
      ? requestedTab
      : requestedTab === SAVED_TAB && showSavedTab
        ? SAVED_TAB
      : requestedTab === SUBMISSIONS_TAB
        ? SUBMISSIONS_TAB
        : defaultTab;

  const submissionsSection = (
    <div>
      <h2 className="font-heading text-xl font-semibold tracking-tight">
        {submissionsT("heading")}
      </h2>
      <p className="mt-2 text-sm text-[#7C7570]">
        {submissionsT("subheading")}
      </p>

      {submissions.length === 0 ? (
        <div className="mt-8 rounded-xl border border-[#E8E5E0] bg-white p-8 text-center">
          <p className="text-sm text-[#7C7570]">
            {submissionsT("empty.message")}
          </p>
          <IntlLink
            href="/submit"
            className="mt-4 inline-flex rounded-full bg-[#E06B3F] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#C85A33]"
          >
            {submissionsT("empty.cta")}
          </IntlLink>
        </div>
      ) : (
        <div className="mt-8 space-y-3">
          {submissions.map((sub) => (
            <div
              key={sub.id}
              className="flex items-center justify-between rounded-xl border border-[#E8E5E0] bg-white px-5 py-4"
            >
              <div>
                <p className="font-medium text-[#1A1918]">{sub.brandName}</p>
                <p className="mt-0.5 text-xs text-[#B0AAA4]">
                  {new Date(sub.createdAt).toLocaleDateString(
                    locale === "en" ? "en-US" : "zh-TW"
                  )}
                </p>
              </div>
              <Badge
                variant="outline"
                className={STATUS_COLORS[sub.status] ?? STATUS_COLORS.pending}
              >
                {sub.status === "approved"
                  ? submissionsT("status.approved")
                  : sub.status === "rejected"
                    ? submissionsT("status.rejected")
                    : submissionsT("status.pending")}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const savedBrandsSection = (
    <div>
      {savedBrands.length === 0 ? (
        <div className="rounded-xl border border-[#E8E5E0] bg-white p-10 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-[#E8E5E0] text-[#2F5D50]">
            <Heart className="h-5 w-5" aria-hidden />
          </div>
          <h2 className="mt-5 font-heading text-xl font-semibold tracking-tight text-[#1A1918]">
            {saveBrandT("emptyTitle")}
          </h2>
          <p className="mt-2 text-sm text-[#7C7570]">
            {saveBrandT("emptyDescription")}
          </p>
          <IntlLink
            href="/brands"
            className="mt-6 inline-flex rounded-full bg-[#2F5D50] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#254A40]"
          >
            {saveBrandT("exploreBrands")}
          </IntlLink>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {savedBrands.map((brand) => (
            <IntlLink
              key={brand.brandId}
              href={`/brands/${brand.brandSlug}`}
              className="group flex items-center gap-4 rounded-xl border border-[#E8E5E0] bg-white p-4 transition-colors hover:border-[#2F5D50]"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#F5F4F1] font-heading text-lg font-semibold text-[#2F5D50]">
                {brand.brandName.charAt(0)}
              </div>
              <div className="min-w-0">
                <h2 className="truncate font-heading text-base font-semibold tracking-tight text-[#1A1918]">
                  {brand.brandName}
                </h2>
                <p className="mt-1 text-sm text-[#7C7570]">
                  /brands/{brand.brandSlug}
                </p>
              </div>
            </IntlLink>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="font-heading text-3xl font-bold tracking-tight">
        {t("heading")}
      </h1>
      <p className="mt-2 text-muted-foreground">
        {t("welcome", { email: user?.email ?? "" })}
      </p>

      {errorMessage && (
        <div className="mt-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </div>
      )}

      {hasTabbedContent ? (
        <>
          <div className="mt-8 flex flex-wrap gap-1 border-b border-[#E8E5E0]">
            {brands.map((brand) => (
              <IntlLink
                key={brand.brandId}
                href={`/dashboard?tab=${brand.brandSlug}`}
                className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                  selectedTab === brand.brandSlug
                    ? "border-[#E06B3F] text-[#1A1918]"
                    : "border-transparent text-[#7C7570] hover:text-[#1A1918]"
                }`}
              >
                {brand.brandName}
              </IntlLink>
            ))}
            {showSavedTab && (
              <IntlLink
                href={`/dashboard?tab=${SAVED_TAB}`}
                className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                  selectedTab === SAVED_TAB
                    ? "border-[#E06B3F] text-[#1A1918]"
                    : "border-transparent text-[#7C7570] hover:text-[#1A1918]"
                }`}
              >
                {saveBrandT("savedTab")}
              </IntlLink>
            )}
            <IntlLink
              href={`/dashboard?tab=${SUBMISSIONS_TAB}`}
              className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                selectedTab === SUBMISSIONS_TAB
                  ? "border-[#E06B3F] text-[#1A1918]"
                  : "border-transparent text-[#7C7570] hover:text-[#1A1918]"
              }`}
            >
              {t("tabs.submissions")}
            </IntlLink>
          </div>

          <div className="mt-8">
            {selectedTab === SUBMISSIONS_TAB ? (
              submissionsSection
            ) : selectedTab === SAVED_TAB ? (
              savedBrandsSection
            ) : (
              <BrandManagementPanel slug={selectedTab} />
            )}
          </div>
        </>
      ) : (
        <div className="mt-8 space-y-12">
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
          {submissionsSection}
        </div>
      )}
    </div>
  );
}
