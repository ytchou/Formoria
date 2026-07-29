import { redirect } from "next/navigation";
import { localizePath } from "@/i18n/locale-preference";
import { createClient } from "@/lib/supabase/server";

export default async function ProtectedLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // A layout has no pathname, so `next` cannot be preserved here — the nested
    // page-level guards carry it. Locale is preserved so the user at least lands
    // on the right-language sign-in form.
    redirect(localizePath("/auth/sign-in", locale));
  }

  return <>{children}</>;
}
