import en from "../../../messages/en.json";
import zhTW from "../../../messages/zh-TW.json";
import { withAuditScope } from "@/lib/audit";
import { buildAlternates } from "@/lib/seo/alternates";
import { L1_CATEGORIES } from "@/lib/taxonomy/ontology";
import { formatLlmsTxt } from "./llms-content";
import { routes } from "@/lib/routes";

export const revalidate = 3600;

export const GET = withAuditScope(async () => {
  const canonical = (path: string) => buildAlternates(path, "zh-TW").canonical;
  const links = [
    ["Brands", routes.brands()],
    ["Stories", routes.stories()],
    ["About", routes.about()],
    ["Events", routes.events()],
    ["Where to buy", routes.whereToBuy()],
    ["FAQ", routes.faq()],
  ].map(([label, path]) => ({ label, url: canonical(path) }));

  const categories = L1_CATEGORIES.map((category) => ({
    name: category.name,
    nameZh: category.nameZh,
    url: canonical(routes.category(category.slug)),
    description:
      en.categories.descriptions[category.slug] ??
      zhTW.categories.descriptions[category.slug],
  }));

  const body = formatLlmsTxt({ links, categories });

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
});
