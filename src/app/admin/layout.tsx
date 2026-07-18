import { redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { isActingAsAdmin } from "@/lib/auth/admin-mode";
import { AdminNav } from "@/components/admin/admin-nav";
import type { NavItem } from "@/components/admin/admin-nav";
import { getFlaggedContent } from "@/lib/services/moderation";
import { getSubmissions } from "@/lib/services/submissions";
import { getPendingReports } from "@/lib/services/reports";
import { getFeedbackItems } from "@/lib/services/feedback";

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

  const [messages, submissions, flaggedContent, reports, feedbackItems, t] =
    await Promise.all([
      getMessages(),
      getSubmissions("pending"),
      getFlaggedContent({ status: "pending" }),
      getPendingReports(),
      getFeedbackItems({ status: "open" }),
      getTranslations("admin.layout"),
    ]);

  const navItems: NavItem[] = [
    { label: t("nav.overview"), href: "/admin" },
    {
      label: t("nav.submissions"),
      href: "/admin/submissions",
      count: submissions.length,
    },
    { label: t("nav.jobs"), href: "/admin/jobs" },
    {
      label: t("nav.moderation"),
      href: "/admin/moderation",
      count: flaggedContent.items.length,
    },
    { label: t("nav.claims"), href: "/admin/claims" },
    { label: t("nav.reports"), href: "/admin/reports", count: reports.length },
    {
      label: t("nav.feedback"),
      href: "/admin/feedback",
      count: feedbackItems.length,
    },
    { label: t("nav.brands"), href: "/admin/brands" },
    { label: t("nav.quality"), href: "/admin/quality" },
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
