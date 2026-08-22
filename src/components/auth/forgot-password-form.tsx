"use client";

import { useActionState } from "react";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { resetPassword } from "@/app/auth/actions";
import type { AuthState } from "@/app/auth/actions";
import { AuthFormError } from "@/components/auth/auth-form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { routes } from "@/lib/routes";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    resetPassword,
    {},
  );
  const t = useTranslations("auth");

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="type-section">
          {t("forgotPassword.heading")}
        </h1>
        <p className="type-body-sm">
          {t("forgotPassword.subheading")}
        </p>
      </div>

      <AuthFormError message={state.error} />

      {state.message ? (
        <div className="rounded-[3px] bg-verified-green-bg px-4 py-3 type-body-sm text-ink-soft text-verified-green">
          {state.message}
        </div>
      ) : (
        <form action={action} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t("forgotPassword.emailLabel")}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder={t("emailPlaceholder")}
              required
              autoComplete="email"
            />
          </div>

          <Button
            type="submit"
            width="full"
            size="large"
            disabled={pending}
          >
            {pending
              ? t("forgotPassword.submitting")
              : t("forgotPassword.submit")}
          </Button>
        </form>
      )}

      <p className="text-center type-body-sm">
        {t("forgotPassword.backToSignIn")}{" "}
        <Link
          href={routes.auth.signIn()}
          className="font-medium text-accent underline-offset-4 hover:underline"
        >
          {t("forgotPassword.signInLink")}
        </Link>
      </p>
    </div>
  );
}
