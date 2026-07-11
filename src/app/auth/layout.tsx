import Link from "next/link";
import { redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { BrandMark } from "@/lib/brand/BrandMark";
import { createClient } from "@/lib/supabase/server";
import { localizePath } from "@/i18n/locale-preference";

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
    redirect(localizePath('/dashboard', locale));
  }

  const homePath = localizePath('/', locale);

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <div className="flex min-h-screen flex-col bg-background">
        <header className="flex h-14 items-center px-6">
          <Link href={homePath} className="flex items-center gap-2">
            <BrandMark size={28} />
            <span className="text-lg font-semibold tracking-tight">Formoria</span>
          </Link>
        </header>
        <div className="flex flex-1 items-center justify-center px-4">
          <div className="w-full max-w-md">{children}</div>
        </div>
      </div>
    </NextIntlClientProvider>
  );
}
