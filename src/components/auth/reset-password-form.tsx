"use client";

import { useActionState } from "react";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { updatePassword } from "@/app/auth/actions";
import type { AuthState } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { routes } from "@/lib/routes";

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    updatePassword,
    {},
  );
  const t = useTranslations("auth");

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="type-section">
          {t("resetPassword.heading")}
        </h1>
        <p className="type-body-sm">{t("resetPassword.subheading")}</p>
      </div>

      {state.error && (
        <div
          role="alert"
          className="rounded-lg bg-destructive/10 px-4 py-3 type-body-sm text-destructive"
        >
          {state.error}
        </div>
      )}

      <form action={action} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">{t("resetPassword.passwordLabel")}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder={t("resetPassword.passwordPlaceholder")}
            required
            autoComplete="new-password"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">
            {t("resetPassword.confirmPasswordLabel")}
          </Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            autoComplete="new-password"
          />
        </div>

        <Button
          type="submit"
          className="w-full"
          size="large"
          disabled={pending}
        >
          {pending ? t("resetPassword.submitting") : t("resetPassword.submit")}
        </Button>
      </form>

      <p className="text-center type-body-sm">
        {t("resetPassword.backToSignIn")}{" "}
        <Link
          href={routes.auth.signIn()}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {t("resetPassword.signInLink")}
        </Link>
      </p>
    </div>
  );
}
