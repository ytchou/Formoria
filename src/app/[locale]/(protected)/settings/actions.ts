"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { updateProfile } from "@/lib/services/profiles";
import { getProfileSchema } from "@/lib/validations/profile";
import {
  MARKETING_CONSENT_VERSION,
  requestNewsletterSubscription,
} from "@/lib/services/marketing-email-consent";
import { unsubscribeNewsletterByEmail } from "@/lib/services/newsletter";
import { setLifecycleEmailPreference } from "@/lib/services/email-lifecycle";

export type SettingsState = {
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
};

function isChecked(formData: FormData, name: string): boolean {
  return formData.getAll(name).includes("true");
}

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

  const serviceSupabase = createServiceClient();
  const unsubscribeAll = formData.get("_intent") === "unsubscribeAll";

  if (unsubscribeAll) {
    const updates = [
      setLifecycleEmailPreference(serviceSupabase, {
        userId: user.id,
        enabled: false,
        consentSource: "settings",
        consentVersion: MARKETING_CONSENT_VERSION,
      }),
    ];
    if (user.email) {
      updates.push(unsubscribeNewsletterByEmail(serviceSupabase, user.email));
    }

    const results = await Promise.allSettled(updates);
    if (results.some((result) => result.status === "rejected")) {
      return { error: t("settings.marketingUpdateError") };
    }
    return { message: t("settings.marketingUnsubscribedAll") };
  }

  const schema = getProfileSchema(t);
  const parsed = schema.safeParse({
    displayName: formData.get("displayName"),
    localePreference: formData.get("localePreference"),
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
    });
  } catch {
    return { error: t("settings.validation.invalidLocale") };
  }

  const newsletterEnabled = isChecked(formData, "newsletterMarketing");
  const lifecycleEnabled = isChecked(formData, "lifecycleMarketing");
  const marketingUpdates: Promise<unknown>[] = [
    setLifecycleEmailPreference(serviceSupabase, {
      userId: user.id,
      enabled: lifecycleEnabled,
      consentSource: "settings",
      consentVersion: MARKETING_CONSENT_VERSION,
    }),
  ];

  if (user.email) {
    marketingUpdates.push(
      newsletterEnabled
        ? requestNewsletterSubscription(serviceSupabase, {
            email: user.email,
            locale: parsed.data.localePreference,
            source: "settings",
          }).then((status) => {
            if (status === "failed") {
              throw new Error("Newsletter confirmation delivery failed");
            }
          })
        : unsubscribeNewsletterByEmail(serviceSupabase, user.email),
    );
  }

  const marketingResults = await Promise.allSettled(marketingUpdates);
  if (marketingResults.some((result) => result.status === "rejected")) {
    return { error: t("settings.marketingUpdateError") };
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
