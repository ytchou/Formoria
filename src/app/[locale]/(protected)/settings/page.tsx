import { setRequestLocale, getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/services/profiles";
import { SettingsForm } from "@/components/settings/settings-form";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("settings");
  return { title: t("metadata.title") };
}

export default async function SettingsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { saved } = await searchParams;
  const t = await getTranslations("settings");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = user ? await getProfile(user.id) : null;

  return (
    <div className="page-gutter mx-auto max-w-2xl py-12">
      <h1 className="type-page-title-large">
        {t("heading")}
      </h1>
      <p className="mt-2 type-body-muted">{t("subheading")}</p>

      {saved && (
        <div className="mt-4 type-success-panel">
          {t("saved")}
        </div>
      )}

      <div className="mt-8">
        <SettingsForm
          profile={profile}
          email={user?.email ?? ""}
          currentLocale={locale}
        />
      </div>
    </div>
  );
}
