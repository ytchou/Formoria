type LlmsLink = {
  label: string
  url: string
}

type LlmsCategory = {
  name: string
  nameZh: string
  url: string
  description?: string | null
}

type LlmsContent = {
  links: readonly LlmsLink[]
  categories: readonly LlmsCategory[]
}

export function formatLlmsTxt({ links, categories }: LlmsContent): string {
  const linkLines = links.map(({ label, url }) => `- [${label}](${url})`)
  const categoryLines = categories.map(({ name, nameZh, url, description }) => {
    const descriptionSuffix = description ? ` — ${description}` : ''
    return `- [${name}](${url}) (${nameZh})${descriptionSuffix}`
  })

  return [
    '# Formoria',
    '',
    'Formoria reconnects the path after that moment: from one thing you love, to its brand, its story, and the place you can buy it. It currently starts with a searchable directory of listed Taiwanese brands; content selected by Formoria is labelled separately. Formoria owns inspiration, selection, context, and the outbound route. Brands or retailers remain responsible for price, variants, inventory, checkout, fulfilment, and after-sales service.',
    '',
    '## Links',
    ...linkLines,
    '',
    '## Categories',
    ...categoryLines,
    '',
  ].join('\n')
}
