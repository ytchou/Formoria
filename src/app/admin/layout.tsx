import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Suspense } from "react";
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

type AdminNavLabels = {
  overview: string;
  submissions: string;
  jobs: string;
  moderation: string;
  reports: string;
  brands: string;
  curatedProducts: string;
  corrections: string;
  stockists: string;
  quality: string;
  newsletter: string;
  scripts: string;
};

type AdminNavCounts = Awaited<ReturnType<typeof getAdminNavCounts>>;

function buildAdminNavItems(
  labels: AdminNavLabels,
  counts?: AdminNavCounts,
): NavItem[] {
  return [
    { label: labels.overview, href: routes.admin.index() },
    {
      label: labels.submissions,
      href: routes.admin.submissions(),
      count: counts?.submissions ?? undefined,
    },
    { label: labels.jobs, href: routes.admin.jobs() },
    {
      label: labels.moderation,
      href: routes.admin.moderation(),
      count: counts?.moderation ?? undefined,
    },
    {
      label: labels.reports,
      href: routes.admin.reports(),
      count: counts?.reports ?? undefined,
    },
    { label: labels.brands, href: routes.admin.brands() },
    {
      label: labels.curatedProducts,
      href: routes.admin.curatedProducts(),
    },
    {
      label: labels.corrections,
      href: routes.admin.corrections(),
      count: counts?.corrections ?? undefined,
    },
    {
      label: labels.stockists,
      href: routes.admin.stockists(),
      count: counts?.stockists ?? undefined,
    },
    { label: labels.quality, href: routes.admin.quality() },
    { label: labels.newsletter, href: routes.admin.newsletter() },
    { label: labels.scripts, href: routes.admin.scripts() },
  ];
}

async function AdminNavigation({ labels }: { labels: AdminNavLabels }) {
  const counts = await getAdminNavCounts();
  return <AdminNav items={buildAdminNavItems(labels, counts)} />;
}

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

  const [allMessages, t, tCommon] = await Promise.all([
    getMessages({ locale: "en" }),
    getTranslations({ locale: "en", namespace: "admin.layout" }),
    getTranslations({ locale: "en", namespace: "common" }),
  ]);
  const messages = {
    admin: allMessages.admin,
    common: allMessages.common,
    errors: allMessages.errors,
  };

  const navLabels: AdminNavLabels = {
    overview: t("nav.overview"),
    submissions: t("nav.submissions"),
    jobs: t("nav.jobs"),
    moderation: t("nav.moderation"),
    reports: t("nav.reports"),
    brands: t("nav.brands"),
    curatedProducts: t("nav.curatedProducts"),
    corrections: t("nav.corrections"),
    stockists: t("nav.stockists"),
    quality: t("nav.quality"),
    newsletter: t("nav.newsletter"),
    scripts: t("nav.scripts"),
  };

  return (
    <RootDocument locale="en" skipToContentLabel={tCommon("skipToContent")}>
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
            <h1 className="type-tool-heading">{t("title")}</h1>
            <Suspense
              fallback={<AdminNav items={buildAdminNavItems(navLabels)} />}
            >
              <AdminNavigation labels={navLabels} />
            </Suspense>
            <div className="mt-8">{children}</div>
          </PageShell>
        </div>
      </NextIntlClientProvider>
    </RootDocument>
  );
}
