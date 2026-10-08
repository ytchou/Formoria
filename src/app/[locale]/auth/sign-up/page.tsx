import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirectIfAuthenticated } from "@/lib/auth/redirect-if-authenticated";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { shouldShowOptionalAuthMethods } from "@/lib/auth/optional-auth-methods";
import { buildPrivatePageMetadata } from "@/lib/seo/private-page-metadata";

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth");
  return buildPrivatePageMetadata({
    locale,
    title: t("signUp.heading"),
    description: t("signUp.metaDescription"),
  });
}

export default async function SignUpPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  await redirectIfAuthenticated();

  // Same gate as sign-in: staging must not offer Google here while hiding it
  // there (SP2-27).
  const showOptionalAuthMethods = await shouldShowOptionalAuthMethods();

  return <SignUpForm showOptionalAuthMethods={showOptionalAuthMethods} />;
}
