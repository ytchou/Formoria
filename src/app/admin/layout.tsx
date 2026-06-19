import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import type { AdminMode } from "@/lib/auth/admin-mode";
import { isActingAsAdmin } from "@/lib/auth/admin-mode";
import { AdminModeBar } from "@/components/admin-mode/admin-mode-bar";
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

  const [cookieStore, messages, submissions, flaggedContent, edits, reports, feedbackItems] =
    await Promise.all([
      cookies(),
      getMessages(),
      getSubmissions(),
      getFlaggedContent({ status: "pending" }),
      getPendingEdits("pending"),
      getPendingReports(),
      getFeedbackItems({ status: "open" }),
    ]);

  const fmMode = cookieStore.get("fm_mode")?.value;
  const adminBarMode: AdminMode = fmMode === "viewer" ? "viewer" : "god";

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
        { label: "分類管理", href: "/admin/catalog/taxonomy" },
      ],
    },
  ];

  return (
    <NextIntlClientProvider locale="zh-TW" messages={messages}>
      <div className="min-h-screen bg-background">
        <AdminModeBar
          mode={adminBarMode}
          labels={{
            god: "管理者模式",
            viewer: "訪客檢視",
            enter: "切換為訪客檢視",
            exit: "離開訪客檢視",
            banner: "一般使用者檢視",
          }}
        />
        <main className="mx-auto max-w-screen-2xl px-10 pb-8 pt-8">
          <h1 className="font-heading text-3xl font-bold tracking-tight">管理後台</h1>
          <AdminNav items={navItems} />
          <div className="mt-8">{children}</div>
        </main>
      </div>
    </NextIntlClientProvider>
  );
}
