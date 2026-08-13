import type { Metadata } from "next";
import SiteLayout, {
  generateMetadata as generateSiteMetadata,
} from "../../[locale]/(site)/layout";

const DEFAULT_LOCALE = "zh-TW";

export function generateMetadata(): Promise<Metadata> {
  return generateSiteMetadata({
    params: Promise.resolve({ locale: DEFAULT_LOCALE }),
  });
}

export default function DefaultBrandSiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return SiteLayout({ children });
}
