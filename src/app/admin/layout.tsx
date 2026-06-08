import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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

  return (
    <div className="min-h-screen bg-background">
      <AdminModeBar
        labels={{
          god: "管理者模式",
          viewer: "訪客檢視",
          enter: "切換為訪客檢視",
          exit: "離開訪客檢視",
          banner: "一般使用者檢視",
        }}
      />
      <AdminNav />
      <main className="mx-auto max-w-screen-xl px-10 pb-8 pt-12">{children}</main>
    </div>
  );
}
