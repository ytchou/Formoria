import { redirect } from "next/navigation";
import { isActingAsAdmin } from "@/lib/auth/admin-mode";
import { createClient } from "@/lib/supabase/server";

type AdminUser = { id: string; email: string | null };

async function getAdminUser(): Promise<{ user: AdminUser } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { error: "You must authenticate to perform this action" };
  }

  if (!(await isActingAsAdmin(user.email))) {
    return { error: "You are not authorized to perform this action" };
  }

  return { user: { id: user.id, email: user.email ?? null } };
}

export async function requireAdminAction(): Promise<{ user: AdminUser } | { error: string }> {
  return getAdminUser();
}

export async function requireAdminPage(nextPath: string): Promise<AdminUser> {
  const auth = await getAdminUser();

  if ("error" in auth) {
    redirect(`/auth/sign-in?next=${nextPath}`);
  }

  return auth.user;
}
