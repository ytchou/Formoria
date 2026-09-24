/**
 * Label lexicon for product-page evidence selection (DEV-1855).
 *
 * Machine-readable regexes, not UI copy — allowlisted in the CJK guard so
 * `select-evidence.ts` can stay free of Han characters.
 *
 * Commerce-truth rule: no tier may match price or stock labels. Price,
 * inventory and discounts are never boosted into model evidence.
 */

export type FactTier = 'materials' | 'specs' | 'technique_origin' | 'care'

/**
 * Fact tiers in priority order. A block's tier is the FIRST tier whose pattern
 * matches it. Patterns carry no `g` flag, so `.test()` stays stateless.
 */
export const FACT_TIERS: ReadonlyArray<{ tier: FactTier; pattern: RegExp }> = [
  {
    tier: 'materials',
    pattern: /材質|材料|成分|原料|布料|\bmaterials?\b|\bingredients?\b/i,
  },
  {
    tier: 'specs',
    pattern: /規格|尺寸|容量|重量|大小|\bdimensions?\b|\bsizes?\b|\bweight\b|\bcapacity\b/i,
  },
  {
    tier: 'technique_origin',
    pattern: /工藝|手工|製程|工法|產地|製造|\bmade in\b|\bhand-?made\b/i,
  },
  {
    tier: 'care',
    pattern: /保養|清潔|洗滌|使用方式|注意事項|\bcare\b|\bwash(?:ing)?\b/i,
  },
]

/** Store chrome: shipping, payment, reviews, cart and social widgets. */
export const CHROME_PATTERN =
  /送貨|運送方式|付款方式|顧客評價|加入購物車|立即購買|退換貨|會員|分享|追蹤|\bshipping\b|\bpayments?\b|\badd to cart\b|\breviews?\b/i

/** Unrendered client-side template tokens, e.g. Angular/Handlebars bindings. */
export const TEMPLATE_TOKEN_PATTERN = /\{\{[^}]*\}\}/g
