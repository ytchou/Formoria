import type { Metadata } from "next";
import { decodeJwt } from "jose";
import { getLocale } from "next-intl/server";
import { redirectIfAuthenticated } from "@/lib/auth/redirect-if-authenticated";
import { SignUpForm } from "@/components/auth/sign-up-form";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: locale === 'en' ? 'Sign Up' : '註冊',
    robots: { index: false, follow: true },
  };
}

type Props = {
  searchParams: Promise<{ claim?: string }>;
};

export default async function SignUpPage({ searchParams }: Props) {
  await redirectIfAuthenticated();

  const params = await searchParams;
  const claimToken = params.claim;
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
