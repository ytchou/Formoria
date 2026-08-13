import type { Metadata } from "next";
import BrandDetailPage, {
  generateMetadata as generateBrandMetadata,
} from "../../../[locale]/(site)/brands/[slug]/page";

const DEFAULT_LOCALE = "zh-TW";

// Keep the prefixless default-locale entry point on the same on-demand ISR
// contract as the localized route. The empty list prevents corpus-wide build
// work while the proxy supplies zh-TW for this exact route without re-entry.
export const revalidate = 3600;

export function generateStaticParams() {
  return [];
}

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return generateBrandMetadata({
    params: Promise.resolve({ locale: DEFAULT_LOCALE, slug }),
  });
}

export default async function DefaultBrandDetailPage({ params }: PageProps) {
  const { slug } = await params;
  return BrandDetailPage({
    params: Promise.resolve({ locale: DEFAULT_LOCALE, slug }),
  });
}
