import { redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { isActingAsAdmin } from "@/lib/auth/admin-mode";
import { AdminNav } from "@/components/admin/admin-nav";
import type { NavItem } from "@/components/admin/admin-nav";
import { getFlaggedContent } from "@/lib/services/moderation";
import { getPendingEdits } from "@/lib/services/pending-edits";
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

  const [messages, submissions, flaggedContent, edits, reports, feedbackItems] =
    await Promise.all([
      getMessages(),
      getSubmissions(),
      getFlaggedContent({ status: "pending" }),
      getPendingEdits("pending"),
      getPendingReports(),
      getFeedbackItems({ status: "open" }),
    ]);

  const navItems: NavItem[] = [
    { label: "總覽", href: "/admin" },
    {
      label: "審核佇列",
      href: "/admin/review-queue",
      children: [
        { label: "待審核提交", href: "/admin/review-queue/submissions", count: submissions.length },
        { label: "內容審核", href: "/admin/review-queue/moderation", count: flaggedContent.items.length },
        { label: "品牌編輯審核", href: "/admin/review-queue/edits", count: edits.length },
      ],
    },
    { label: "認領申請", href: "/admin/claims" },
    {
      label: "信號",
      href: "/admin/signals",
      children: [
        { label: "檢舉", href: "/admin/signals/reports", count: reports.length },
        { label: "Feedback", href: "/admin/signals/feedback", count: feedbackItems.length },
      ],
    },
    {
      label: "目錄管理",
      href: "/admin/catalog",
      children: [
        { label: "品牌", href: "/admin/catalog/brands" },
      ],
    },
    { label: "品質儀表板", href: "/admin/quality" },
    { label: "工作紀錄", href: "/admin/jobs" },
  ];

  return (
    <NextIntlClientProvider locale="zh-TW" messages={messages}>
      <div className="min-h-screen bg-background">
        <main className="mx-auto max-w-screen-2xl px-10 pb-8 pt-8">
          <h1 className="type-page-title-large">管理後台</h1>
          <AdminNav items={navItems} />
          <div className="mt-8">{children}</div>
        </main>
      </div>
    </NextIntlClientProvider>
  );
}
