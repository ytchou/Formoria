import type { Metadata } from "next";
import { Link as IntlLink } from "@/i18n/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Heart } from "lucide-react";
import { isActingAsAdmin } from "@/lib/auth/admin-mode";
import { createClient } from "@/lib/supabase/server";
import { getBrandBySlugForAdmin, getUserBrands } from "@/lib/services/brand-owners";
import { getProfile } from "@/lib/services/profiles";
import { getUserSavedBrands } from "@/lib/services/saved-brands";
import { BrandManagementPanel } from "@/components/dashboard/brand-management-panel";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; tab?: string }>;
};

const SAVED_TAB = "saved";

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
  const saveBrandT = await getTranslations("saveBrand");

  const resolvedSearchParams = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const profile = user ? await getProfile(user.id) : null;
  const displayName = profile?.displayName ?? user?.email?.split("@")[0] ?? "";

  const [brands, savedBrands] = user
    ? await Promise.all([
        getUserBrands(user.id),
        getUserSavedBrands(user.id),
      ])
    : [[], []];

  // God mode: if admin requests a brand they don't own, fetch it and prepend
  let allBrands = brands
  const requestedTab = resolvedSearchParams.tab
  if (
    user &&
    requestedTab &&
    requestedTab !== SAVED_TAB &&
    requestedTab !== "submissions" &&
    !brands.some((b) => b.brandSlug === requestedTab)
  ) {
    if (await isActingAsAdmin(user.email)) {
      try {
        const godBrand = await getBrandBySlugForAdmin(requestedTab)
        if (godBrand) allBrands = [godBrand, ...brands]
      } catch {
        // Invalid slug — fall through to default tab
      }
    }
  }

  const ERROR_KEYS: Record<string, "errors.invalidClaim" | "errors.emailMismatch" | "errors.claimFailed"> = {
    "invalid-claim": "errors.invalidClaim",
    "email-mismatch": "errors.emailMismatch",
    "claim-failed": "errors.claimFailed",
  };

  const errorKey = resolvedSearchParams.error ? ERROR_KEYS[resolvedSearchParams.error] : undefined;
  const errorMessage = errorKey ? t(errorKey) : null;

  const hasBrands = allBrands.length > 0;
  const showSavedTab = savedBrands.length > 0 || requestedTab === SAVED_TAB;
  const hasTabbedContent = hasBrands || showSavedTab;
  const defaultTab = allBrands.at(0)?.brandSlug ?? (showSavedTab ? SAVED_TAB : undefined);
  const selectedTab =
    requestedTab && allBrands.some((brand) => brand.brandSlug === requestedTab)
      ? requestedTab
      : requestedTab === SAVED_TAB && showSavedTab
        ? SAVED_TAB
        : defaultTab;
  const selectedBrand =
    selectedTab && selectedTab !== SAVED_TAB
      ? allBrands.find((brand) => brand.brandSlug === selectedTab) ?? null
      : null;

  const savedBrandsSection = (
    <div>
      {savedBrands.length === 0 ? (
        <div className="rounded-xl border border-border bg-white p-10 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-border text-primary">
            <Heart className="h-5 w-5" aria-hidden />
          </div>
          <h2 className="mt-5 font-heading text-xl font-semibold tracking-tight text-foreground">
            {saveBrandT("emptyTitle")}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {saveBrandT("emptyDescription")}
          </p>
          <IntlLink
            href="/brands"
            className="mt-6 inline-flex rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-dark"
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
              className="group flex items-center gap-4 rounded-xl border border-border bg-white p-4 transition-colors hover:border-primary"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted font-heading text-lg font-semibold text-primary">
                {[...brand.brandName][0]}
              </div>
              <div className="min-w-0">
                <h2 className="truncate font-heading text-base font-semibold tracking-tight text-foreground">
                  {brand.brandName}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  /brands/{brand.brandSlug}
                </p>
              </div>
            </IntlLink>
          ))}
        </div>
      )}
    </div>
  );

  const emptyState = (
    <div className="mt-8 rounded-xl border border-border bg-white p-10 text-center">
      <p className="text-sm text-muted-foreground">{t("empty")}</p>
      <IntlLink
        href="/brands"
        className="mt-6 inline-flex rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-dark"
      >
        {saveBrandT("exploreBrands")}
      </IntlLink>
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="font-heading text-3xl font-bold tracking-tight">
        {t("heading")}
      </h1>
      <p className="mt-2 text-muted-foreground">
        {t("welcome", { name: displayName })}
      </p>

      {errorMessage && (
        <div className="mt-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </div>
      )}

      {hasTabbedContent ? (
        <>
          <div className="mt-8 flex flex-wrap gap-1 border-b border-border">
            {allBrands.map((brand) => (
              <IntlLink
                key={brand.brandId}
                href={`/dashboard?tab=${brand.brandSlug}`}
                className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                  selectedTab === brand.brandSlug
                    ? "border-cta text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
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
                    ? "border-cta text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {saveBrandT("savedTab")}
              </IntlLink>
            )}
          </div>

          <div className="mt-8">
            {selectedTab === SAVED_TAB ? (
              savedBrandsSection
            ) : selectedBrand ? (
              <BrandManagementPanel
                slug={selectedBrand.brandSlug}
                claimedAt={selectedBrand.claimedAt}
                userId={user?.id ?? ""}
              />
            ) : (
              emptyState
            )}
          </div>
        </>
      ) : (
        emptyState
      )}
    </div>
  );
}
