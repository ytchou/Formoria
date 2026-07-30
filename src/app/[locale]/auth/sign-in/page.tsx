import type { Metadata } from "next";
import { decodeJwt } from "jose";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirectIfAuthenticated } from "@/lib/auth/redirect-if-authenticated";
import { SignInForm } from "@/components/auth/sign-in-form";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ claim?: string; error?: string }>;
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
    // Not signIn.heading — the zh-TW heading is "登入 Formoria", and the layout
    // template appends "| Formoria", producing "登入 Formoria | Formoria" (DEV-698).
    // metaTitle carries the brand-free form so the template supplies it exactly once.
    title: t("signIn.metaTitle"),
    robots: { index: false, follow: true },
  };
}

export default async function SignInPage({ params, searchParams }: Props) {
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
      // Invalid token — ignore
    }
  }

  return (
    <SignInForm
      claimToken={claimToken}
      claimBrandName={claimBrandName}
      errorCode={search.error}
    />
  );
}
