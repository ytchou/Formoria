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
    'Formoria reconnects the broken path from inspiration to purchase by helping people start with the life they want, find Taiwanese products that suit them, get to know the brands behind them, and know where to buy. It currently starts with a searchable directory of listed Taiwanese brands; content selected by Formoria is labelled separately. Formoria owns inspiration, selection, context, and the outbound route. Brands or retailers remain responsible for price, variants, inventory, checkout, fulfilment, and after-sales service.',
    '',
    '## Links',
    ...linkLines,
    '',
    '## Categories',
    ...categoryLines,
    '',
  ].join('\n')
}
