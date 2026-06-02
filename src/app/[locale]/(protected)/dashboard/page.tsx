import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getUserBrands } from "@/lib/services/brand-owners";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
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

  const resolvedSearchParams = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const brands = user ? await getUserBrands(user.id) : [];

  const ERROR_KEYS: Record<string, "errors.invalidClaim" | "errors.emailMismatch" | "errors.claimFailed"> = {
    "invalid-claim": "errors.invalidClaim",
    "email-mismatch": "errors.emailMismatch",
    "claim-failed": "errors.claimFailed",
  };

  const errorKey = resolvedSearchParams.error ? ERROR_KEYS[resolvedSearchParams.error] : undefined;
  const errorMessage = errorKey ? t(errorKey) : null;

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

      <div className="mt-8">
        <h2 className="font-heading text-xl font-semibold tracking-tight">
          {t("yourBrands")}
        </h2>

        {brands.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            {t("empty")}
          </p>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {brands.map((brand) => (
              <Link
                key={brand.brandId}
                href={`/dashboard/brands/${brand.brandSlug}`}
              >
                <Card className="transition-shadow hover:shadow-md">
                  <CardHeader>
                    <CardTitle className="text-lg">{brand.brandName}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">
                      {t("claimedAt", {
                        date: new Date(brand.claimedAt).toLocaleDateString(
                          locale === "en" ? "en-US" : "zh-TW"
                        ),
                      })}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
