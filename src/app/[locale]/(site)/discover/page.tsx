import { getTranslations, setRequestLocale } from "next-intl/server";

type PageProps = {
  params: Promise<{ locale: string }>;
};

export const revalidate = 3600;

export default async function DiscoverHubShell({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "discover" });

  return (
    <main className="page-gutter mx-auto w-full max-w-screen-xl py-10">
      <h1 className="type-page-title">{t("heading")}</h1>
    </main>
  );
}
