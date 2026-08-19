"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { signIn, signInWithGoogle } from "@/app/auth/actions";
import type { AuthState } from "@/app/auth/actions";
import { AuthFormError } from "@/components/auth/auth-form-error";
import { GoogleButton } from "@/components/auth/google-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { routes } from "@/lib/routes";

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
  "invalid-credentials": "signIn.errors.default",
} as const;

export function SignInForm({
  claimToken,
  claimBrandName,
  errorCode,
}: SignInFormProps) {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    signIn,
    {},
  );
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
  const staging = process.env.NEXT_PUBLIC_DEPLOYMENT_ENV === "staging";
  const t = useTranslations("auth");

  const errorMessage =
    state.error ??
    (errorCode
      ? t(
          ERROR_MESSAGE_KEYS[errorCode as keyof typeof ERROR_MESSAGE_KEYS] ??
            "signIn.errors.default",
        )
      : undefined);

  const signUpHref = routes.auth.signUp({ claim: claimToken });

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="type-section">{t("signIn.heading")}</h1>
        <p className="type-body-sm">{t("signIn.subheading")}</p>
      </div>

      {claimToken && claimBrandName && (
        <div className="rounded-[3px] border border-rule bg-surface px-4 py-3 type-body-sm text-ink-soft">
          {t.rich("signIn.claimMessage", {
            brandName: claimBrandName,
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        </div>
      )}

      {message && (
        <div className="rounded-[3px] bg-surface px-4 py-3 type-body-sm text-ink-soft">
          {message}
        </div>
      )}

      <AuthFormError message={errorMessage} />

      <form action={action} className="space-y-4">
        <input type="hidden" name="locale" value={locale} />
        {claimToken && (
          <input type="hidden" name="claimToken" value={claimToken} />
        )}
        {next && <input type="hidden" name="next" value={next} />}

        <div className="space-y-2">
          <Label htmlFor="email">{t("signIn.emailLabel")}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder={t("emailPlaceholder")}
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

        {!staging ? (
          <div className="flex justify-end">
            <Link
              href={routes.auth.forgotPassword()}
              className="type-metadata text-accent underline-offset-4 hover:underline"
            >
              {t("signIn.forgotPassword")}
            </Link>
          </div>
        ) : null}

        <Button
          type="submit"
          className="w-full"
          size="large"
          disabled={pending}
        >
          {pending ? t("signIn.submitting") : t("signIn.submit")}
        </Button>
      </form>

      {!staging ? (
        <GoogleButton action={googleAction} />
      ) : null}

      {!staging ? (
        <p className="text-center type-body-sm">
          {t("signIn.noAccount")}{" "}
          <Link
            href={signUpHref}
            className="font-medium text-accent underline-offset-4 hover:underline"
          >
            {t("signIn.signUpLink")}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
