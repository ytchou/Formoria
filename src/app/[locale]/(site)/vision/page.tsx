import { permanentRedirect } from "next/navigation";

type PageProps = {
  params: Promise<{ locale: string }>;
};

export default async function VisionPage({ params }: PageProps) {
  const { locale } = await params;
  permanentRedirect(locale === "en" ? "/en/about#vision" : "/about#vision");
}
