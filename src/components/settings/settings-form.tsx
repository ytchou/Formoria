"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import type { Profile } from "@/lib/services/profiles";
import {
  updateSettings,
  type SettingsState,
} from "@/app/[locale]/(site)/(protected)/settings/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/forms/form-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

type Props = {
  profile: Profile | null;
  email: string;
  currentLocale: string;
  newsletterStatus: "off" | "pending" | "on";
};

export function SettingsForm({
  profile,
  email,
  currentLocale,
  newsletterStatus,
}: Props) {
  const t = useTranslations("settings");
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    updateSettings,
    {}
  );
  const [newsletterMarketing, setNewsletterMarketing] = useState(
    newsletterStatus !== "off"
  );
  // `newsletterStatus` is a server prop; `useState` only reads it on mount, so
  // after `unsubscribeAll` revalidates the route the checkbox would stay ticked
  // and the next Save would silently re-subscribe. Re-sync on prop change.
  const [lastNewsletterStatus, setLastNewsletterStatus] =
    useState(newsletterStatus);
  if (lastNewsletterStatus !== newsletterStatus) {
    setLastNewsletterStatus(newsletterStatus);
    setNewsletterMarketing(newsletterStatus !== "off");
  }

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="_currentLocale" value={currentLocale} />

      {state.error && (
        <div
          role="alert"
          className="rounded-surface bg-danger/10 px-4 py-3 type-metadata text-danger"
        >
          {state.error}
        </div>
      )}

      {state.message && (
        <div role="status" className="panel-success">
          {state.message}
        </div>
      )}

      {/* Email (read-only) */}
      <div className="space-y-2">
        <Label>{t("emailLabel")}</Label>
        <Input
          value={email}
          readOnly
          tabIndex={-1}
          className="pointer-events-none cursor-not-allowed bg-surface opacity-70"
        />
      </div>

      <FormField
        error={state.fieldErrors?.displayName}
        id="displayName"
        label={t("displayNameLabel")}
      >
        <Input
          id="displayName"
          name="displayName"
          defaultValue={profile?.displayName ?? ""}
          placeholder={t("displayNamePlaceholder")}
          maxLength={50}
        />
      </FormField>

      <FormField
        error={state.fieldErrors?.localePreference}
        id="localePreference"
        label={t("localePreferenceLabel")}
      >
        {/*
          Wired by hand: `NativeSelect` stays a server-safe component and does
          not read the field context the way `Input` does, so the association
          lives at the call site rather than silently not happening.
        */}
        <NativeSelect
          aria-describedby={
            state.fieldErrors?.localePreference
              ? "localePreference-error"
              : undefined
          }
          aria-invalid={
            state.fieldErrors?.localePreference ? true : undefined
          }
          id="localePreference"
          name="localePreference"
          defaultValue={profile?.localePreference ?? currentLocale}
        >
          <option value="zh-TW">中文（繁體）</option>
          <option value="en">English</option>
        </NativeSelect>
      </FormField>

      <section
        aria-labelledby="marketing-heading"
        className="space-y-4 rounded-surface border border-rule p-4"
      >
        <div>
          <h2
            id="marketing-heading"
            className="type-body-sm font-semibold text-ink"
          >
            {t("marketingHeading")}
          </h2>
          <p className="mt-1 type-metadata">{t("marketingDescription")}</p>
        </div>

        <div className="space-y-1">
          <input type="hidden" name="newsletterMarketing" value="false" />
          <Label
            htmlFor="newsletterMarketing"
            className="flex min-h-12 cursor-pointer items-start gap-3"
          >
            {/*
              Wired by hand for the same reason as `localePreference` above:
              the paragraph below is the only place that says whether delivery
              is pending, so it has to be announced with the control.
            */}
            <Checkbox
              aria-describedby="newsletterMarketing-description"
              id="newsletterMarketing"
              name="newsletterMarketing"
              value="true"
              checked={newsletterMarketing}
              onCheckedChange={setNewsletterMarketing}
              className="mt-0.5 size-[18px] shrink-0"
            />
            <span className="type-body-sm text-ink-soft font-normal">
              {t("newsletterMarketingLabel")}
            </span>
          </Label>
          <p
            id="newsletterMarketing-description"
            className="pl-[30px] type-metadata"
          >
            {newsletterStatus === "pending"
              ? t("newsletterPending")
              : t("newsletterMarketingDescription")}
          </p>
        </div>

        <Button
          type="submit"
          name="_intent"
          value="unsubscribeAll"
          variant="secondary"
          size="large"
          disabled={pending}
        >
          {t("unsubscribeAllMarketing")}
        </Button>
      </section>

      <Button type="submit" disabled={pending}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
