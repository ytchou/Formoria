import { redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const resolvedLocale = await getLocale();
  const locale = routing.locales.includes(
    resolvedLocale as (typeof routing.locales)[number]
  )
    ? resolvedLocale
    : routing.defaultLocale;
  const messages = await getMessages();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </NextIntlClientProvider>
  );
}
