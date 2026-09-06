export function faqCustomPrompt(brandName: string, ceiling: number): string {
  return `You may choose up to ${ceiling} most useful custom questions based on brand "${brandName}" data; returning zero is completely valid — prefer fewer over padding. Every answer must have evidence and must not restate existing questions.`;
}

export function faqMainProductsPrompt(brandName: string): string {
  return `Based on the product tags provided for brand "${brandName}", supplement with verifiable material, process, or craftsmanship details; do not fabricate information not present in the sources.`;
}

export function faqWhereToBuyPrompt(brandName: string): string {
  return `List verified purchase channels for brand "${brandName}" — only cite channels present in the evidence. Do not describe pricing, discounts, or availability.`;
}

export function faqCategoryPositionPrompt(input: {
  brandName: string;
  categorySlug: string;
  peerCount: number;
}): string {
  return `Category facts for brand "${input.brandName}": the ${input.categorySlug} category has ${input.peerCount} other brands. State only the product scope and size of the category — do not claim price, ranking, value, superiority, leadership, popularity, or any relative position.`;
}
