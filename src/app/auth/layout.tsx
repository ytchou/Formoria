import type { Metadata } from "next";
import Link from "next/link";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { RootDocument } from "@/components/shared/root-document";
import { routing } from "@/i18n/routing";
import { BrandMark } from "@/lib/brand/BrandMark";
import { localizePath, type AppLocale } from "@/i18n/locale-preference";
import { getSiteUrl } from "@/lib/seo/site-url";
import "../globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: "Formoria",
    template: "%s | Formoria",
  },
  robots: { index: false, follow: true },
};

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const resolvedLocale = await getLocale();
  const locale: AppLocale = routing.locales.includes(
    resolvedLocale as AppLocale
  )
    ? (resolvedLocale as AppLocale)
    : routing.defaultLocale;
  const [messages, tCommon] = await Promise.all([
    getMessages({ locale }),
    getTranslations({ locale, namespace: "common" }),
  ]);

  const homePath = localizePath('/', locale);

  return (
    <RootDocument locale={locale} skipToContentLabel={tCommon("skipToContent")}>
      <NextIntlClientProvider locale={locale} messages={messages}>
        <div className="flex min-h-screen flex-col bg-background">
          <header className="flex h-14 items-center px-6">
            <Link href={homePath} className="flex items-center gap-2">
              <BrandMark size={28} />
              <span className="type-section-title">Formoria</span>
            </Link>
          </header>
          <main id="main-content" className="flex flex-1 items-center justify-center px-4">
            <div className="w-full max-w-md">{children}</div>
          </main>
        </div>
      </NextIntlClientProvider>
    </RootDocument>
  );
}
