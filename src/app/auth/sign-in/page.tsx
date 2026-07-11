import type { Metadata } from "next";
import { decodeJwt } from "jose";
import { getLocale } from "next-intl/server";
import { SignInForm } from "@/components/auth/sign-in-form";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: locale === 'en' ? 'Sign In' : '登入' };
}

type Props = {
  searchParams: Promise<{ claim?: string }>;
};

export default async function SignInPage({ searchParams }: Props) {
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
    />
  );
}
