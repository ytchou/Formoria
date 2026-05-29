import type { Metadata } from "next";
import { decodeJwt } from "jose";
import { SignUpForm } from "@/components/auth/sign-up-form";

export const metadata: Metadata = {
  title: "註冊",
};

type Props = {
  searchParams: Promise<{ claim?: string }>;
};

export default async function SignUpPage({ searchParams }: Props) {
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
