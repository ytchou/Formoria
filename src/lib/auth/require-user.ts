import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { signInHref } from "@/i18n/locale-preference";
import { createClient } from "@/lib/supabase/server";

// App Router layouts have no pathname, so the `next` param must be built at the page level.
export async function requireUserPage(nextPath: string, locale: string): Promise<User> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect(signInHref(nextPath, locale));
  }

  return user;
}
