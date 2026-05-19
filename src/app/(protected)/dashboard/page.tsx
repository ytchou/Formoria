import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getUserBrands } from "@/lib/services/brand-owners";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Dashboard | MIT Map",
};

const ERROR_MESSAGES: Record<string, string> = {
  "invalid-claim": "The claim link is invalid or has expired. Please contact support.",
  "email-mismatch": "The email you signed in with does not match the claim invitation. Please sign in with the correct email.",
  "claim-failed": "This brand has already been claimed. If you believe this is an error, please contact support.",
};

type Props = {
  searchParams: Promise<{ error?: string }>;
};

export default async function DashboardPage({ searchParams }: Props) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const brands = user ? await getUserBrands(user.id) : [];
  const errorMessage = params.error ? ERROR_MESSAGES[params.error] : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="font-heading text-3xl font-bold tracking-tight">
        Dashboard
      </h1>
      <p className="mt-2 text-muted-foreground">
        Welcome, {user?.email}
      </p>

      {errorMessage && (
        <div className="mt-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </div>
      )}

      <div className="mt-8">
        <h2 className="font-heading text-xl font-semibold tracking-tight">
          Your Brands
        </h2>

        {brands.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No claimed brands yet. When you claim a brand listing, it will appear here.
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
                      Claimed {new Date(brand.claimedAt).toLocaleDateString()}
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
