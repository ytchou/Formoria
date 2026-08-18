function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function buildModerationPayload(
  proposedData: Record<string, unknown>,
  brandName: string,
): {
  brandName: string
  fields: Record<string, string | undefined>
} {
  const proposedName = getString(proposedData.name)
  const subcategories = Array.isArray(proposedData.subcategories)
    ? proposedData.subcategories
        .filter((tag): tag is string => typeof tag === 'string')
        .join(' ')
    : undefined

  return {
    brandName: proposedName ?? brandName,
    fields: {
      name: proposedName,
      description: getString(proposedData.description),
      mitStory: getString(proposedData.mitStory),
      subcategories,
      website: getString(proposedData.purchaseWebsite),
      purchaseUrl:
        getString(proposedData.purchasePinkoi) ??
        getString(proposedData.purchaseShopee) ??
        getString(proposedData.purchaseMyship),
    },
  }
}
