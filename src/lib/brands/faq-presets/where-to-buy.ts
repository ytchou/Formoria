import {
  buildBrandContextSuffix,
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
import { faqWhereToBuyPrompt } from "@/lib/prompts";

function channelList(ctx: FaqBrandContext, t: FaqTFn): string {
  const channels: string[] = [];
  if (hasValue(ctx.brand.purchaseWebsite))
    channels.push(t("brandFaq.channels.website"));
  if (hasValue(ctx.brand.purchasePinkoi))
    channels.push(t("brandFaq.channels.pinkoi"));
  if (hasValue(ctx.brand.purchaseShopee))
    channels.push(t("brandFaq.channels.shopee"));
  if (hasValue(ctx.brand.purchaseMyship))
    channels.push(t("brandFaq.channels.myship"));
  return channels.join(t("brandFaq.listSeparator"));
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
    templateFloor: (ctx, t) => {
      const channels = channelList(ctx, t);
      const stockistNote =
        (ctx.brand.stockistCount ?? 0) > 0
          ? t("brandFaq.whereToBuy.stockistSuffix", {
              count: ctx.brand.stockistCount,
            })
          : "";
      return t("brandFaq.whereToBuy.answer", {
        brandName: ctx.brand.name,
        channels: channels || t("brandFaq.whereToBuy.noOnlineChannels"),
        stockistNote,
        context: buildBrandContextSuffix(ctx, t),
      });
    },
  },
  promptFragment: (ctx) => faqWhereToBuyPrompt(ctx.brand.name),
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
