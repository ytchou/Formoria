import { permanentRedirect } from "next/navigation";
import { routes } from "@/lib/routes";

type PageProps = {
  params: Promise<{ locale: string }>;
};

export default async function VisionPage({ params }: PageProps) {
  const { locale } = await params;
  permanentRedirect(
    locale === "en" ? `/en${routes.about()}#vision` : `${routes.about()}#vision`,
  );
}
