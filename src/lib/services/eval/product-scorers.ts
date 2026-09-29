import { z } from 'zod'

import { validateProductProposals, type ProductsModelResult } from '@/lib/services/enrich-phases/products'
import { productUrlKey, type ProductCandidate } from '@/lib/services/enrich-phases/product-candidates'
import { repairedProposalPasses } from '@/lib/services/enrich-phases/products/graph'

/*
 * Products golden-set scorers (DEV-1873). Kept out of `./scorers` on purpose:
 * `enrich-validators` imports `./scorers`, and `enrich-phases/products` reaches
 * `enrich-validators` through `description-rewrite`. Importing the products
 * phase from `./scorers` closes that loop and `products/graph` then reads
 * `PRODUCTS_PROPOSAL_SHAPE` before `products.ts` has finished loading.
 */

/**
 * What the rule-only products scorers need beyond the model output, stored in
 * `expectedOutput.context` when the item is recorded. `candidates` are
 * normalized product URLs; `hardUrls` (repair only) are the normalized URLs of
 * the entries that failed a check other than the origin omission. The type is
 * inferred from the schema the adapter validates items with, so they cannot drift.
 */
export const productsGoldenContextSchema = z.object({
  siteUrl: z.string(),
  candidates: z.array(z.string()),
  ownedHosts: z.array(z.string()),
  hardUrls: z.array(z.string()).optional(),
})

export type ProductsGoldenContext = z.infer<typeof productsGoldenContextSchema>

function validateAgainst(output: unknown, context: ProductsGoldenContext) {
  // `validateProductProposals` reads only `normalizedUrl` (and `imageUrl`,
  // absent here) off a candidate; the stored context keeps just the URL.
  const candidates = context.candidates.map(
    (normalizedUrl) => ({ normalizedUrl }) as ProductCandidate,
  )
  return validateProductProposals((output ?? {}) as ProductsModelResult, {
    siteUrl: context.siteUrl,
    candidates,
  })
}

/**
 * Share of the model's products that survive production validation. 0 when
 * the model proposed nothing although the pool had candidates, so a
 * propose-nothing regression shows; null only when there was nothing to
 * propose from.
 */
export function keepRate(output: unknown, context: ProductsGoldenContext): number | null {
  const validation = validateAgainst(output, context)
  if (validation.rawCount === 0) return context.candidates.length > 0 ? 0 : null
  return validation.proposals.length / validation.rawCount
}

/**
 * Share of the item's hard entries that come back passing the same re-verify
 * predicate `repairNode` applies. Null when the item has no hard entries
 * (an origin-only repair).
 */
export function repairPassRate(output: unknown, context: ProductsGoldenContext): number | null {
  const hard = new Set(context.hardUrls ?? [])
  if (hard.size === 0) return null
  const repaired = new Set<string>()
  for (const proposal of validateAgainst(output, context).proposals) {
    const key = productUrlKey(proposal.officialUrl)
    if (!hard.has(key)) continue
    const result = repairedProposalPasses(proposal, {
      brandUrl: context.siteUrl,
      ownedHosts: context.ownedHosts,
      soft: false,
    })
    if (result.passes) repaired.add(key)
  }
  return repaired.size / hard.size
}
