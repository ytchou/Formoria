import { VISIBLE_L1_CATEGORIES, categoryLabel } from './ontology'

/**
 * The visible L1 categories as ICU values for running copy: a count and one
 * locale-joined string. Derived from the taxonomy so a sentence such as the
 * FAQ's "which categories" answer cannot drift from what the site shows.
 */
export function visibleCategoryList(locale: string): {
  count: number
  categories: string
} {
  const labels = VISIBLE_L1_CATEGORIES.map(category => categoryLabel(category, locale))
  const categories =
    locale === 'zh-TW'
      ? labels.join('、')
      : new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(labels)

  return { count: VISIBLE_L1_CATEGORIES.length, categories }
}
