"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import type { Profile } from "@/lib/services/profiles";
import {
  updateSettings,
  type SettingsState,
} from "@/app/[locale]/(protected)/settings/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

type Props = {
  profile: Profile | null;
  email: string;
  currentLocale: string;
  newsletterStatus: "off" | "pending" | "on";
  lifecycleOptedIn: boolean;
};

export function SettingsForm({
  profile,
  email,
  currentLocale,
  newsletterStatus,
  lifecycleOptedIn,
}: Props) {
  const t = useTranslations("settings");
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    updateSettings,
    {}
  );
  const [newsletterMarketing, setNewsletterMarketing] = useState(
    newsletterStatus !== "off"
  );
  const [lifecycleMarketing, setLifecycleMarketing] = useState(
    lifecycleOptedIn
  );

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="_currentLocale" value={currentLocale} />

      {state.error && (
        <div className="rounded-lg bg-destructive/10 px-4 py-3 type-error">
          {state.error}
        </div>
      )}

      {state.message && (
        <div className="type-success-panel">
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
          className="pointer-events-none cursor-not-allowed bg-input/50 opacity-50 dark:bg-input/80"
        />
      </div>

      {/* Display Name */}
      <div className="space-y-2">
        <Label htmlFor="displayName">{t("displayNameLabel")}</Label>
        <Input
          id="displayName"
          name="displayName"
          defaultValue={profile?.displayName ?? ""}
          placeholder={t("displayNamePlaceholder")}
          maxLength={50}
        />
        {state.fieldErrors?.displayName && (
          <p className="type-error">
            {state.fieldErrors.displayName}
          </p>
        )}
      </div>

      {/* Language Preference */}
      <div className="space-y-2">
        <Label htmlFor="localePreference">{t("localePreferenceLabel")}</Label>
        <NativeSelect
          id="localePreference"
          name="localePreference"
          defaultValue={profile?.localePreference ?? currentLocale}
        >
          <option value="zh-TW">中文（繁體）</option>
          <option value="en">English</option>
        </NativeSelect>
        {state.fieldErrors?.localePreference && (
          <p className="type-error">
            {state.fieldErrors.localePreference}
          </p>
        )}
      </div>

      <section className="space-y-4 rounded-lg border border-border p-4">
        <div>
          <h2 className="type-subsection-title">{t("marketingHeading")}</h2>
          <p className="mt-1 type-form-hint">{t("marketingDescription")}</p>
        </div>

        <div className="space-y-1">
          <input type="hidden" name="newsletterMarketing" value="false" />
          <Label
            htmlFor="newsletterMarketing"
            className="flex min-h-12 cursor-pointer items-start gap-3"
          >
            <Checkbox
              id="newsletterMarketing"
              name="newsletterMarketing"
              value="true"
              checked={newsletterMarketing}
              onCheckedChange={setNewsletterMarketing}
              className="mt-0.5 size-[18px] shrink-0"
            />
            <span className="type-body font-normal">
              {t("newsletterMarketingLabel")}
            </span>
          </Label>
          <p className="pl-[30px] type-form-hint">
            {newsletterStatus === "pending"
              ? t("newsletterPending")
              : t("newsletterMarketingDescription")}
          </p>
        </div>

        <div className="space-y-1">
          <input type="hidden" name="lifecycleMarketing" value="false" />
          <Label
            htmlFor="lifecycleMarketing"
            className="flex min-h-12 cursor-pointer items-start gap-3"
          >
            <Checkbox
              id="lifecycleMarketing"
              name="lifecycleMarketing"
              value="true"
              checked={lifecycleMarketing}
              onCheckedChange={setLifecycleMarketing}
              className="mt-0.5 size-[18px] shrink-0"
            />
            <span className="type-body font-normal">
              {t("lifecycleMarketingLabel")}
            </span>
          </Label>
          <p className="pl-[30px] type-form-hint">
            {t("lifecycleMarketingDescription")}
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
