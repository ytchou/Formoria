import { createElement } from 'react'

import { BrandCardMdx } from '@/components/guides/brand-card-mdx'
import { FaqBlock } from '@/components/guides/faq-block'
import { StatsCallout } from '@/components/guides/stats-callout'

export const tinaComponentMap = {
  BrandCard: (props: { slug: string }) =>
    createElement(BrandCardMdx, { slug: props.slug }),
  StatsCallout: (props: { stat: string; label: string }) =>
    createElement(StatsCallout, { stat: props.stat, label: props.label }),
  FaqBlock: (props: { questions: Array<{ q: string; a: string }> }) =>
    createElement(FaqBlock, { questions: props.questions }),
}
