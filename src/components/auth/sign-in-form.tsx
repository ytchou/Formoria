"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { signIn, signInWithGoogle } from "@/app/auth/actions";
import type { AuthState } from "@/app/auth/actions";
import { GoogleButton } from "@/components/auth/google-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SignInFormProps = {
  claimToken?: string;
  claimBrandName?: string;
  /** `?error=` code written by /auth/callback and the OAuth action. */
  errorCode?: string;
};

const ERROR_MESSAGE_KEYS = {
  "missing-code": "signIn.errors.missingCode",
  "expired-code": "signIn.errors.expiredCode",
  "oauth-failed": "signIn.errors.oauthFailed",
} as const;

export function SignInForm({ claimToken, claimBrandName, errorCode }: SignInFormProps) {
  const [state, action, pending] = useActionState<AuthState, FormData>(signIn, {});
  const searchParams = useSearchParams();
  const message = searchParams.get("message");
  const next = searchParams.get("next");
  const locale = useLocale();
  const googleAction = signInWithGoogle.bind(
    null,
    claimToken,
    next ?? undefined,
    false,
    locale,
  );
  const t = useTranslations("auth");

  const errorMessage =
    state.error ??
    (errorCode
      ? t(
          ERROR_MESSAGE_KEYS[errorCode as keyof typeof ERROR_MESSAGE_KEYS] ??
            "signIn.errors.default",
        )
      : undefined);

  const signUpHref = claimToken
    ? `/auth/sign-up?claim=${claimToken}`
    : "/auth/sign-up";

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="type-section-title-large">
          {t("signIn.heading")}
        </h1>
        <p className="type-card-description">
          {t("signIn.subheading")}
        </p>
      </div>

      {claimToken && claimBrandName && (
        <div className="rounded-lg border border-cta/20 bg-cta/5 px-4 py-3 text-sm">
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

      {errorMessage && (
        <div role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </div>
      )}

      <form action={action} className="space-y-4">
        <input type="hidden" name="locale" value={locale} />
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

        <div className="flex justify-end">
          <Link
            href="/auth/forgot-password"
            className="type-caption text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
          >
            {t("signIn.forgotPassword")}
          </Link>
        </div>

        <Button type="submit" className="w-full" size="large" disabled={pending}>
          {pending ? t("signIn.submitting") : t("signIn.submit")}
        </Button>
      </form>

      <GoogleButton action={googleAction} />

      <p className="text-center type-card-description">
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
