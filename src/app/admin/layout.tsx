import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { RootDocument } from "@/components/shared/root-document";
import { createClient } from "@/lib/supabase/server";
import { isActingAsAdmin } from "@/lib/auth/admin-mode";
import { AdminNav } from "@/components/admin/admin-nav";
import type { NavItem } from "@/components/admin/admin-nav";
import { getAdminNavCounts } from "@/lib/services/admin-operations";
import { isOwnerFeaturesEnabled } from "@/lib/services/app-settings";
import { getSiteUrl } from "@/lib/seo/site-url";
import "../globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: "Formoria Admin",
    template: "%s | Formoria Admin",
  },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Admin is pinned to English (ADMIN_DEFAULT_LOCALE in proxy.ts), so its
    // sign-in target is explicitly the /en auth page.
    redirect("/en/auth/sign-in?next=/admin");
  }

  if (!(await isActingAsAdmin(user.email))) {
    redirect("/");
  }

  const [messages, counts, t, tCommon, ownerFeaturesEnabled] =
    await Promise.all([
      getMessages({ locale: "en" }),
      getAdminNavCounts(),
      getTranslations({ locale: "en", namespace: "admin.layout" }),
      getTranslations({ locale: "en", namespace: "common" }),
      isOwnerFeaturesEnabled(),
    ]);

  const navItems: NavItem[] = [
    { label: t("nav.overview"), href: "/admin" },
    {
      label: t("nav.submissions"),
      href: "/admin/submissions",
      count: counts.submissions ?? undefined,
    },
    { label: t("nav.jobs"), href: "/admin/jobs" },
    {
      label: t("nav.moderation"),
      href: "/admin/moderation",
      count: counts.moderation ?? undefined,
    },
    {
      label: t("nav.evidence"),
      href: "/admin/evidence",
      count: counts.evidence ?? undefined,
    },
    ...(ownerFeaturesEnabled
      ? [{ label: t("nav.claims"), href: "/admin/claims" }]
      : []),
    { label: t("nav.reports"), href: "/admin/reports", count: counts.reports ?? undefined },
    { label: t("nav.brands"), href: "/admin/brands" },
    { label: t("nav.curatedProducts"), href: "/admin/curated-products" },
    { label: t("nav.corrections"), href: "/admin/corrections", count: counts.corrections ?? undefined },
    { label: t("nav.quality"), href: "/admin/quality" },
    { label: t("nav.newsletter"), href: "/admin/newsletter" },
    { label: t("nav.scripts"), href: "/admin/scripts" },
    { label: t("nav.settings"), href: "/admin/settings" },
  ];

  return (
    <RootDocument
      locale="en"
      skipToContentLabel={tCommon("skipToContent")}
    >
      <NextIntlClientProvider locale="en" messages={messages}>
        <div className="min-h-screen bg-background">
          <main id="main-content" className="mx-auto max-w-screen-2xl px-10 pb-8 pt-8">
            <h1 className="type-page-title">{t("title")}</h1>
            <AdminNav items={navItems} />
            <div className="mt-8">{children}</div>
          </main>
        </div>
      </NextIntlClientProvider>
    </RootDocument>
  );
}
