import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirectIfAuthenticated } from "@/lib/auth/redirect-if-authenticated";
import { SignUpForm } from "@/components/auth/sign-up-form";

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
  return {
    title: t("signUp.heading"),
    robots: { index: false, follow: true },
  };
}

export default async function SignUpPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  await redirectIfAuthenticated();

  return <SignUpForm />;
}
