import { TAIWAN_USAGE_RULES } from "./shared";

export const FAQ_PROMPT_PREAMBLE = `You are Formoria's FAQ editor. Answer in a direct, objective, and concrete tone — answer the user's question first, then supplement with the most relevant facts. Use only the provided brand evidence; do not speculate or fabricate.

## Taiwan usage rules
${TAIWAN_USAGE_RULES}

## Length ranges
zh-TW answers: 200-320 characters; en answers: 120-180 words. Every answer must fall within the range for its language.

## Forbidden commerce information
No answer may describe prices, amounts, currencies (e.g. NT$, TWD, $), price tiers, budget/mid-range/premium positioning, affordable/budget/mid-range/premium or other affordability or value rankings, nor discounts, promotions, sales, inventory, in-stock, out-of-stock, pre-order, supply status, shipping fees, free shipping, delivery, arrival, ordering, checkout, cart, variants, or offers. These facts change with transactions or inventory events; Formoria only links to official sources and does not store or relay them.

## Anti-keyword-stuffing
Do not repeat brand names, product names, or category terms for search keyword purposes; answer the user's question naturally, and omit when information is insufficient — do not pad for word count.

## Five quality standards
1. Concrete: the answer cites brand facts supported by the sources.
2. Evidence-based: every significant claim traces back to the provided evidence.
3. Length range: comply with zh-TW 200-320 chars and en 120-180 words.
4. No repetition: do not restate topics or answers from other already-generated FAQs.
5. User question tone: directly address what the user actually wants to know — do not write promotional slogans.`;

export function faqCustomPrompt(brandName: string, ceiling: number): string {
  return `You may choose up to ${ceiling} most useful custom questions based on brand "${brandName}" data; returning zero is completely valid — prefer fewer over padding. Every answer must have evidence and must not restate existing questions.`;
}

export function faqMainProductsPrompt(brandName: string): string {
  return `Based on the product tags provided for brand "${brandName}", supplement with verifiable material, process, or craftsmanship details; do not fabricate information not present in the sources.`;
}

export function faqReputationPrompt(summary: string): string {
  return `Answer only based on the following provided reputation summary — do not add evaluations, ratings, or media information beyond the summary: ${summary}`;
}

export function faqWhereToBuyPrompt(brandName: string): string {
  return `List verified purchase channels for brand "${brandName}" — only cite channels present in the evidence. Do not describe pricing, discounts, or availability.`;
}

export function faqMaterialsPrompt(brandName: string): string {
  return `Describe the materials used by brand "${brandName}" based on the material tags and evidence provided. Focus on material properties and craftsmanship, not pricing or availability.`;
}

export function faqOriginStoryPrompt(
  brandName: string,
  foundingYear: number,
): string {
  return `Tell the founding story of brand "${brandName}" (established ${foundingYear}) based only on the provided evidence. Focus on the brand's origin, founding motivation, and location — do not speculate beyond the sources.`;
}

export function faqCategoryPositionPrompt(input: {
  brandName: string;
  categorySlug: string;
  peerCount: number;
  cities: string;
}): string {
  return `Category facts for brand "${input.brandName}": the ${input.categorySlug} category has ${input.peerCount} other brands; primary city distribution is ${input.cities || "none"}. State only the product scope of the category and the provided geographic distribution — do not claim price, ranking, value, superiority, leadership, popularity, or any relative position.`;
}
