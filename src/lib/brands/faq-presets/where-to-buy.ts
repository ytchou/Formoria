import { spaceNameBoundaries } from "@/lib/i18n/cjk-spacing";
import {
  formatFaqList,
  hasValue,
  type FaqBrandContext,
  type FaqPreset,
  type FaqTFn,
} from "./types";
import {
  noKeywordStuffing,
  noCommerceClaims,
  notDuplicateOf,
  pureLanguage,
  withinLengthBand,
} from "./validators";

/** Channel names are proper nouns: never case-folded, in any locale. */
function channelNames(ctx: FaqBrandContext, t: FaqTFn): string[] {
  const channels: string[] = [];
  if (hasValue(ctx.brand.purchaseWebsite))
    channels.push(t("brandFaq.channels.website"));
  if (hasValue(ctx.brand.purchasePinkoi))
    channels.push(t("brandFaq.channels.pinkoi"));
  if (hasValue(ctx.brand.purchaseShopee))
    channels.push(t("brandFaq.channels.shopee"));
  if (hasValue(ctx.brand.purchaseMyship))
    channels.push(t("brandFaq.channels.myship"));
  return channels;
}

const whereToBuy: FaqPreset = {
  id: "where-to-buy",
  eligible: (ctx) =>
    hasValue(ctx.brand.purchaseWebsite) ||
    hasValue(ctx.brand.purchasePinkoi) ||
    hasValue(ctx.brand.purchaseShopee) ||
    hasValue(ctx.brand.purchaseMyship) ||
    (ctx.brand.stockistCount ?? 0) > 0,
  requiredEvidence: ["purchaseChannels"],
  render: {
    questionKey: "brandFaq.whereToBuy.question",
    // DEV-1994: no city/year suffix — both are on the page's metadata line.
    templateFloor: (ctx, t, locale) => {
      const stockistCount = ctx.brand.stockistCount ?? 0;
      const channels = channelNames(ctx, t);
      if (channels.length === 0 && stockistCount > 0) {
        return t("brandFaq.whereToBuy.answerStockistsOnly", {
          brandName: ctx.brand.name,
          count: stockistCount,
        });
      }
      const answer = t("brandFaq.whereToBuy.answer", {
        brandName: ctx.brand.name,
        channels: formatFaqList(channels, locale),
        stockistNote:
          stockistCount > 0
            ? t("brandFaq.whereToBuy.stockistSuffix", { count: stockistCount })
            : "",
      });
      if (locale.startsWith("en")) return answer;
      // zh: a Latin-edged channel (Pinkoi, 7-ELEVEN) sits between Han
      // characters, so space it the same way the brand name is spaced.
      return channels.reduce(spaceNameBoundaries, answer);
    },
  },
  promptFragment: {
    prompt: "faq-where-to-buy",
    variables: (ctx) => ({ brand_name: ctx.brand.name }),
  },
  // `groundedIn(requiredEvidence)` is derived in the registry (index.ts).
  validators: [
    pureLanguage(),
    withinLengthBand(),
    noCommerceClaims(),
    noKeywordStuffing(),
    notDuplicateOf(),
  ],
};

export default whereToBuy;
