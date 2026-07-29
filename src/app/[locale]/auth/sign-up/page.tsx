import type { Metadata } from "next";
import { decodeJwt } from "jose";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirectIfAuthenticated } from "@/lib/auth/redirect-if-authenticated";
import { SignUpForm } from "@/components/auth/sign-up-form";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ claim?: string }>;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth");
  return {
    title: t("signUp.heading"),
    robots: { index: false, follow: true },
  };
}

export default async function SignUpPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  await redirectIfAuthenticated();

  const search = await searchParams;
  const claimToken = search.claim;
  let claimBrandName: string | undefined;

  if (claimToken) {
    try {
      const payload = decodeJwt(claimToken);
      claimBrandName = (payload as Record<string, unknown>).brandName as string | undefined;
    } catch {
      // Invalid token — ignore, will be validated on callback
    }
  }

  return (
    <SignUpForm
      claimToken={claimToken}
      claimBrandName={claimBrandName}
    />
  );
}
