import { redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { isActingAsAdmin } from "@/lib/auth/admin-mode";
import { AdminNav } from "@/components/admin/admin-nav";
import type { NavItem } from "@/components/admin/admin-nav";
import { getAdminNavCounts } from "@/lib/services/admin-operations";

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
    redirect("/auth/sign-in?next=/admin");
  }

  if (!(await isActingAsAdmin(user.email))) {
    redirect("/");
  }

  const [messages, counts, t] =
    await Promise.all([
      getMessages(),
      getAdminNavCounts(),
      getTranslations("admin.layout"),
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
    { label: t("nav.claims"), href: "/admin/claims" },
    { label: t("nav.reports"), href: "/admin/reports", count: counts.reports ?? undefined },
    { label: t("nav.brands"), href: "/admin/brands" },
    { label: t("nav.quality"), href: "/admin/quality" },
    { label: t("nav.newsletter"), href: "/admin/newsletter" },
    { label: t("nav.settings"), href: "/admin/settings" },
  ];

  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <div className="min-h-screen bg-background">
        <main className="mx-auto max-w-screen-2xl px-10 pb-8 pt-8">
          <h1 className="type-page-title-large">{t("title")}</h1>
          <AdminNav items={navItems} />
          <div className="mt-8">{children}</div>
        </main>
      </div>
    </NextIntlClientProvider>
  );
}
