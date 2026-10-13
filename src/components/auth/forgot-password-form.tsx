"use client";

import { useActionState, useState, useTransition } from "react";
import type { FormEvent } from "react";
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
  const [nativeState, action, nativePending] = useActionState<AuthState, FormData>(
    resetPassword,
    {},
  );
  const [clientState, setClientState] = useState<AuthState>();
  const [clientPending, startTransition] = useTransition();
  const state = clientState ?? nativeState;
  const pending = nativePending || clientPending;
  const t = useTranslations("auth");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    startTransition(async () => {
      try {
        const result = await resetPassword(state, data);
        form.reset();
        setClientState(result);
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        setClientState({ error: t("requestError") });
      }
    });
  }

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

      <AuthFormError message={state.error} pending={pending} />

      {state.message ? (
        <div className="rounded-surface bg-verified-green-bg px-4 py-3 type-body-sm text-ink-soft text-verified-green">
          {state.message}
        </div>
      ) : (
        <form action={action} onSubmit={handleSubmit} className="space-y-4">
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

      <p className="flex flex-wrap items-center justify-center gap-x-1 type-body-sm">
        {t("forgotPassword.backToSignIn")}
        <Link
          href={routes.auth.signIn()}
          className="inline-flex min-h-11 items-center font-medium text-accent underline-offset-4 hover:underline"
        >
          {t("forgotPassword.signInLink")}
        </Link>
      </p>
    </div>
  );
}
