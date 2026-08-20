import { redirect } from "next/navigation";
import { isActingAsAdmin } from "@/lib/auth/admin-mode";
import { createClient } from "@/lib/supabase/server";
import { routes } from "@/lib/routes";

type AdminUser = { id: string; email: string | null };
type AdminAuthErrorCode = 'unauthenticated' | 'forbidden';

type AdminAuthError = {
  error: string;
  code: AdminAuthErrorCode;
};

async function getAdminUser(): Promise<{ user: AdminUser } | AdminAuthError> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { error: "You must authenticate to perform this action", code: "unauthenticated" };
  }

  if (!(await isActingAsAdmin(user.email))) {
    return { error: "You are not authorized to perform this action", code: "forbidden" };
  }

  return { user: { id: user.id, email: user.email ?? null } };
}

export async function requireAdminAction(): Promise<{ user: AdminUser } | AdminAuthError> {
  return getAdminUser();
}

/** Admin is pinned to English (ADMIN_DEFAULT_LOCALE in proxy.ts). */
const ADMIN_LOCALE_PREFIX = "en";

/**
 * The sign-in path for anything under `/admin`, spelled once.
 *
 * The admin tree lives OUTSIDE `[locale]`, but `/auth/sign-in` lives inside it,
 * so the sign-in path — and only the sign-in path — needs a prefix. Three call
 * sites concatenated `/en` onto a `routes` builder by hand, which meant a
 * rename of `auth.signIn` moved half of each URL.
 *
 * `signInHref()` is the wrong tool here: it localizes the `next` target too, so
 * an admin destination comes back as `/en/admin/…`, which 404s after sign-in.
 * `next` therefore stays exactly what `routes.admin.*` produced, and
 * `routes.auth.signIn` does the encoding (contract 2 in `routes.ts`).
 */
export function adminSignInPath(nextPath: string): string {
  return `/${ADMIN_LOCALE_PREFIX}${routes.auth.signIn({ next: nextPath })}`;
}

export async function requireAdminPage(nextPath: string): Promise<AdminUser> {
  const auth = await getAdminUser();

  if ("error" in auth) {
    redirect(adminSignInPath(nextPath));
  }

  return auth.user;
}
