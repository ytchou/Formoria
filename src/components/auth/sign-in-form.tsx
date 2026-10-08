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
import { signInContextFor } from "./sign-in-context";

type SignInFormProps = {
  /** `?error=` code written by /auth/callback and the OAuth action. */
  errorCode?: string;
  showOptionalAuthMethods: boolean;
};

const ERROR_MESSAGE_KEYS = {
  "missing-code": "signIn.errors.missingCode",
  "expired-code": "signIn.errors.expiredCode",
  "oauth-failed": "signIn.errors.oauthFailed",
  "invalid-credentials": "signIn.errors.default",
} as const;

export function SignInForm({
  errorCode,
  showOptionalAuthMethods,
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
    next ?? undefined,
    false,
    locale,
  );
  const t = useTranslations("auth");
  const context = signInContextFor(next);

  const errorMessage =
    state.error ??
    (errorCode
      ? t(
          ERROR_MESSAGE_KEYS[errorCode as keyof typeof ERROR_MESSAGE_KEYS] ??
            "signIn.errors.default",
        )
      : undefined);

  const signUpHref = routes.auth.signUp();

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="type-section">{t("signIn.heading")}</h1>
        <p className="type-body-sm">
          {context
            ? t(`signIn.context.${context}`)
            : t("signIn.subheading")}
        </p>
      </div>

      {message && (
        <div className="rounded-surface bg-surface px-4 py-3 type-body-sm text-ink-soft">
          {message}
        </div>
      )}

      <AuthFormError message={errorMessage} />

      <form action={action} className="space-y-4">
        <input type="hidden" name="locale" value={locale} />
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

        {showOptionalAuthMethods ? (
          <div className="flex justify-end">
            <Link
              href={routes.auth.forgotPassword()}
              className="inline-flex min-h-11 items-center type-metadata text-accent underline-offset-4 hover:underline"
            >
              {t("signIn.forgotPassword")}
            </Link>
          </div>
        ) : null}

        <Button
          type="submit"
          width="full"
          size="large"
          disabled={pending}
        >
          {pending ? t("signIn.submitting") : t("signIn.submit")}
        </Button>
      </form>

      {showOptionalAuthMethods ? (
        <GoogleButton action={googleAction} label={t("signInWithGoogle")} />
      ) : null}

      {showOptionalAuthMethods ? (
        <p className="flex flex-wrap items-center justify-center gap-x-1 type-body-sm">
          {t("signIn.noAccount")}
          <Link
            href={signUpHref}
            className="inline-flex min-h-11 items-center font-medium text-accent underline-offset-4 hover:underline"
          >
            {t("signIn.signUpLink")}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
