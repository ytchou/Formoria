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
};

export function SettingsForm({ profile, email, currentLocale }: Props) {
  const t = useTranslations("settings");
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    updateSettings,
    {}
  );
  const [emailNotifications, setEmailNotifications] = useState(
    profile?.emailNotifications ?? true
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

      {/* Email Notifications */}
      <div className="flex items-start gap-3">
        <input type="hidden" name="emailNotifications" value="false" />
        <Checkbox
          id="emailNotifications"
          name="emailNotifications"
          value="true"
          checked={emailNotifications}
          onChange={(e) => setEmailNotifications(e.target.checked)}
          className="mt-0.5"
        />
        <div>
          <Label htmlFor="emailNotifications">
            {t("emailNotificationsLabel")}
          </Label>
          <p className="type-caption">
            {t("emailNotificationsDescription")}
          </p>
        </div>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
