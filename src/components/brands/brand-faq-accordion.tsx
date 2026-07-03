'use client'

import { useTranslations } from 'next-intl'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'

interface BrandFaqAccordionProps {
  items: Array<{ question: string; answer: string }>
}

export function BrandFaqAccordion({ items }: BrandFaqAccordionProps) {
  const t = useTranslations('brandFaq')

  if (items.length === 0) return null

  return (
    <section>
      <h2 className="mb-3 font-heading text-base font-bold text-foreground">
        {t('sectionTitle')}
      </h2>
      <Accordion type="multiple">
        {items.map((item, index) => (
          <AccordionItem key={`${item.question}-${index}`} value={`faq-${index}`}>
            <AccordionTrigger>{item.question}</AccordionTrigger>
            <AccordionContent>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {item.answer}
              </p>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  )
}
