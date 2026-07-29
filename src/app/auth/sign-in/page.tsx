import type { Metadata } from "next";
import { decodeJwt } from "jose";
import { getTranslations } from "next-intl/server";
import { redirectIfAuthenticated } from "@/lib/auth/redirect-if-authenticated";
import { SignInForm } from "@/components/auth/sign-in-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return {
    title: t("signIn.heading"),
    robots: { index: false, follow: true },
  };
}

type Props = {
  searchParams: Promise<{ claim?: string; error?: string }>;
};

export default async function SignInPage({ searchParams }: Props) {
  await redirectIfAuthenticated();

  const params = await searchParams;
  const claimToken = params.claim;
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
      errorCode={params.error}
    />
  );
}
