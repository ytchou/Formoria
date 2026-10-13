import type { Metadata } from "next";
import BrandDetailPage, {
  generateMetadata as generateBrandMetadata,
} from "../../../[locale]/(site)/brands/[slug]/page";

const DEFAULT_LOCALE = "zh-TW";

export const revalidate = 0;

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
