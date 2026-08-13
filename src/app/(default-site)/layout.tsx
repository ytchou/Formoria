import type { Metadata } from "next";
import LocaleLayout, {
  generateMetadata as generateLocaleMetadata,
} from "../[locale]/layout";

const DEFAULT_LOCALE = "zh-TW";
const defaultLocaleParams = Promise.resolve({ locale: DEFAULT_LOCALE });

export function generateMetadata(): Promise<Metadata> {
  return generateLocaleMetadata({ params: defaultLocaleParams });
}

export default function DefaultSiteRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return LocaleLayout({ children, params: defaultLocaleParams });
}
