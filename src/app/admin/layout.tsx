import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import type { AdminMode } from "@/lib/auth/admin-mode";
import { isActingAsAdmin } from "@/lib/auth/admin-mode";
import { AdminModeBar } from "@/components/admin-mode/admin-mode-bar";
import { AdminNav } from "@/components/admin/admin-nav";

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

  const cookieStore = await cookies();
  const fmMode = cookieStore.get("fm_mode")?.value;
  const adminBarMode: AdminMode = fmMode === "viewer" ? "viewer" : "god";
  const messages = await getMessages();

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
          <AdminNav />
          <div className="mt-8">{children}</div>
        </main>
      </div>
    </NextIntlClientProvider>
  );
}
