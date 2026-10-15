import type { Metadata } from "next";
import { Footer } from "@/components/navigation/footer";
import { MainNav } from "@/components/navigation/main-nav";
import { buildAlternates } from "@/lib/seo/alternates";
import { toSafeLocale } from "@/lib/seo/page-metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const safeLocale = toSafeLocale(locale);
  const { canonical, languages } = buildAlternates("/", safeLocale);

  return {
    alternates: {
      canonical,
      languages,
    },
  };
}

export default async function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <MainNav />
      <div id="main-content" className="flex-1">
        {children}
      </div>
      <Footer />
    </>
  );
}
