import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirectIfAuthenticated } from "@/lib/auth/redirect-if-authenticated";
import { SignInForm } from "@/components/auth/sign-in-form";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
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
    // Do not use signIn.heading: it already contains the brand name, while the
    // layout template appends it again (DEV-698).
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

  return <SignInForm errorCode={search.error} />;
}
