import en from "../../../messages/en.json";
import zhTW from "../../../messages/zh-TW.json";
import { withAuditScope } from "@/lib/audit";
import { buildAlternates } from "@/lib/seo/alternates";
import { PRODUCT_TYPE_CATEGORIES } from "@/lib/taxonomy/ontology";
import { formatLlmsTxt } from "./llms-content";

export const revalidate = 3600;

export const GET = withAuditScope(async () => {
  const canonical = (path: string) => buildAlternates(path, "zh-TW").canonical;
  const links = [
    ["Brands", "/brands"],
    ["Stories", "/stories"],
    ["About", "/about"],
    ["Glossary", "/glossary"],
    ["Events", "/events"],
    ["FAQ", "/faq"],
    ["Stats", "/stats"],
  ].map(([label, path]) => ({ label, url: canonical(path) }));

  const categories = PRODUCT_TYPE_CATEGORIES.map((category) => ({
    name: category.name,
    nameZh: category.nameZh,
    url: canonical(`/categories/${category.slug}`),
    description:
      en.categories.descriptions[category.slug] ??
      zhTW.categories.descriptions[category.slug],
  }));

  const body = formatLlmsTxt({ links, categories });

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
});
