"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { signInWithGoogle, signUp } from "@/app/auth/actions";
import type { AuthState } from "@/app/auth/actions";
import { GoogleButton } from "@/components/auth/google-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SignUpFormProps = {
  claimToken?: string;
  claimBrandName?: string;
};

export function SignUpForm({ claimToken, claimBrandName }: SignUpFormProps) {
  const [state, action, pending] = useActionState<AuthState, FormData>(signUp, {});
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";
  const googleAction = signInWithGoogle.bind(null, claimToken, undefined);
  const t = useTranslations("auth");

  const signInHref = claimToken
    ? `/auth/sign-in?claim=${claimToken}`
    : "/auth/sign-in";

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="font-heading text-2xl font-bold tracking-tight">
          {t("signUp.heading")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("signUp.subheading")}
        </p>
      </div>

      {claimToken && claimBrandName && (
        <div className="rounded-lg border border-[#E06B3F]/20 bg-[#E06B3F]/5 px-4 py-3 text-sm">
          {t.rich("signUp.claimMessage", {
            brandName: claimBrandName,
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        </div>
      )}

      {state.error && (
        <div role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {state.error}
        </div>
      )}

      <form action={action} className="space-y-4">
        {claimToken && (
          <input type="hidden" name="claimToken" value={claimToken} />
        )}

        <div className="space-y-2">
          <Label htmlFor="email">{t("signUp.emailLabel")}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="you@example.com"
            defaultValue={email}
            required
            autoComplete="email"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">{t("signUp.passwordLabel")}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder={t("signUp.passwordPlaceholder")}
            required
            autoComplete="new-password"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">{t("signUp.confirmPasswordLabel")}</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            autoComplete="new-password"
          />
        </div>

        <Button type="submit" className="w-full" size="lg" disabled={pending}>
          {pending ? t("signUp.submitting") : t("signUp.submit")}
        </Button>
      </form>

      <GoogleButton action={googleAction} />

      <p className="text-center text-sm text-muted-foreground">
        {t("signUp.hasAccount")}{" "}
        <Link
          href={signInHref}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {t("signUp.signInLink")}
        </Link>
      </p>
    </div>
  );
}
