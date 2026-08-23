import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { RootDocument } from "@/components/shared/root-document";
import { createClient } from "@/lib/supabase/server";
import { isActingAsAdmin } from "@/lib/auth/admin-mode";
import { AdminNav } from "@/components/admin/admin-nav";
import { PageShell } from "@/components/ui/page-shell";
import type { NavItem } from "@/components/admin/admin-nav";
import { getAdminNavCounts } from "@/lib/services/admin-operations";
import { getSiteUrl } from "@/lib/seo/site-url";
import "../globals.css";
import { routes } from "@/lib/routes";

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

  const [messages, counts, t, tCommon] = await Promise.all([
    getMessages({ locale: "en" }),
    getAdminNavCounts(),
    getTranslations({ locale: "en", namespace: "admin.layout" }),
    getTranslations({ locale: "en", namespace: "common" }),
  ]);

  const navItems: NavItem[] = [
    { label: t("nav.overview"), href: routes.admin.index() },
    {
      label: t("nav.submissions"),
      href: routes.admin.submissions(),
      count: counts.submissions ?? undefined,
    },
    { label: t("nav.jobs"), href: routes.admin.jobs() },
    {
      label: t("nav.moderation"),
      href: routes.admin.moderation(),
      count: counts.moderation ?? undefined,
    },
    {
      label: t("nav.evidence"),
      href: routes.admin.evidence(),
      count: counts.evidence ?? undefined,
    },
    { label: t("nav.reports"), href: routes.admin.reports(), count: counts.reports ?? undefined },
    { label: t("nav.brands"), href: routes.admin.brands() },
    { label: t("nav.curatedProducts"), href: routes.admin.curatedProducts() },
    { label: t("nav.corrections"), href: routes.admin.corrections(), count: counts.corrections ?? undefined },
    { label: t("nav.stockists"), href: routes.admin.stockists(), count: counts.stockists ?? undefined },
    { label: t("nav.quality"), href: routes.admin.quality() },
    { label: t("nav.newsletter"), href: routes.admin.newsletter() },
    { label: t("nav.scripts"), href: routes.admin.scripts() },
  ];

  return (
    <RootDocument
      locale="en"
      skipToContentLabel={tCommon("skipToContent")}
    >
      <NextIntlClientProvider locale="en" messages={messages}>
        <div className="min-h-screen bg-ground">
          {/* Admin is on the same three measures as the public site. The
            screen-scale cap this replaces was 96rem — a fourth width, picked
            once and never named, 4rem off the measure it meant. */}
          <PageShell
            as="main"
            id="main-content"
            measure="page"
            className="py-stack"
          >
            <h1 className="type-label">{t("title")}</h1>
            <AdminNav items={navItems} />
            <div className="mt-8">{children}</div>
          </PageShell>
        </div>
      </NextIntlClientProvider>
    </RootDocument>
  );
}
