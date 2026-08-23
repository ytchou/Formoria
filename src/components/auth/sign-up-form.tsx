"use client";

import { useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { signInWithGoogle, signUp } from "@/app/auth/actions";
import type { AuthState } from "@/app/auth/actions";
import { AuthFormError } from "@/components/auth/auth-form-error";
import { GoogleButton } from "@/components/auth/google-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MarketingEmailOptInField } from "@/components/forms/marketing-email-opt-in-field";
import { routes } from "@/lib/routes";

type SignUpFormProps = {
  claimToken?: string;
  claimBrandName?: string;
};

export function SignUpForm({ claimToken, claimBrandName }: SignUpFormProps) {
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
    claimToken,
    undefined,
    marketingEmailOptIn,
    locale,
  );
  const t = useTranslations("auth");

  const signInHref = routes.auth.signIn({ claim: claimToken });

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="type-section">{t("signUp.heading")}</h1>
        <p className="type-body-sm">{t("signUp.subheading")}</p>
      </div>

      {claimToken && claimBrandName && (
        <div className="rounded-surface border border-rule bg-surface px-4 py-3 type-body-sm text-ink-soft">
          {t.rich("signUp.claimMessage", {
            brandName: claimBrandName,
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        </div>
      )}

      <AuthFormError message={state.error} />

      <form action={action} className="space-y-4">
        <input type="hidden" name="locale" value={locale} />
        {claimToken && (
          <input type="hidden" name="claimToken" value={claimToken} />
        )}

        <div className="space-y-2">
          <Label htmlFor="email">{t("signUp.emailLabel")}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder={t("emailPlaceholder")}
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
          <Label htmlFor="confirmPassword">
            {t("signUp.confirmPasswordLabel")}
          </Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            placeholder={t("signUp.passwordPlaceholder")}
            required
            autoComplete="new-password"
          />
        </div>

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
      </form>

      <GoogleButton action={googleAction} />

      <p className="text-center type-body-sm">
        {t("signUp.hasAccount")}{" "}
        <Link
          href={signInHref}
          className="font-medium text-accent underline-offset-4 hover:underline"
        >
          {t("signUp.signInLink")}
        </Link>
      </p>
    </div>
  );
}
