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
  title: "品牌管理",
};

const ERROR_MESSAGES: Record<string, string> = {
  "invalid-claim": "認領連結無效或已過期，請聯繫客服。",
  "email-mismatch": "您登入的電子郵件與認領邀請不符，請使用正確的電子郵件登入。",
  "claim-failed": "此品牌已被認領。若您認為有誤，請聯繫客服。",
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
        品牌管理
      </h1>
      <p className="mt-2 text-muted-foreground">
        歡迎，{user?.email}
      </p>

      {errorMessage && (
        <div className="mt-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </div>
      )}

      <div className="mt-8">
        <h2 className="font-heading text-xl font-semibold tracking-tight">
          您的品牌
        </h2>

        {brands.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            尚未認領任何品牌。認領品牌後，它將顯示在此處。
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
