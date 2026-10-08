"use client";

import { useActionState, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { signInWithGoogle, signUp } from "@/app/auth/actions";
import type { AuthState } from "@/app/auth/actions";
import { AuthFormError } from "@/components/auth/auth-form-error";
import { GoogleButton } from "@/components/auth/google-button";
import {
  describedBy,
  useBlurValidation,
} from "@/components/auth/use-blur-validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/form-field";
import { MarketingEmailOptInField } from "@/components/forms/marketing-email-opt-in-field";
import { getSignUpSchema } from "@/lib/auth/validations";
import { routes } from "@/lib/routes";

const PASSWORD_HINT_ID = "password-hint";

export function SignUpForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    signUp,
    {},
  );
  const [marketingEmailOptIn, setMarketingEmailOptIn] = useState(false);
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";
  const locale = useLocale();
  const googleAction = signInWithGoogle.bind(
    null,
    undefined,
    marketingEmailOptIn,
    locale,
  );
  const t = useTranslations("auth");
  const schema = useMemo(
    () => getSignUpSchema((key) => t(key as Parameters<typeof t>[0])),
    [t],
  );
  const { errors, validate } = useBlurValidation<"email" | "confirmPassword">(
    schema,
  );

  const signInHref = routes.auth.signIn();

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="type-section">{t("signUp.heading")}</h1>
        <p className="type-body-sm">{t("signUp.subheading")}</p>
      </div>

      <AuthFormError message={state.error} />

      <form action={action} className="space-y-4">
        <input type="hidden" name="locale" value={locale} />

        <FormField
          id="email"
          label={t("signUp.emailLabel")}
          error={errors.email}
        >
          <Input
            id="email"
            name="email"
            type="email"
            placeholder={t("emailPlaceholder")}
            defaultValue={email}
            required
            autoComplete="email"
            onBlur={(event) => validate(event.currentTarget.form, ["email"])}
            onChange={(event) => {
              if (errors.email) validate(event.currentTarget.form, ["email"]);
            }}
          />
        </FormField>

        <FormField
          id="password"
          label={t("signUp.passwordLabel")}
          description={
            <span id={PASSWORD_HINT_ID}>{t("signUp.passwordHint")}</span>
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
          label={t("signUp.confirmPasswordLabel")}
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

        <MarketingEmailOptInField
          id="signup-marketing-email"
          name="marketingEmailOptIn"
          checked={marketingEmailOptIn}
          onCheckedChange={setMarketingEmailOptIn}
          disabled={pending}
        />

        <Button
          type="submit"
          width="full"
          size="large"
          disabled={pending}
        >
          {pending ? t("signUp.submitting") : t("signUp.submit")}
        </Button>

        <p className="text-center type-metadata">
          {t.rich("signUp.terms", {
            terms: (chunks) => (
              <Link
                href={routes.terms()}
                className="text-accent underline underline-offset-4"
              >
                {chunks}
              </Link>
            ),
            privacy: (chunks) => (
              <Link
                href={routes.privacy()}
                className="text-accent underline underline-offset-4"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      </form>

      <GoogleButton action={googleAction} label={t("continueWithGoogle")} />

      <p className="flex flex-wrap items-center justify-center gap-x-1 type-body-sm">
        {t("signUp.hasAccount")}
        <Link
          href={signInHref}
          className="inline-flex min-h-11 items-center font-medium text-accent underline-offset-4 hover:underline"
        >
          {t("signUp.signInLink")}
        </Link>
      </p>
    </div>
  );
}
