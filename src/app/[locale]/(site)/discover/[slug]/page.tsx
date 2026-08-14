import { getTranslations, setRequestLocale } from "next-intl/server";

type PageProps = {
  params: Promise<{ locale: string; slug: string }>;
};

export const revalidate = 3600;

export default async function DiscoverTrailShell({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "discover" });

  return (
    <main className="mx-auto w-full max-w-[920px] px-4 py-10 md:px-8">
      <h1 className="type-page-title">{t("heading")}</h1>
    </main>
  );
}
