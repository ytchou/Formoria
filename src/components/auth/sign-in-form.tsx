"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { signIn, signInWithGoogle } from "@/app/auth/actions";
import type { AuthState } from "@/app/auth/actions";
import { GoogleButton } from "@/components/auth/google-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SignInFormProps = {
  claimToken?: string;
  claimBrandName?: string;
};

export function SignInForm({ claimToken, claimBrandName }: SignInFormProps) {
  const [state, action, pending] = useActionState<AuthState, FormData>(signIn, {});
  const searchParams = useSearchParams();
  const message = searchParams.get("message");
  const next = searchParams.get("next");
  const googleAction = signInWithGoogle.bind(null, claimToken, next ?? undefined);
  const t = useTranslations("auth");

  const signUpHref = claimToken
    ? `/auth/sign-up?claim=${claimToken}`
    : "/auth/sign-up";

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="font-heading text-2xl font-bold tracking-tight">
          {t("signIn.heading")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("signIn.subheading")}
        </p>
      </div>

      {claimToken && claimBrandName && (
        <div className="rounded-lg border border-[#E06B3F]/20 bg-[#E06B3F]/5 px-4 py-3 text-sm">
          {t.rich("signIn.claimMessage", {
            brandName: claimBrandName,
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        </div>
      )}

      {message && (
        <div className="rounded-lg bg-secondary px-4 py-3 text-sm text-secondary-foreground">
          {message}
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
        {next && (
          <input type="hidden" name="next" value={next} />
        )}

        <div className="space-y-2">
          <Label htmlFor="email">{t("signIn.emailLabel")}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="you@example.com"
            required
            autoComplete="email"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">{t("signIn.passwordLabel")}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
        </div>

        <Button type="submit" className="w-full" size="lg" disabled={pending}>
          {pending ? t("signIn.submitting") : t("signIn.submit")}
        </Button>
      </form>

      <GoogleButton action={googleAction} />

      <p className="text-center text-sm text-muted-foreground">
        {t("signIn.noAccount")}{" "}
        <Link
          href={signUpHref}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {t("signIn.signUpLink")}
        </Link>
      </p>
    </div>
  );
}
