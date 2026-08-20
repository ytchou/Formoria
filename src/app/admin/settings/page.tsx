import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { FeatureTogglesCard } from "@/components/admin/feature-toggles-card";
import { FEATURE_FLAGS, getAppSetting } from "@/lib/services/app-settings";

export const metadata: Metadata = { title: "Settings | Admin" };

export default async function AdminSettingsPage() {
  const t = await getTranslations("admin.settings");
  const entries = await Promise.all(
    FEATURE_FLAGS.map(async (flag) => [
      flag.key,
      await getAppSetting(flag.key, flag.defaultValue),
    ] as const),
  );
  const initialValues = Object.fromEntries(entries) as Record<string, boolean>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="type-label">{t("title")}</h1>
        <p className="mt-1 type-body-sm">{t("description")}</p>
      </div>
      <FeatureTogglesCard initialValues={initialValues} />
    </div>
  );
}
