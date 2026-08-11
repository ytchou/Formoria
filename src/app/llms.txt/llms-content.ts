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
    'Formoria is a Taiwanese brand discovery and curation platform built to make Taiwanese brands easier to discover, choose, and grow. Its searchable, community-built directory is the foundation of that mission.',
    '',
    '## Links',
    ...linkLines,
    '',
    '## Categories',
    ...categoryLines,
    '',
  ].join('\n')
}
