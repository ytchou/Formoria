'use client'

import { useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { trackFaqItemExpanded } from '@/lib/analytics'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { FaqSection } from '@/components/shared/faq-section'
import { sanitizeHref } from '@/lib/url'

const LINK_RE = /(\[[^\]]+\]\([^)]+\))/g
const LINK_PARTS_RE = /^\[([^\]]+)\]\(([^)]+)\)$/

function renderLinkedText(text: string): ReactNode {
  const parts = text.split(LINK_RE)
  if (parts.length === 1) return text

  return parts.map((part, i) => {
    const match = part.match(LINK_PARTS_RE)
    if (match) {
      const href = sanitizeHref(match[2])
      if (!href) return match[1]
      return (
        <a
          key={i}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline hover:text-primary/80"
        >
          {match[1]}
        </a>
      )
    }
    return part
  })
}

interface BrandFaqAccordionProps {
  items: Array<{ question: string; answer: string }>
  brandSlug: string
}

export function BrandFaqAccordion({ items, brandSlug }: BrandFaqAccordionProps) {
  const t = useTranslations('brandDetail.sections')
  const [openItems, setOpenItems] = useState<string[]>([])

  if (items.length === 0) return null

  function handleValueChange(values: string[]) {
    const newlyOpened = values.filter((v) => !openItems.includes(v))
    for (const val of newlyOpened) {
      const index = parseInt(val.replace('faq-', ''), 10)
      if (!isNaN(index)) trackFaqItemExpanded(brandSlug, index)
    }
    setOpenItems(values)
  }

  return (
    <FaqSection title={t('faq')}>
      <Accordion type="multiple" value={openItems} onValueChange={handleValueChange}>
        {items.map((item, index) => (
          <AccordionItem key={`${item.question}-${index}`} value={`faq-${index}`}>
            <AccordionTrigger className="type-faq-question py-5 hover:no-underline">
              {item.question}
            </AccordionTrigger>
            <AccordionContent>
              <p className="max-w-2xl type-body-muted">
                {renderLinkedText(item.answer)}
              </p>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </FaqSection>
  )
}
