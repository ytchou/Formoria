import { createHash } from "node:crypto";
import { TAIWAN_USAGE_RULES } from "@/lib/prompts";
import categoryPosition from "./category-position";
import custom from "./custom";
import mainProducts from "./main-products";
import pricePositioning from "./price-positioning";
import reputation from "./reputation";
import taiwanOrigin from "./taiwan-origin";
import {
  CUSTOM_QUESTION_CEILING,
  type FaqBrandContext,
  type FaqPreset,
} from "./types";

export const FAQ_PRESETS: readonly FaqPreset[] = [
  taiwanOrigin,
  categoryPosition,
  mainProducts,
  pricePositioning,
  reputation,
  custom,
];

export function eligibleFaqPresets(ctx: FaqBrandContext): FaqPreset[] {
  return FAQ_PRESETS.filter((preset) => preset.eligible(ctx));
}

export const FAQ_PROMPT_PREAMBLE = `你是 Formoria 的 FAQ 編輯。請用直接、客觀、具體的回答語氣，先回答使用者問題，再補充最相關的事實；只使用提供的品牌證據，不得推測或編造。

## 台灣用語規範
${TAIWAN_USAGE_RULES}

## 長度區間
zh-TW 回答為 200–320 字；en 回答為 120–180 words。每個回答都必須落在對應語言的區間內。

## 反關鍵字堆砌
不要為了搜尋關鍵字重複品牌名、產品名或類別詞；自然回答使用者的問題，資訊不足時省略，不要湊字數。

## 五項品質標準
1. 差異化：回答指出這個品牌與同類品牌的具體差異。
2. 有依據：每個重要主張都能回到提供的證據。
3. 長度區間：遵守 zh-TW 200–320 字與 en 120–180 words。
4. 不重複：不要重述其他已產生的 FAQ 主題或回答。
5. 使用者提問語氣：直接回應使用者真正想知道的事，不寫成宣傳標語。
自訂問題最多 ${CUSTOM_QUESTION_CEILING} 個；回傳零個自訂問題是有效結果，寧可少，不可湊數。`;

function orderedContributors(presets: readonly FaqPreset[]): FaqPreset[] {
  const byId = new Map(presets.map((preset) => [preset.id, preset]));
  return FAQ_PRESETS.flatMap((preset) => {
    const passed = byId.get(preset.id);
    return passed ? [passed] : [];
  });
}

export function buildFaqSystemPrompt(
  presets: readonly FaqPreset[],
  ctx: FaqBrandContext,
): string {
  const fragments = orderedContributors(presets)
    .filter((preset) => preset.promptFragment !== null)
    .map((preset) => preset.promptFragment?.(ctx) ?? "")
    .filter(Boolean);

  return [FAQ_PROMPT_PREAMBLE, ...fragments].join("\n\n");
}

export function buildFaqPromptHash(presets: readonly FaqPreset[]): string {
  const fragmentIds = presets
    .filter((preset) => preset.promptFragment !== null)
    .map((preset) => preset.id)
    .sort();

  // Hash the stable preamble and contributing preset IDs, never the rendered
  // brand-specific prompt, so equivalent eligible sets share one prompt version.
  return createHash("sha256")
    .update([FAQ_PROMPT_PREAMBLE, ...fragmentIds].join("\n"))
    .digest("hex")
    .slice(0, 12);
}

export * from "./types";
export * from "./validators";
