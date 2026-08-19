import { setRequestLocale, getTranslations } from "next-intl/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getProfile } from "@/lib/services/profiles";
import { getNewsletterPreferenceByEmail } from "@/lib/services/newsletter";
import { getLifecycleEmailPreference } from "@/lib/services/email-lifecycle";
import { SettingsForm } from "@/components/settings/settings-form";
import { requireUserPage } from "@/lib/auth/require-user";
import { routes } from "@/lib/routes";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("settings");
  return {
    title: t("metadata.title"),
    robots: { index: false, follow: true },
  };
}

export default async function SettingsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUserPage(routes.settings(), locale);
  const { saved } = await searchParams;
  const t = await getTranslations("settings");

  const serviceSupabase = createServiceClient();
  const [profile, newsletterPreference, lifecyclePreference] = await Promise.all([
    getProfile(user.id),
    getNewsletterPreferenceByEmail(serviceSupabase, user.email ?? ""),
    getLifecycleEmailPreference(serviceSupabase, user.id),
  ]);

  return (
    <div className="page-gutter mx-auto max-w-2xl py-12">
      <h1 className="type-page-title">
        {t("heading")}
      </h1>
      <p className="mt-2 type-body-sm">{t("subheading")}</p>

      {saved && (
        <div className="mt-4 panel-success">
          {t("saved")}
        </div>
      )}

      <div className="mt-8">
        <SettingsForm
          profile={profile}
          email={user.email ?? ""}
          currentLocale={locale}
          newsletterStatus={newsletterPreference.status}
          lifecycleOptedIn={lifecyclePreference.isOptedIn}
        />
      </div>
    </div>
  );
}
