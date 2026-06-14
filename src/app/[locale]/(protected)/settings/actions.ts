"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { updateProfile } from "@/lib/services/profiles";
import { getProfileSchema } from "@/lib/validations/profile";

export type SettingsState = {
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
};

export async function updateSettings(
  _prev: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  const t = await getTranslations();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const schema = getProfileSchema(t);
  const parsed = schema.safeParse({
    displayName: formData.get("displayName"),
    localePreference: formData.get("localePreference"),
    emailNotifications: formData.get("emailNotifications"),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]?.toString();
      if (key) fieldErrors[key] = issue.message;
    }
    return { fieldErrors };
  }

  try {
    await updateProfile(user.id, {
      displayName: parsed.data.displayName,
      localePreference: parsed.data.localePreference,
      emailNotifications: parsed.data.emailNotifications,
    });
  } catch {
    return { error: t("settings.validation.invalidLocale") };
  }

  // Set locale cookie for future visits
  const cookieStore = await cookies();
  cookieStore.set("NEXT_LOCALE", parsed.data.localePreference, {
    sameSite: "lax",
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
  });

  // If locale changed from current page locale, redirect to new locale
  const currentLocale = formData.get("_currentLocale") as string | null;
  if (currentLocale && currentLocale !== parsed.data.localePreference) {
    const prefix =
      parsed.data.localePreference === "zh-TW"
        ? ""
        : `/${parsed.data.localePreference}`;
    redirect(`${prefix}/settings?saved=true`);
  }

  return { message: t("settings.saved") };
}
