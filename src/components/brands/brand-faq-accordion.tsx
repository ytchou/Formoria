'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
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
}

export function BrandFaqAccordion({ items }: BrandFaqAccordionProps) {
  const t = useTranslations('brandDetail.sections')

  if (items.length === 0) return null

  return (
    <section>
      <h2 className="mb-3 font-heading text-base font-bold text-foreground">
        {t('faq')}
      </h2>
      <Accordion type="multiple">
        {items.map((item, index) => (
          <AccordionItem key={`${item.question}-${index}`} value={`faq-${index}`}>
            <AccordionTrigger>{item.question}</AccordionTrigger>
            <AccordionContent>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {renderLinkedText(item.answer)}
              </p>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  )
}
