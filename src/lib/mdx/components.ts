import { createElement } from 'react'

import { FaqBlock } from '@/components/guides/faq-block'
import { StatsCallout } from '@/components/guides/stats-callout'

function BrandCardLink({ slug }: { slug: string }) {
  return createElement(
    'a',
    {
      href: `/brands/${slug}`,
      className:
        'block rounded-xl border border-stone-200 bg-stone-100 p-4 font-semibold text-stone-900 no-underline hover:bg-stone-200',
    },
    slug,
  )
}

export const tinaComponentMap = {
  BrandCard: (props: { slug: string }) =>
    createElement(BrandCardLink, { slug: props.slug }),
  StatsCallout: (props: { stat: string; label: string }) =>
    createElement(StatsCallout, { stat: props.stat, label: props.label }),
  FaqBlock: (props: { questions: Array<{ q: string; a: string }> }) =>
    createElement(FaqBlock, { questions: props.questions }),
}
