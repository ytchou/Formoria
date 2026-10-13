"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import type { FormEvent } from "react";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { updatePassword } from "@/app/auth/actions";
import type { AuthState } from "@/app/auth/actions";
import { AuthFormError } from "@/components/auth/auth-form-error";
import {
  describedBy,
  useBlurValidation,
} from "@/components/auth/use-blur-validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/form-field";
import { getResetPasswordSchema } from "@/lib/auth/validations";
import { routes } from "@/lib/routes";

const PASSWORD_HINT_ID = "password-hint";

export function ResetPasswordForm() {
  const [nativeState, action, nativePending] = useActionState<AuthState, FormData>(
    updatePassword,
    {},
  );
  const [clientState, setClientState] = useState<AuthState>();
  const [clientPending, startTransition] = useTransition();
  const state = clientState ?? nativeState;
  const pending = nativePending || clientPending;
  const t = useTranslations("auth");
  const schema = useMemo(
    () => getResetPasswordSchema((key) => t(key as Parameters<typeof t>[0])),
    [t],
  );
  const { errors, validate } = useBlurValidation<"confirmPassword">(schema);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    startTransition(async () => {
      try {
        const result = await updatePassword(state, data);
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
          {t("resetPassword.heading")}
        </h1>
        <p className="type-body-sm">{t("resetPassword.subheading")}</p>
      </div>

      <AuthFormError message={state.error} pending={pending} />

      {state.message ? (
        <div className="rounded-surface bg-verified-green-bg px-4 py-3 type-body-sm text-ink-soft text-verified-green">
          {state.message}
        </div>
      ) : (
        <form action={action} onSubmit={handleSubmit} className="space-y-4">
          <FormField
            id="password"
            label={t("resetPassword.passwordLabel")}
            description={
              <span id={PASSWORD_HINT_ID}>
                {t("resetPassword.passwordHint")}
              </span>
            }
          >
            <Input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="new-password"
              aria-describedby={describedBy(PASSWORD_HINT_ID)}
              onBlur={(event) =>
                validate(event.currentTarget.form, ["confirmPassword"])
              }
              onChange={(event) => {
                if (errors.confirmPassword) {
                  validate(event.currentTarget.form, ["confirmPassword"]);
                }
              }}
            />
          </FormField>

          <FormField
            id="confirmPassword"
            label={t("resetPassword.confirmPasswordLabel")}
            error={errors.confirmPassword}
          >
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              required
              autoComplete="new-password"
              onBlur={(event) =>
                validate(event.currentTarget.form, ["confirmPassword"])
              }
              onChange={(event) => {
                if (errors.confirmPassword) {
                  validate(event.currentTarget.form, ["confirmPassword"]);
                }
              }}
            />
          </FormField>

          <Button
            type="submit"
            width="full"
            size="large"
            disabled={pending}
          >
            {pending ? t("resetPassword.submitting") : t("resetPassword.submit")}
          </Button>
        </form>
      )}

      <p className="flex flex-wrap items-center justify-center gap-x-1 type-body-sm">
        {t("resetPassword.backToSignIn")}
        <Link
          href={routes.auth.signIn()}
          className="inline-flex min-h-11 items-center font-medium text-accent underline-offset-4 hover:underline"
        >
          {t("resetPassword.signInLink")}
        </Link>
      </p>
    </div>
  );
}
